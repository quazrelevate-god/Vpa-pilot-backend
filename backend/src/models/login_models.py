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

from sqlalchemy import BigInteger, Boolean, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base
from src.core.config import settings


# Roles — the coarse RBAC axis. Fine-grained perms still live on `scope` JSONB.
ROLE_SUPER_ADMIN       = "super_admin"
ROLE_PA                = "pa"
ROLE_DEPT_OFFICER      = "dept_officer"
ROLE_PETITION_REVIEWER = "petition_reviewer"
ROLE_AUDITOR           = "auditor"

ALL_ROLES = (ROLE_SUPER_ADMIN, ROLE_PA, ROLE_DEPT_OFFICER, ROLE_PETITION_REVIEWER, ROLE_AUDITOR)


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
