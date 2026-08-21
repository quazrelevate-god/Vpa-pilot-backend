"""
Minister PWA authentication — a dedicated, ISOLATED read-only session.

The Minister's PA carries one installable app that shows every desk at a glance
(petitions, proposals, tickets, associations, events). It must NOT be able to
touch the staff portal. So it gets its own cookie (`minister_session`) and its
own credential (a `Login` row with role=minister, env-seeded on first sign-in).

Isolation guarantees:
  * `minister_session` is the only cookie this app ever receives — every portal
    endpoint checks `dash_session` / super-admin, which a minister never has.
  * `unified_login` (the staff sign-in) explicitly refuses a role=minister
    account, so the credential can't obtain a `dash_session` even by trying.
  * The `/minister/api/*` namespace exposes read-only GET aggregates only.

Mirrors the events_auth pattern: cookie carries the signed `login_id`; every
request re-reads the Login row so deactivation / role change is instant. JSON
auth (401, never a 302) so the Next.js PWA's fetch() gets JSON, not login HTML.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Request
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import check_env_credentials, settings
from src.core.database import get_db
from src.models.login_models import (
    Login,
    ROLE_MINISTER,
    hash_password,
    needs_rehash,
    verify_password,
)

_COOKIE_NAME = "minister_session"
_COOKIE_MAX_AGE = 12 * 3600  # 12 hours
_signer = TimestampSigner(settings.SECRET_KEY)


# ── Cookie helpers ────────────────────────────────────────────────────────────

def create_minister_cookie(response, login_id: int) -> None:
    token = _signer.sign(str(login_id)).decode()
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.COOKIE_SECURE,
    )


def clear_minister_cookie(response) -> None:
    response.delete_cookie(_COOKIE_NAME)


def _login_id_from_cookie(request: Request) -> Optional[int]:
    """Return the signed login_id from the minister cookie, or None. Never raises."""
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


# ── Env-seed (mirrors rbac.ensure_env_admin_seeded) ──────────────────────────

async def ensure_minister_seeded(db: AsyncSession, username: str) -> Login:
    """Upsert the env-configured Minister account (role=minister). Idempotent —
    creates the row on first sign-in, and self-heals role/active/password on
    every sign-in so a mistaken flip corrects itself. Zero SSH."""
    row = (await db.execute(
        select(Login).where(Login.login_name == username)
    )).scalar_one_or_none()

    if row is None:
        row = Login(
            login_name=username,
            password=hash_password(settings.MINISTER_PASSWORD),
            full_name="Minister",
            role=ROLE_MINISTER,
            is_active=True,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row

    changed = False
    if row.role != ROLE_MINISTER or not row.is_active:
        row.role = ROLE_MINISTER
        row.is_active = True
        row.password = hash_password(settings.MINISTER_PASSWORD)
        changed = True
    if changed:
        await db.commit()
        await db.refresh(row)
    return row


# ── Credential verification (used by the login endpoint) ─────────────────────

async def verify_minister_credentials(
    db: AsyncSession, login_name: str, password: str,
) -> Optional[Login]:
    """Return the Login row iff the credentials are valid for a MINISTER account.

    Two paths, mirroring the env-admin bootstrap:
      1. Env credential (MINISTER_USERNAME / MINISTER_PASSWORD) → seed + return.
      2. An existing role=minister row with a matching password.
    Any failure returns None so the caller shows one generic 'invalid' message.
    """
    uname = (login_name or "").strip()

    # 1) Env bootstrap credential.
    if check_env_credentials(uname, password, settings.MINISTER_USERNAME, settings.MINISTER_PASSWORD):
        return await ensure_minister_seeded(db, uname)

    # 2) A real role=minister row.
    row = (await db.execute(
        select(Login).where(Login.login_name == uname)
    )).scalar_one_or_none()
    # Always call verify_password (even with None) so unknown-username and
    # wrong-password branches take the same time. Only THEN branch on the row.
    ok = verify_password(password, row.password if row else None)
    if row is None or not row.is_active or not ok:
        return None
    if needs_rehash(row.password):          # migrate legacy hash → PBKDF2
        row.password = hash_password(password)
        await db.commit()
    if row.role != ROLE_MINISTER:
        return None
    return row


# ── Request-time resolution ──────────────────────────────────────────────────

async def get_minister_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Optional[Login]:
    """Resolve the signed-in Minister's Login row, or None. Never raises. Fresh
    DB read every request so deactivation / role change is instant."""
    lid = _login_id_from_cookie(request)
    if lid is None:
        return None
    row = (await db.execute(
        select(Login).where(Login.id == lid, Login.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    if row is None or row.role != ROLE_MINISTER:
        return None
    return row


async def require_minister(
    login: Optional[Login] = Depends(get_minister_login),
) -> Login:
    """Dependency for /minister/api/* — 401 (JSON) when not authenticated."""
    if login is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return login
