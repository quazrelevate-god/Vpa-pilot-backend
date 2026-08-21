"""Shared helper for the citizen-intake session cookie.

Before: the QR verify handler redirected to /form/choose?token=<uuid> and
/form?token=<uuid>. The token in the URL leaked in three concrete ways:
  1. On a shared kiosk phone, browser history / back-button restored the
     previous citizen's token — a "session_used" screen at best, a leak at
     worst if the citizen bookmarked / screenshotted.
  2. Same-origin Referer sent the URL (and the token) to every internal
     fetch triggered by the form.
  3. Any URL log (proxy access log, browser telemetry) recorded the token.

After: the QR verify handler sets this HttpOnly cookie and redirects to
/form/choose WITHOUT the query. The form / choose pages read the token
from the cookie (falling back to the query param during rollout, in case
a citizen's browser refuses cookies). Templates still receive the token
via context so the existing submit JS keeps working unchanged.

Cookie policy:
  - Name:     intake_token
  - HttpOnly: True — never exposed to JS on the intake pages.
  - Secure:   settings.COOKIE_SECURE (True in prod, False in local dev).
  - SameSite: "Lax" — needed for the same-origin /verify → /form/choose
              redirect to actually carry the cookie.
  - Path:     "/form" — narrowest possible. Not sent to /api/v1/*, so the
              existing appointment / OTP endpoints keep reading the token
              from the POST body (unchanged surface, small blast radius).
  - Max-Age:  settings.SESSION_EXPIRY_SECONDS — matches the DB row TTL.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Request, Response

from src.core.config import settings

INTAKE_COOKIE_NAME = "intake_token"
_COOKIE_PATH = "/form"


def set_intake_cookie(response: Response, token: str) -> None:
    """Attach the intake_token cookie to a response (typically a RedirectResponse
    from /api/v1/qr/verify). Idempotent — the browser overwrites any prior
    value on the same name+path."""
    response.set_cookie(
        key=INTAKE_COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_EXPIRY_SECONDS,
        path=_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )


def clear_intake_cookie(response: Response) -> None:
    """Remove the intake cookie (e.g. after successful submit, or when the
    session is refused). Must match the exact path used by set_intake_cookie."""
    response.delete_cookie(
        key=INTAKE_COOKIE_NAME,
        path=_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )


def resolve_intake_token(request: Request, query_token: Optional[str]) -> Optional[str]:
    """Prefer the cookie over the query param. During the rollout window we
    still accept ?token= as a fallback — some browsers block third-party-ish
    cookies aggressively, and this keeps the flow working while we migrate.
    Callers should treat an empty/None result the same way as a missing token.
    """
    cookie_val = request.cookies.get(INTAKE_COOKIE_NAME)
    if cookie_val:
        return cookie_val
    if query_token:
        return query_token
    return None
