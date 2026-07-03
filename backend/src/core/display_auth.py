"""
Simple signed-cookie session auth for the Crowd Management app.
Separate cookie name from the dashboard auth so sessions are independent.

The UI now lives in the Next.js PA portal (route group /crowd), so auth is
JSON-based: the login endpoint returns 200/401 (not a redirect) and the data
endpoints return 401 when the cookie is missing/expired — never a 302, or the
browser fetch() would silently follow it and get the login HTML instead of JSON.
"""
from typing import Optional

from fastapi import Request, HTTPException
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired

from src.core.config import settings

_COOKIE_NAME = "display_session"
_COOKIE_MAX_AGE = 12 * 3600  # 12 hours
_signer = TimestampSigner(settings.SECRET_KEY)


def create_display_cookie(response, username: str):
    token = _signer.sign(username).decode()
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.COOKIE_SECURE,
    )


def clear_display_cookie(response):
    response.delete_cookie(_COOKIE_NAME)


def get_display_user(request: Request) -> Optional[str]:
    """Return the signed-in floor username, or None. Never raises."""
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        return None
    try:
        return _signer.unsign(token, max_age=_COOKIE_MAX_AGE).decode()
    except (BadSignature, SignatureExpired):
        return None


def require_display_api(request: Request) -> str:
    """Dependency for /crowd/api/* — 401 (JSON) when not authenticated."""
    user = get_display_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user
