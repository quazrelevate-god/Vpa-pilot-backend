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
    """Decrypt a Fernet token; fall back to legacy base64 for un-migrated rows."""
    if token is None:
        return None
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        # Legacy base64 value (pre-encryption data) — decode it as before.
        try:
            return base64.b64decode(token.encode("utf-8")).decode("utf-8")
        except Exception:
            return token  # last resort: return as-is rather than crash a list view


def is_encrypted(value: Optional[str]) -> bool:
    """True if value already looks like a Fernet token (used by the migration)."""
    return bool(value) and value.startswith("gAAAAA")


def blind_index(value: Optional[str]) -> Optional[str]:
    """Deterministic, non-reversible index for equality lookups (e.g. mobile dedup).
    Normalises by stripping non-digits so '+91 99999' and '99999' match."""
    if not value:
        return None
    normalized = "".join(ch for ch in value if ch.isdigit()) or value.strip()
    return hmac.new(_secret().encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()
