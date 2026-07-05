"""
Login / RBAC (v2).

Owns the `login` table referenced by ticket.assigned_to and the future PA/user
RBAC surface. Lives on the main declarative Base so cross-table FKs
(ticket.assigned_to → login.id) resolve at mapper configuration time.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import JSONB

from src.core.database import Base


class Login(Base):
    __tablename__ = "login"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    login_name = Column(String(100), nullable=False, unique=True)
    password   = Column(String(255), nullable=False, comment="argon2/bcrypt hash")
    scope      = Column(
        JSONB, nullable=False, server_default="{}",
        comment="permissions / roles object",
    )
    is_active  = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
