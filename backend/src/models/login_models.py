"""
Login / RBAC (v2).

Owns the `login` table referenced by ticket.assigned_to and the future PA/user
RBAC surface. Lives on the main declarative Base so cross-table FKs
(ticket.assigned_to → login.id) resolve at mapper configuration time.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.core.database import Base
from src.core.config import settings


# Primary dashboard role (the coarse RBAC axis for the PA portal). One-per-user
# by design — a user *acts* as one persona on the dashboard. Capability roles
# (e.g. events access) live in the separate `user_roles` table below so they
# can stack independently.
ROLE_SUPER_ADMIN       = "super_admin"
ROLE_PA                = "pa"
ROLE_DEPT_OFFICER      = "dept_officer"
ROLE_PETITION_REVIEWER = "petition_reviewer"
ROLE_AUDITOR           = "auditor"

ALL_ROLES = (ROLE_SUPER_ADMIN, ROLE_PA, ROLE_DEPT_OFFICER, ROLE_PETITION_REVIEWER, ROLE_AUDITOR)


# Capability roles — additive, many-per-user. Populate the `user_roles` table.
# The events PWA is the first surface to consume them; the frontend admin form
# renders them as independent checkboxes.
ROLE_EVENT_UPLOADER    = "event_uploader"
ROLE_EVENT_REVIEWER    = "event_reviewer"

ALL_EVENT_ROLES = (ROLE_EVENT_UPLOADER, ROLE_EVENT_REVIEWER)
# The complete set the admin form is allowed to grant. Extend here when a new
# capability role is introduced — nothing else in the code needs to know.
ALL_CAPABILITY_ROLES = ALL_EVENT_ROLES


def hash_password(password: str) -> str:
    """HMAC-SHA256 keyed on SECRET_KEY — matches the department_account bar."""
    return hmac.new(settings.SECRET_KEY.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(hash_password(password), password_hash or "")


class Login(Base):
    __tablename__ = "login"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    login_name = Column(String(100), nullable=False, unique=True)
    password   = Column(String(255), nullable=False, comment="HMAC-SHA256 hash")
    email      = Column(String(255), nullable=True)
    full_name  = Column(String(200), nullable=True)
    role       = Column(String(30), nullable=False, server_default=ROLE_PA,
                        comment=f"one of: {', '.join(ALL_ROLES)}")
    scope      = Column(
        JSONB, nullable=False, server_default="{}",
        comment="fine-grained permissions object (e.g. {department: 'scert'} for dept officers)",
    )
    is_active  = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Capability roles — many-to-many. Eager-loaded because every request that
    # resolves a Login (events auth, dashboard rbac) needs the role set to
    # decide access; a lazy load would fire a follow-up query per request.
    capability_roles = relationship(
        "UserRole",
        back_populates="login",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def role_set(self) -> set[str]:
        """All roles this user holds — primary role + capability roles. Use
        this for authorization checks so downstream code never has to know
        which column a role came from."""
        roles = {self.role} if self.role else set()
        roles.update(r.role for r in (self.capability_roles or []))
        return roles

    def has_role(self, role: str) -> bool:
        return role in self.role_set()

    def has_any_role(self, *roles: str) -> bool:
        rs = self.role_set()
        return any(r in rs for r in roles)


class UserRole(Base):
    """One row per (user, capability_role). See ALL_CAPABILITY_ROLES for the
    allowed values — validation lives at the admin API boundary, not here,
    to keep this model reusable for future roles without a schema change."""
    __tablename__ = "user_roles"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    login_id   = Column(BigInteger, ForeignKey("login.id", ondelete="CASCADE"), nullable=False, index=True)
    role       = Column(String(40), nullable=False, index=True,
                        comment="capability role — e.g. event_uploader, event_reviewer")
    granted_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    login = relationship("Login", back_populates="capability_roles")

    __table_args__ = (
        UniqueConstraint("login_id", "role", name="uq_user_roles_login_role"),
    )
