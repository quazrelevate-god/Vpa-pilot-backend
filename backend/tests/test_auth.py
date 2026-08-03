"""
Auth-surface tests (P1-6 from the go-live review).

The go-live review flagged that nothing asserted an unauthenticated request is
rejected, and nothing covered the password hashing. These are pure-logic tests
(no DB, no network) exercising the security-relevant primitives directly:

  • dash_auth.verify_session / require_auth — the dash_session cookie gate that
    protects the whole PA dashboard (and, since P0-1, the scan-petition route).
  • src.core.passwords — PBKDF2 hashing + legacy-hash verification + rehash flag.

They assert the invariants that matter: no/garbage cookie is rejected, a validly
signed cookie is accepted, a tampered secret is rejected, and password
verification never accepts a blank/None stored hash.
"""
import pytest
from fastapi import HTTPException
from itsdangerous import TimestampSigner

from src.core.config import settings
from src.core import dash_auth
from src.core.passwords import hash_password, verify_password, needs_rehash, _legacy_hash


class _Req:
    """Minimal stand-in for starlette Request — verify_session only reads .cookies."""
    def __init__(self, cookies=None):
        self.cookies = cookies or {}


def _valid_cookie(username: str, secret: str | None = None) -> str:
    return TimestampSigner(secret or settings.SECRET_KEY).sign(username).decode()


# ── dash_auth: the dashboard session gate ────────────────────────────────────
def test_verify_session_rejects_missing_cookie():
    with pytest.raises(HTTPException) as ei:
        dash_auth.verify_session(_Req({}))
    assert ei.value.status_code == 302
    assert ei.value.headers["Location"] == "/auth/login"


def test_verify_session_rejects_garbage_cookie():
    with pytest.raises(HTTPException):
        dash_auth.verify_session(_Req({"dash_session": "not-a-real-token"}))


def test_verify_session_rejects_foreign_secret():
    # A cookie signed with a different secret must not validate.
    forged = _valid_cookie("attacker", secret="a-different-secret-key")
    with pytest.raises(HTTPException):
        dash_auth.verify_session(_Req({"dash_session": forged}))


def test_verify_session_accepts_valid_cookie():
    assert dash_auth.verify_session(_Req({"dash_session": _valid_cookie("alice")})) == "alice"


def test_require_auth_rejects_missing_cookie():
    with pytest.raises(HTTPException) as ei:
        dash_auth.require_auth(_Req({}))
    assert ei.value.status_code == 302


def test_require_auth_accepts_valid_cookie():
    assert dash_auth.require_auth(_Req({"dash_session": _valid_cookie("bob")})) == "bob"


# ── passwords: PBKDF2 + legacy verification ──────────────────────────────────
def test_pbkdf2_roundtrip_and_format():
    h = hash_password("S3cr3t-Pass!")
    assert h.startswith("pbkdf2_sha256$")
    assert verify_password("S3cr3t-Pass!", h) is True
    assert verify_password("wrong", h) is False
    assert needs_rehash(h) is False


def test_pbkdf2_salt_is_unique_per_hash():
    # Same password → different stored hash (salted), but both verify.
    a, b = hash_password("same"), hash_password("same")
    assert a != b
    assert verify_password("same", a) and verify_password("same", b)


def test_legacy_hash_still_verifies_and_is_flagged_for_rehash():
    leg = _legacy_hash("S3cr3t-Pass!")
    assert verify_password("S3cr3t-Pass!", leg) is True
    assert verify_password("wrong", leg) is False
    assert needs_rehash(leg) is True


def test_verify_rejects_blank_stored_hash():
    # A row with no/empty hash must never authenticate, for any input.
    assert verify_password("anything", "") is False
    assert verify_password("anything", None) is False
    assert verify_password("", "") is False


def test_needs_rehash_on_missing_or_low_iterations():
    assert needs_rehash(None) is True
    assert needs_rehash("") is True
    # A PBKDF2 hash with fewer iterations than we now use should be re-hashed.
    assert needs_rehash("pbkdf2_sha256$1000$abcd$ef01") is True
