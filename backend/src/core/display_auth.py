"""
Simple signed-cookie session auth for the display board.
Separate cookie name from the dashboard auth so sessions are independent.
"""
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


def require_display_auth(request: Request) -> str:
    """Dependency — redirect to display login if not authenticated."""
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=302, headers={"Location": "/display/login"})
    try:
        username = _signer.unsign(token, max_age=_COOKIE_MAX_AGE).decode()
        return username
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=302, headers={"Location": "/display/login"})
