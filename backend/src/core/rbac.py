"""
RBAC layer on top of dash_auth.

`require_super_admin` gates the /api/v1/admin/* endpoints and the Settings UI.
`ensure_env_admin_seeded` upserts the env-configured admin (DASHBOARD_USERNAME /
DASHBOARD_PASSWORD) into the `login` table with role=super_admin the first time
they successfully log in — so we get a real user_id on every downstream audit
row without the office team having to run any shell commands.

Design decisions
----------------
- The env admin stays a valid credential even after seeding, so if the DB row
  ever gets deleted or the deployment is refreshed, the operator just logs in
  again and the row is re-created. Zero SSH.
- Only the *login_name* + *role* are upserted from env — the display name /
  email get filled from the Settings UI when the human first edits them.
- Role check is on `login.role` (the coarse axis). Fine-grained perms live on
  `login.scope` for later.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.dash_auth import require_auth
from src.models.login_models import (
    Login,
    ROLE_SUPER_ADMIN,
    hash_password,
)

logger = logging.getLogger(__name__)


# ── Env admin seed ───────────────────────────────────────────────────────────

async def ensure_env_admin_seeded(db: AsyncSession, username: str) -> Login:
    """
    Called from the login handler after we've verified the env credentials.
    Idempotent — creates the login row on first sign-in, updates
    role=super_admin on every sign-in (so a role that got flipped by mistake
    self-heals for the env admin).
    """
    row = (await db.execute(
        select(Login).where(Login.login_name == username)
    )).scalar_one_or_none()

    if row is None:
        row = Login(
            login_name=username,
            password=hash_password(settings.DASHBOARD_PASSWORD),
            full_name="Platform Administrator",
            role=ROLE_SUPER_ADMIN,
            is_active=True,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        logger.info("[RBAC] seeded env admin as super_admin (login.id=%s)", row.id)
    else:
        # Self-heal: env admin is always super_admin + active.
        if row.role != ROLE_SUPER_ADMIN or not row.is_active:
            row.role = ROLE_SUPER_ADMIN
            row.is_active = True
            # Also re-sync password in case env value changed.
            row.password = hash_password(settings.DASHBOARD_PASSWORD)
            await db.commit()
            await db.refresh(row)
            logger.info("[RBAC] restored env admin to super_admin (login.id=%s)", row.id)

    return row


# ── Resolve the current login row from the session cookie ────────────────────

async def get_current_login(
    request: Request,
    username: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> Login:
    """
    Look up the `Login` row for the currently-authenticated user. Raises 401
    if the row does not exist — that shouldn't happen for the env admin
    (seeded on login) but could happen for a disabled account.
    """
    row = (await db.execute(
        select(Login).where(Login.login_name == username, Login.is_active == True)  # noqa: E712
    )).scalar_one_or_none()

    if row is None:
        raise HTTPException(status_code=401, detail="Account not found or disabled.")

    return row


# ── Role guards ──────────────────────────────────────────────────────────────

def require_role(*allowed: str):
    """Factory: FastAPI dep that ensures the caller has one of the allowed roles."""
    async def _dep(current: Login = Depends(get_current_login)) -> Login:
        if current.role not in allowed:
            raise HTTPException(status_code=403, detail=f"Requires role: {' | '.join(allowed)}")
        return current
    return _dep


async def require_super_admin(current: Login = Depends(get_current_login)) -> Login:
    if current.role != ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin access required.")
    return current


# ── Feature flag ─────────────────────────────────────────────────────────────

async def require_feature_superadmin_ui() -> None:
    if not settings.FEATURE_SUPERADMIN_UI:
        raise HTTPException(status_code=404, detail="Not found.")
