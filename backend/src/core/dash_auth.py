"""
Simple signed-cookie session auth for the staff dashboard.
No JWT, no DB users — credentials come from .env (DASHBOARD_USERNAME / DASHBOARD_PASSWORD).
"""
from fastapi import Request, HTTPException
from fastapi.responses import RedirectResponse
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired

from src.core.config import settings

_COOKIE_NAME = "dash_session"
_COOKIE_MAX_AGE = 8 * 3600  # 8 hours
_signer = TimestampSigner(settings.SECRET_KEY)


def create_session_cookie(response, username: str):
    token = _signer.sign(username).decode()
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
    )


def verify_session(request: Request) -> str:
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=302, headers={"Location": "/auth/login"})
    try:
        username = _signer.unsign(token, max_age=_COOKIE_MAX_AGE).decode()
        return username
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=302, headers={"Location": "/auth/login"})


def require_auth(request: Request) -> str:
    """Dependency — redirect to login if not authenticated."""
    try:
        return verify_session(request)
    except HTTPException:
        # Return redirect instead of raising so Depends works cleanly
        raise HTTPException(status_code=302, headers={"Location": "/auth/login"})
