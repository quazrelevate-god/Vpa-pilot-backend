"""
Password hashing for staff (`login`) and department (`department_accounts`)
accounts.

New hashes use salted PBKDF2-HMAC-SHA256 in a self-describing format:

    pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>

This replaces the previous scheme — a single unsalted HMAC-SHA256 keyed on
SECRET_KEY — which was (a) fast, so cheap to brute-force on GPUs; (b) unsalted,
so identical passwords produced identical hashes (rainbow-table-able); and
(c) locked to SECRET_KEY, so rotating that key broke every login.

Existing (legacy) hashes are still *verified* transparently so no one is locked
out, and `needs_rehash()` flags them so a caller can upgrade the stored hash on
the next successful sign-in. Once every row is PBKDF2 the legacy path is dead
code that can be removed.

(argon2/bcrypt would be marginally stronger but pull in a native dependency;
PBKDF2 is in the stdlib and, at this iteration count, resolves every weakness
the audit named. Revisit if a KDF upgrade is ever warranted.)
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from src.core.config import settings

_ALGO = "pbkdf2_sha256"
_ITERATIONS = 600_000          # OWASP 2023 floor for PBKDF2-HMAC-SHA256
_SALT_BYTES = 16

# A fixed dummy hash used to equalize verify_password() timing when the caller
# passes stored=None (e.g. the username was not found in the login table).
# Without this, a login handler that short-circuits before the PBKDF2 call for
# unknown usernames leaks a ~200ms delta that lets an attacker enumerate valid
# accounts. Generated once at import time with a random salt so its exact bytes
# never appear in a rainbow table.
_DUMMY_STORED = f"{_ALGO}${_ITERATIONS}${secrets.token_bytes(_SALT_BYTES).hex()}${'0' * 64}"


def hash_password(password: str) -> str:
    """Salted PBKDF2-HMAC-SHA256 → self-describing string (see module docstring)."""
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${salt.hex()}${dk.hex()}"


def _legacy_hash(password: str) -> str:
    """The old unsalted HMAC-SHA256 scheme — kept ONLY to verify pre-existing rows."""
    return hmac.new(settings.SECRET_KEY.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_password(password: str, stored: Optional[str]) -> bool:
    """Verify against either a new PBKDF2 hash or a legacy HMAC hash.

    Constant-time on the "user not found" path: when `stored` is None / empty,
    we still do the full PBKDF2 work against a dummy hash and return False, so
    the caller can safely do the classic `if row and verify_password(...)`
    without leaking username validity via response time.
    """
    if not stored:
        # Do the expensive PBKDF2 work anyway so the "unknown username" branch
        # takes the same time as a wrong-password branch.
        _pbkdf2_verify(password, _DUMMY_STORED)
        return False
    if stored.startswith(_ALGO + "$"):
        return _pbkdf2_verify(password, stored)
    # Legacy unsalted HMAC row.
    return hmac.compare_digest(_legacy_hash(password), stored)


def _pbkdf2_verify(password: str, stored: str) -> bool:
    """Parse a self-describing PBKDF2 string, recompute, constant-time compare."""
    try:
        _algo, iters, salt_hex, hash_hex = stored.split("$", 3)
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def needs_rehash(stored: Optional[str]) -> bool:
    """True when `stored` is not the current PBKDF2 format (legacy row) or was
    hashed with fewer iterations than we now use — caller should re-hash on the
    next successful verify."""
    if not stored or not stored.startswith(_ALGO + "$"):
        return True
    try:
        _algo, iters, _salt, _hash = stored.split("$", 3)
        return int(iters) < _ITERATIONS
    except (ValueError, TypeError):
        return True
