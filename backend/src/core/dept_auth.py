"""
Signed-cookie session auth for the department dashboard.

Mirrors dash_auth but the cookie carries the department key, so every
department-scoped API call knows which department is acting.
"""
from fastapi import Request, HTTPException
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired

from src.core.config import settings

_COOKIE_NAME = "dept_session"
_COOKIE_MAX_AGE = 8 * 3600  # 8 hours
_signer = TimestampSigner(settings.SECRET_KEY, salt="department-session")


def create_dept_session_cookie(response, department: str) -> None:
    token = _signer.sign(department).decode()
    response.set_cookie(
        key=_COOKIE_NAME, value=token, max_age=_COOKIE_MAX_AGE,
        httponly=True, samesite="lax", secure=settings.COOKIE_SECURE, path="/",
    )


def clear_dept_session_cookie(response) -> None:
    response.delete_cookie(_COOKIE_NAME, path="/", httponly=True, samesite="lax")


def require_department(request: Request) -> str:
    """Dependency — returns the logged-in department key, or 401."""
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Department login required.")
    try:
        return _signer.unsign(token, max_age=_COOKIE_MAX_AGE).decode()
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
