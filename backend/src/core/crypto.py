"""
Field-level encryption for citizen PII (name, mobile, grievance).

Replaces the previous base64 "encoding" (which was reversible by anyone) with
real symmetric encryption (Fernet / AES-128-CBC + HMAC).

Three functions, used everywhere:
  encrypt(text)      -> Fernet token (string)
  decrypt(token)     -> plaintext. Backward-compatible: transparently reads BOTH
                        new Fernet tokens AND old base64 values, so the app keeps
                        working before/during/after the one-time data migration.
  blind_index(value) -> deterministic HMAC, used for equality lookups (e.g. find a
                        returning citizen by mobile) since Fernet ciphertext is
                        non-deterministic and can't be compared directly.

Key handling
------------
The Fernet key is derived (SHA-256) from settings.ENCRYPTION_KEY. If that is not
set we fall back to SECRET_KEY so dev works out of the box — but PRODUCTION SHOULD
SET A DEDICATED ENCRYPTION_KEY and never change it (changing it makes all existing
data unreadable; losing it is unrecoverable).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import settings

logger = logging.getLogger(__name__)

_FERNET: Optional[Fernet] = None


def _secret() -> str:
    if settings.ENCRYPTION_KEY:
        return settings.ENCRYPTION_KEY
    logger.warning(
        "ENCRYPTION_KEY not set — deriving the PII key from SECRET_KEY. "
        "Set a dedicated ENCRYPTION_KEY in production."
    )
    return settings.SECRET_KEY


def _fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        # SHA-256 -> 32 bytes -> urlsafe base64 = a valid Fernet key, stable for a
        # given secret. (Deterministic so the same key rebuilds across restarts.)
        digest = hashlib.sha256(_secret().encode("utf-8")).digest()
        _FERNET = Fernet(base64.urlsafe_b64encode(digest))
    return _FERNET


def encrypt(plaintext: Optional[str]) -> Optional[str]:
    if plaintext is None:
        return None
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(token: Optional[str]) -> Optional[str]:
    """Decrypt a Fernet token.

    The legacy base64-fallback branch (pre-encryption migration) is removed —
    it silently treated reversible base64 as if it were encrypted, so a DB
    that never ran encrypt_pii.py had PII effectively plaintext at rest.
    An InvalidToken now returns the raw value with a WARN so a list view
    doesn't crash but ops can grep for un-migrated rows and force-run the
    migration script.
    """
    if token is None:
        return None
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # NOT a Fernet token. This should never happen on a properly migrated
        # DB — log and return as-is so we don't 500 a list view.
        logger.warning(
            "crypto.decrypt: value is not a Fernet token (len=%d). "
            "If this fires often, run backend/encrypt_pii.py — the previous "
            "base64 fallback used to hide legacy plaintext rows silently.",
            len(token),
        )
        return token


def is_encrypted(value: Optional[str]) -> bool:
    """True if value already looks like a Fernet token (used by the migration)."""
    return bool(value) and value.startswith("gAAAAA")


def verify_crypto() -> None:
    """Startup self-test: prove the configured key can encrypt AND decrypt.

    Called at app startup (see main.py). If the Fernet key is malformed or the
    round-trip fails, this raises and the app refuses to boot — far better than
    discovering a broken key on the first citizen submission. Note this only
    validates the key is *usable*; it cannot detect that a changed key has made
    previously-stored ciphertext unreadable (that's a data-continuity concern,
    guarded by requiring ENCRYPTION_KEY in prod — see config)."""
    probe = "crypto-self-test"
    if decrypt(encrypt(probe)) != probe:
        raise RuntimeError("Crypto self-test failed: encrypt/decrypt round-trip mismatch.")
    if not settings.ENCRYPTION_KEY and not settings.DEBUG:
        raise RuntimeError("ENCRYPTION_KEY is not set in production — refusing to start.")


def blind_index(value: Optional[str]) -> Optional[str]:
    """Deterministic, non-reversible index for equality lookups (e.g. mobile dedup).
    Normalises by stripping non-digits so '+91 99999' and '99999' match."""
    if not value:
        return None
    normalized = "".join(ch for ch in value if ch.isdigit()) or value.strip()
    return hmac.new(_secret().encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()


def _norm_name(name: Optional[str]) -> str:
    """Trim + lowercase + collapse inner whitespace. So 'Yogesh ', 'yogesh',
    '  Yogesh' all match; 'Yogesh Kumar' stays distinct. Byte-identical after
    normalisation is the whole match rule — no transliteration, so an EN name
    and its Tamil-script counterpart are two different citizens."""
    if not name:
        return ""
    return " ".join(name.strip().lower().split())


def identity_blind_index(
    name: Optional[str], mobile: Optional[str]
) -> Optional[str]:
    """Deterministic HMAC of (normalise(name) | digits(mobile)) — the
    (name, mobile) uniqueness key on citizens.

    Returns None if either side is empty (association shadow citizens and
    other headless rows are intentionally exempt from uniqueness — Postgres
    allows many NULLs under a unique index)."""
    norm_name = _norm_name(name)
    digits = "".join(ch for ch in (mobile or "") if ch.isdigit())
    if not norm_name or not digits:
        return None
    payload = f"{norm_name}|{digits}"
    return hmac.new(_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
