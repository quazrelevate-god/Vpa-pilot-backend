"""
Events PWA authentication (RBAC-backed).

Every events user is a row in the `login` table with at least one events
capability role (event_uploader and/or event_reviewer). The single shared
env credential (EVENTS_USERNAME / EVENTS_PASSWORD) is GONE — real users only.

Cookie carries the `login_id` signed with SECRET_KEY. Every request re-fetches
the Login row + capability roles from the DB so role revocation / deactivation
is effective immediately — no waiting out a stale 12-hour cookie.

The UI lives in the Next.js PA portal (route group /events), so auth is
JSON-based: the login endpoint returns 200/401 (not a redirect) and the data
endpoints return 401 when the cookie is missing/expired — never a 302, or the
browser fetch() would silently follow it and get the login HTML instead of JSON.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Request
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.models.login_models import (
    ALL_EVENT_ROLES,
    Login,
    ROLE_EVENT_REVIEWER,
    ROLE_EVENT_UPLOADER,
    hash_password,
    needs_rehash,
    verify_password,
)

_COOKIE_NAME = "events_session"
_COOKIE_MAX_AGE = 12 * 3600  # 12 hours
_signer = TimestampSigner(settings.SECRET_KEY)


# ── Cookie helpers ────────────────────────────────────────────────────────────

def create_events_cookie(response, login_id: int) -> None:
    token = _signer.sign(str(login_id)).decode()
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.COOKIE_SECURE,
    )


def clear_events_cookie(response) -> None:
    response.delete_cookie(_COOKIE_NAME)


def _login_id_from_cookie(request: Request) -> Optional[int]:
    """Return the signed login_id from the events cookie, or None. Never raises."""
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        return None
    try:
        raw = _signer.unsign(token, max_age=_COOKIE_MAX_AGE).decode()
    except (BadSignature, SignatureExpired):
        return None
    try:
        return int(raw)
    except ValueError:
        return None


# ── Credential verification (used by the login endpoint) ─────────────────────

async def verify_events_credentials(
    db: AsyncSession, login_name: str, password: str,
) -> Optional[Login]:
    """Return the Login row iff (a) credentials match, (b) account is active,
    and (c) user holds at least one events capability role. Any failure
    returns None — the login endpoint should present ONE generic "invalid"
    message either way, so a caller can't distinguish "no such user" from
    "wrong password" from "you have no events access"."""
    row = (await db.execute(
        select(Login).where(Login.login_name == login_name)
    )).scalar_one_or_none()
    if row is None or not row.is_active:
        return None
    if not verify_password(password, row.password):
        return None
    if needs_rehash(row.password):        # migrate legacy hash → PBKDF2
        row.password = hash_password(password)
        await db.commit()
    if not row.has_any_role(*ALL_EVENT_ROLES):
        return None
    return row


# ── Request-time resolution ──────────────────────────────────────────────────

async def get_events_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Optional[Login]:
    """Resolve the signed-in events user's Login row, or None. Never raises.
    Runs a fresh DB read every request so deactivation / role revocation is
    instant rather than waiting out a stale cookie."""
    lid = _login_id_from_cookie(request)
    if lid is None:
        return None
    row = (await db.execute(
        select(Login).where(Login.id == lid, Login.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    if row is None:
        return None
    # A user whose events capability roles were all removed is treated as
    # logged out — same rule the login endpoint enforces on the way in.
    if not row.has_any_role(*ALL_EVENT_ROLES):
        return None
    return row


async def require_events_api(
    login: Optional[Login] = Depends(get_events_login),
) -> Login:
    """Dependency for /events/api/* — 401 (JSON) when not authenticated.
    Handlers receive the full Login row so they can read roles / login_name /
    id without re-querying."""
    if login is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return login


def require_events_role(*required: str):
    """Factory: FastAPI dep that ensures the caller has at least one of the
    required capability roles. 403 if authenticated but under-privileged;
    401 falls through from require_events_api if not authenticated at all."""
    async def _dep(login: Login = Depends(require_events_api)) -> Login:
        if not login.has_any_role(*required):
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {' | '.join(required)}",
            )
        return login
    return _dep


# Convenience shorthands used by the endpoints. Reviewer is a superset —
# anywhere upload is allowed, review is allowed too, so require_events_upload
# accepts either role.
require_events_upload = require_events_role(ROLE_EVENT_UPLOADER, ROLE_EVENT_REVIEWER)
require_events_review = require_events_role(ROLE_EVENT_REVIEWER)
