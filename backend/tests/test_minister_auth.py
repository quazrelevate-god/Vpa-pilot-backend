"""Unit tests for the Minister PWA auth core (`src.core.minister_auth`).

Pure — no DB. Covers the cookie sign/verify round-trip, tamper rejection, and
the `require_minister` 401 gate. The end-to-end 401/200/403 behaviour is proven
by the live smoke test; these lock the crypto + gate logic in isolation.
"""
from __future__ import annotations

import types

import pytest
from fastapi import HTTPException

from src.core import minister_auth
from src.core.minister_auth import (
    _login_id_from_cookie,
    create_minister_cookie,
    require_minister,
)

_COOKIE = "minister_session"


class _FakeResponse:
    """Captures the single set_cookie call create_minister_cookie makes."""
    def __init__(self):
        self.cookies: dict[str, str] = {}

    def set_cookie(self, key, value, **_kw):
        self.cookies[key] = value


def _req_with_cookie(token: str | None):
    """Minimal stand-in for a Starlette Request — only `.cookies` is read."""
    cookies = {_COOKIE: token} if token is not None else {}
    return types.SimpleNamespace(cookies=cookies)


# ── cookie round-trip ─────────────────────────────────────────────────────────
class TestCookieRoundTrip:
    def test_sign_then_unsign_returns_same_id(self):
        resp = _FakeResponse()
        create_minister_cookie(resp, 4242)
        token = resp.cookies[_COOKIE]
        assert token and token != "4242"          # it's signed, not the raw id
        assert _login_id_from_cookie(_req_with_cookie(token)) == 4242

    def test_absent_cookie_is_none(self):
        assert _login_id_from_cookie(_req_with_cookie(None)) is None

    def test_tampered_cookie_is_none(self):
        resp = _FakeResponse()
        create_minister_cookie(resp, 7)
        tampered = resp.cookies[_COOKIE][:-2] + ("aa" if resp.cookies[_COOKIE][-2:] != "aa" else "bb")
        assert _login_id_from_cookie(_req_with_cookie(tampered)) is None

    def test_foreign_signature_is_none(self):
        # A value signed by a different signer must not validate.
        from itsdangerous import TimestampSigner
        bogus = TimestampSigner("some-other-key").sign("7").decode()
        assert _login_id_from_cookie(_req_with_cookie(bogus)) is None


# ── require_minister gate ──────────────────────────────────────────────────────
class TestRequireMinister:
    async def test_none_login_raises_401(self):
        with pytest.raises(HTTPException) as ei:
            await require_minister(login=None)
        assert ei.value.status_code == 401

    async def test_present_login_passes_through(self):
        sentinel = object()
        assert await require_minister(login=sentinel) is sentinel


# ── module wiring sanity ───────────────────────────────────────────────────────
def test_cookie_name_and_maxage():
    assert minister_auth._COOKIE_NAME == "minister_session"
    assert minister_auth._COOKIE_MAX_AGE == 12 * 3600
