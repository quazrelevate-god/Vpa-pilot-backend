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
    kw = dict(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.COOKIE_SECURE,
        path="/",
    )
    # SEC-05: only stamp Domain= when explicitly configured. Host-only is
    # the safer default — a leaked cookie can't be sent to a compromised
    # sub-domain that later gets stood up.
    if settings.COOKIE_DOMAIN:
        kw["domain"] = settings.COOKIE_DOMAIN
    response.set_cookie(**kw)


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
