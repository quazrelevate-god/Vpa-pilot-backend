"""
Super-admin Settings API — users, departments (registry), ministries, dept-account
password reset.

Every endpoint requires:
  1. FEATURE_SUPERADMIN_UI = true (dark-launch flag)
  2. Authenticated session (dash_session cookie)
  3. login.role == 'super_admin'

Public shape is deliberately small — the intent is to expose the SEED of the
future RBAC surface, not the entire office admin domain.
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.rbac import (
    require_super_admin,
    require_feature_superadmin_ui,
    get_current_login,
)
from src.models.login_models import (
    Login,
    ROLE_SUPER_ADMIN, ROLE_PA, ROLE_DEPT_OFFICER, ROLE_AUDITOR, ALL_ROLES,
    ALL_CAPABILITY_ROLES,
    UserRole,
    hash_password,
)
from src.models.registry_models import DepartmentRegistry, MinistryRegistry, VenueRegistry
from src.models.department_account import DepartmentAccount, hash_password as dept_hash


router = APIRouter(
    prefix="/api/v1/admin",
    tags=["Admin — Settings"],
    dependencies=[Depends(require_feature_superadmin_ui), Depends(require_super_admin)],
)

# The /me endpoint is the ONE public admin-namespace hit that doesn't need
# super_admin — it tells the PA portal which user is logged in + which role
# so it can show/hide the Settings nav item without a 403 round-trip.
public_router = APIRouter(prefix="/api/v1", tags=["Session"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class UserRow(BaseModel):
    id: int
    login_name: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: str
    department: Optional[str] = None   # for dept officers — from scope.department
    # Additive capability roles (e.g. event_uploader, event_reviewer). Rendered
    # as independent checkboxes on the admin user form; stored in user_roles.
    capability_roles: list[str] = []
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    login_name: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=6, max_length=200)
    full_name: Optional[str] = Field(default=None, max_length=200)
    email: Optional[EmailStr] = None
    role: str = Field(default=ROLE_PA)
    department: Optional[str] = Field(default=None, max_length=60,
                                      description="Required when role=dept_officer — scopes them to one department.")
    capability_roles: list[str] = Field(default_factory=list,
                                        description="Additive capability roles: event_uploader, event_reviewer.")


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    department: Optional[str] = Field(default=None, max_length=60)
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6, max_length=200)
    # Nullable to distinguish "not sent" from "explicitly empty list". When
    # provided, replaces the full capability-role set for this user.
    capability_roles: Optional[list[str]] = None


class DepartmentRow(BaseModel):
    id: int
    key: str
    display_en: str
    display_ta: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    is_builtin: bool


class DepartmentCreate(BaseModel):
    key: str = Field(min_length=3, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")
    display_en: str = Field(min_length=2, max_length=200)
    display_ta: Optional[str] = Field(default=None, max_length=200)
    email: Optional[EmailStr] = None


class DepartmentUpdate(BaseModel):
    display_en: Optional[str] = Field(default=None, max_length=200)
    display_ta: Optional[str] = Field(default=None, max_length=200)
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None


class MinistryRow(BaseModel):
    id: int
    key: str
    display_en: str
    display_ta: Optional[str] = None
    email: Optional[str] = None
    is_active: bool


class MinistryUpdate(BaseModel):
    email: Optional[EmailStr] = None
    display_ta: Optional[str] = Field(default=None, max_length=200)
    is_active: Optional[bool] = None


class VenueRow(BaseModel):
    id: int
    key: str
    display_en: str
    display_ta: Optional[str] = None
    address: Optional[str] = None
    is_active: bool
    is_builtin: bool


class VenueCreate(BaseModel):
    key: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9][a-z0-9_]*$",
                     description="Stable id used in the QR display URL (?venue_id=...).")
    display_en: str = Field(min_length=2, max_length=200)
    display_ta: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=400)


class VenueUpdate(BaseModel):
    display_en: Optional[str] = Field(default=None, max_length=200)
    display_ta: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=400)
    is_active: Optional[bool] = None


class DeptAccountRow(BaseModel):
    id: int
    department: str
    username: str
    display_name: Optional[str] = None


class DeptAccountCreated(DeptAccountRow):
    """Create response — the row plus the one-time plaintext password.

    This needs its own model: FastAPI filters the handler's return value
    through `response_model`, so declaring `DeptAccountRow` there silently
    dropped the `initial_password` key and the UI showed "undefined".
    """
    initial_password: str


class DeptAccountCreate(BaseModel):
    department: str
    username: str = Field(min_length=3, max_length=60)
    display_name: Optional[str] = Field(default=None, max_length=150)


class DeptPasswordReset(BaseModel):
    password: Optional[str] = Field(default=None, min_length=8, max_length=200,
                                    description="If omitted, server generates one and returns it.")


# ── /me — role probe for the frontend ────────────────────────────────────────

@public_router.get("/me")
async def me(current: Login = Depends(get_current_login)) -> dict:
    return {
        "id": current.id,
        "login_name": current.login_name,
        "full_name": current.full_name,
        "email": current.email,
        "role": current.role,
        "department": (current.scope or {}).get("department"),
    }


# ── /admin/features — expose flag state so the FE can render Settings ────────

@public_router.get("/features")
async def features() -> dict:
    from src.core.config import settings
    return {"superadmin_ui": settings.FEATURE_SUPERADMIN_UI}


# ── /departments — read-only registry for the ticket / review dropdowns ──────
# Any authenticated user (PA, reviewer, dept staff) can list active departments;
# they need the current names to assign a ticket or filter their queue. Writes
# stay under /admin/departments (super-admin only).
@public_router.get("/departments")
async def list_active_departments(
    _current: Login = Depends(get_current_login),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = (await db.execute(
        select(DepartmentRegistry)
        .where(DepartmentRegistry.is_active.is_(True))
        .order_by(DepartmentRegistry.is_builtin.desc(), DepartmentRegistry.display_en)
    )).scalars().all()
    return [
        {"key": r.key, "display_en": r.display_en, "display_ta": r.display_ta}
        for r in rows
    ]


# ── Users ────────────────────────────────────────────────────────────────────

def _user_row(r: Login) -> UserRow:
    """Build the wire shape explicitly. Cannot use model_validate(from_attributes=
    True) because Pydantic would try to read `r.capability_roles` — a list of
    UserRole ORM objects — into the `list[str]` field and 500 the request. This
    is also cheaper: no reflection, and the field list here doubles as the
    single place that documents what the admin API exposes."""
    return UserRow(
        id=r.id,
        login_name=r.login_name,
        full_name=r.full_name,
        email=r.email,
        role=r.role,
        department=(r.scope or {}).get("department"),
        # capability_roles is eager-loaded via Login.capability_roles (selectin);
        # sort for stable UI ordering across responses.
        capability_roles=sorted(cr.role for cr in (r.capability_roles or [])),
        is_active=r.is_active,
        created_at=r.created_at,
    )


def _validate_capability_roles(roles: list[str]) -> list[str]:
    """Reject unknown role names + dedupe. Empty list is valid (no capabilities)."""
    seen: set[str] = set()
    out: list[str] = []
    for role in roles:
        if role not in ALL_CAPABILITY_ROLES:
            raise HTTPException(422, f"Unknown capability role: {role}")
        if role in seen:
            continue
        seen.add(role)
        out.append(role)
    return out


async def _sync_capability_roles(db: AsyncSession, login_id: int, roles: list[str]) -> None:
    """Replace this user's capability roles with the given set. Deletes rows
    for roles no longer granted; inserts rows for newly granted roles; leaves
    unchanged rows alone (so granted_at is preserved as an audit trail)."""
    existing = (await db.execute(
        select(UserRole).where(UserRole.login_id == login_id)
    )).scalars().all()
    have = {r.role: r for r in existing}
    want = set(roles)
    for role, row in have.items():
        if role not in want:
            await db.delete(row)
    for role in want - have.keys():
        db.add(UserRole(login_id=login_id, role=role))


@router.get("/users", response_model=list[UserRow])
async def list_users(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Login).order_by(Login.id))).scalars().all()
    return [_user_row(r) for r in rows]


@router.post("/users", response_model=UserRow, status_code=201)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    if body.role not in ALL_ROLES:
        raise HTTPException(422, f"Unknown role. Must be one of: {', '.join(ALL_ROLES)}")

    existing = await db.scalar(select(Login).where(Login.login_name == body.login_name))
    if existing:
        raise HTTPException(409, f"Username '{body.login_name}' already exists.")

    scope: dict = {}
    if body.role == ROLE_DEPT_OFFICER:
        if not body.department:
            raise HTTPException(422, "A department is required for a department officer.")
        scope = {"department": body.department}

    capability_roles = _validate_capability_roles(body.capability_roles)

    row = Login(
        login_name=body.login_name,
        password=hash_password(body.password),
        full_name=body.full_name,
        email=body.email,
        role=body.role,
        scope=scope,
        is_active=True,
    )
    db.add(row)
    await db.flush()  # need row.id before we can insert user_roles
    for role in capability_roles:
        db.add(UserRole(login_id=row.id, role=role))
    await db.commit()
    await db.refresh(row)
    return _user_row(row)


@router.patch("/users/{user_id}", response_model=UserRow)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
):
    row = await db.get(Login, user_id)
    if not row:
        raise HTTPException(404, "User not found.")

    if body.role is not None and body.role not in ALL_ROLES:
        raise HTTPException(422, f"Unknown role.")

    # Refuse to demote the last active super_admin — otherwise we lock ourselves out.
    if body.role and body.role != ROLE_SUPER_ADMIN and row.role == ROLE_SUPER_ADMIN:
        count = await db.scalar(
            select(Login.id).where(
                Login.role == ROLE_SUPER_ADMIN, Login.is_active == True  # noqa: E712
            ).order_by(Login.id).limit(2)
        )
        # A rough count — pull both to see if there are 2+
        rows = (await db.execute(
            select(Login.id).where(Login.role == ROLE_SUPER_ADMIN, Login.is_active == True)  # noqa: E712
        )).scalars().all()
        if len(rows) <= 1:
            raise HTTPException(409, "Refusing to demote the last active super admin.")

    if body.is_active is False and row.id == current.id:
        raise HTTPException(409, "You can't deactivate yourself.")

    if body.full_name is not None: row.full_name = body.full_name
    if body.email is not None:      row.email = body.email
    if body.role is not None:       row.role = body.role
    if body.is_active is not None:  row.is_active = body.is_active
    if body.password:               row.password = hash_password(body.password)
    if body.capability_roles is not None:
        await _sync_capability_roles(
            db, row.id, _validate_capability_roles(body.capability_roles),
        )

    # Department scope follows the (possibly updated) role.
    if row.role == ROLE_DEPT_OFFICER:
        dept = body.department if body.department is not None else (row.scope or {}).get("department")
        if not dept:
            raise HTTPException(422, "A department is required for a department officer.")
        row.scope = {"department": dept}
    else:
        row.scope = {}

    await db.commit()
    await db.refresh(row)
    return _user_row(row)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
):
    row = await db.get(Login, user_id)
    if not row:
        raise HTTPException(404, "User not found.")
    if row.id == current.id:
        raise HTTPException(409, "You can't delete yourself.")
    # Soft-delete pattern: flip is_active off. Preserves audit history.
    row.is_active = False
    await db.commit()


# ── Venues ───────────────────────────────────────────────────────────────────

@router.get("/venues", response_model=list[VenueRow])
async def list_venues(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(VenueRegistry).order_by(VenueRegistry.is_builtin.desc(), VenueRegistry.display_en)
    )).scalars().all()
    return [VenueRow.model_validate(r, from_attributes=True) for r in rows]


@router.post("/venues", response_model=VenueRow, status_code=201)
async def create_venue(
    body: VenueCreate,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
):
    existing = await db.scalar(select(VenueRegistry).where(VenueRegistry.key == body.key))
    if existing:
        raise HTTPException(409, f"Venue id '{body.key}' already exists.")
    row = VenueRegistry(
        key=body.key,
        display_en=body.display_en,
        display_ta=body.display_ta,
        address=body.address,
        is_active=True,
        is_builtin=False,
        created_by=current.login_name,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return VenueRow.model_validate(row, from_attributes=True)


@router.patch("/venues/{venue_id}", response_model=VenueRow)
async def update_venue(venue_id: int, body: VenueUpdate, db: AsyncSession = Depends(get_db)):
    row = await db.get(VenueRegistry, venue_id)
    if not row:
        raise HTTPException(404, "Venue not found.")
    if body.display_en is not None: row.display_en = body.display_en
    if body.display_ta is not None: row.display_ta = body.display_ta
    if body.address is not None:    row.address = body.address
    if body.is_active is not None:  row.is_active = body.is_active
    await db.commit()
    await db.refresh(row)
    return VenueRow.model_validate(row, from_attributes=True)


# ── Departments ──────────────────────────────────────────────────────────────

@router.get("/departments", response_model=list[DepartmentRow])
async def list_departments(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(DepartmentRegistry).order_by(DepartmentRegistry.is_builtin.desc(),
                                            DepartmentRegistry.display_en)
    )).scalars().all()
    return [DepartmentRow.model_validate(r, from_attributes=True) for r in rows]


@router.post("/departments", response_model=DepartmentRow, status_code=201)
async def create_department(
    body: DepartmentCreate,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
):
    existing = await db.scalar(select(DepartmentRegistry).where(DepartmentRegistry.key == body.key))
    if existing:
        raise HTTPException(409, f"Department key '{body.key}' already exists.")
    row = DepartmentRegistry(
        key=body.key,
        display_en=body.display_en,
        display_ta=body.display_ta,
        email=body.email,
        is_active=True,
        is_builtin=False,
        created_by=current.login_name,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DepartmentRow.model_validate(row, from_attributes=True)


@router.patch("/departments/{dept_id}", response_model=DepartmentRow)
async def update_department(
    dept_id: int, body: DepartmentUpdate, db: AsyncSession = Depends(get_db)
):
    row = await db.get(DepartmentRegistry, dept_id)
    if not row:
        raise HTTPException(404, "Department not found.")
    if body.display_en is not None: row.display_en = body.display_en
    if body.display_ta is not None: row.display_ta = body.display_ta
    if body.email is not None:      row.email = body.email
    if body.is_active is not None:
        # Builtin can be deactivated but not deleted; still respect the flag.
        row.is_active = body.is_active
    await db.commit()
    await db.refresh(row)
    return DepartmentRow.model_validate(row, from_attributes=True)


@router.delete("/departments/{dept_id}", status_code=204)
async def delete_department(
    dept_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Hard-delete a custom department. Built-in (seeded) departments cannot be
    deleted — deactivate them via PATCH is_active=false instead, so historical
    tickets that reference the key still resolve their label.
    """
    row = await db.get(DepartmentRegistry, dept_id)
    if not row:
        raise HTTPException(404, "Department not found.")
    if row.is_builtin:
        raise HTTPException(
            409, "Built-in departments can't be deleted. Deactivate them instead.",
        )
    # Also delete any dept_account tied to this department key so we don't
    # leave an orphaned login pointing at a non-existent department.
    await db.execute(
        DepartmentAccount.__table__.delete().where(
            DepartmentAccount.department == row.key,
        )
    )
    await db.delete(row)
    await db.commit()


# ── Ministries — edit-only ───────────────────────────────────────────────────

@router.get("/ministries", response_model=list[MinistryRow])
async def list_ministries(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(MinistryRegistry).order_by(MinistryRegistry.display_en)
    )).scalars().all()
    return [MinistryRow.model_validate(r, from_attributes=True) for r in rows]


@router.patch("/ministries/{ministry_id}", response_model=MinistryRow)
async def update_ministry(
    ministry_id: int, body: MinistryUpdate, db: AsyncSession = Depends(get_db)
):
    row = await db.get(MinistryRegistry, ministry_id)
    if not row:
        raise HTTPException(404, "Ministry not found.")
    if body.email is not None:      row.email = body.email
    if body.display_ta is not None: row.display_ta = body.display_ta
    if body.is_active is not None:  row.is_active = body.is_active
    await db.commit()
    await db.refresh(row)
    return MinistryRow.model_validate(row, from_attributes=True)


# ── Department shared logins ─────────────────────────────────────────────────

@router.get("/dept-accounts", response_model=list[DeptAccountRow])
async def list_dept_accounts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(DepartmentAccount).order_by(DepartmentAccount.department)
    )).scalars().all()
    return [DeptAccountRow.model_validate(r, from_attributes=True) for r in rows]


@router.post("/dept-accounts", response_model=DeptAccountCreated, status_code=201)
async def create_dept_account(
    body: DeptAccountCreate,
    db: AsyncSession = Depends(get_db),
):
    # One account per department — enforced by the unique index on department.
    existing = await db.scalar(
        select(DepartmentAccount).where(DepartmentAccount.department == body.department)
    )
    if existing:
        raise HTTPException(409, f"An account for department '{body.department}' already exists.")
    existing_u = await db.scalar(
        select(DepartmentAccount).where(DepartmentAccount.username == body.username)
    )
    if existing_u:
        raise HTTPException(409, f"Username '{body.username}' is already taken.")

    initial = _random_password()
    row = DepartmentAccount(
        department=body.department,
        username=body.username,
        password_hash=dept_hash(initial),
        display_name=body.display_name,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    # Attach the plaintext initial password to the response body so the super
    # admin can hand it to the department. Ephemeral: never stored, never
    # retrievable later.
    # SECURITY (P1-11): this response body contains a plaintext credential.
    # NEVER logger.*() a /api/v1/admin/* response, and never echo `initial`
    # into a URL/query string. If a "resend" flow is ever needed, issue a
    # signed one-time reveal URL rather than returning the password again.
    return {**DeptAccountRow.model_validate(row, from_attributes=True).model_dump(),
            "initial_password": initial}


@router.delete("/dept-accounts/{account_id}", status_code=204)
async def delete_dept_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Remove a department shared login. Use when a department is closed or the
    account needs to be recreated with a different username.
    """
    row = await db.get(DepartmentAccount, account_id)
    if not row:
        raise HTTPException(404, "Account not found.")
    await db.delete(row)
    await db.commit()


@router.post("/dept-accounts/{dept_key}/reset-password")
async def reset_dept_password(
    dept_key: str,
    body: DeptPasswordReset,
    db: AsyncSession = Depends(get_db),
):
    row = await db.scalar(
        select(DepartmentAccount).where(DepartmentAccount.department == dept_key)
    )
    if not row:
        raise HTTPException(404, "No account for that department.")
    new_password = body.password or _random_password()
    row.password_hash = dept_hash(new_password)
    await db.commit()
    # Return the plaintext once so the super admin can copy it to the dept.
    return {
        "department": dept_key,
        "username": row.username,
        "password": new_password,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _random_password(length: int = 12) -> str:
    """Pronounceable-ish random: 12 chars mixing letters + digits, no ambiguous chars."""
    alphabet = string.ascii_letters + string.digits
    # Strip the eye-strain characters that confuse people on printouts.
    alphabet = "".join(c for c in alphabet if c not in "0OIl1")
    return "".join(secrets.choice(alphabet) for _ in range(length))
