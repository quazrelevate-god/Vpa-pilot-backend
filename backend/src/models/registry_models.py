"""
Settings-backed registries: department + ministry (v2 · migration 026).

`department_registry` supersedes the SchoolDepartment enum as the source of
truth for labels + email, and lets super-admin add custom departments beyond
the 10 built-ins without a code deploy. Ticket.department still stores the
enum-style `key` string (no FK) so existing rows keep working.

`ministry_registry` mirrors the Ministry enum with editable email + labels for
the auto-forward workflow.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, String, text

from src.core.database import Base


class DepartmentRegistry(Base):
    __tablename__ = "department_registry"

    id          = Column(BigInteger, primary_key=True, autoincrement=True)
    key         = Column(String(60), nullable=False, unique=True)
    display_en  = Column(String(200), nullable=False)
    display_ta  = Column(String(200), nullable=True)
    email       = Column(String(255), nullable=True)
    is_active   = Column(Boolean, nullable=False, server_default=text("true"))
    is_builtin  = Column(Boolean, nullable=False, server_default=text("false"),
                         comment="TRUE for the 10 seeded SchoolDepartments; can't be deleted")
    created_by  = Column(String(100), nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow,
                         onupdate=datetime.utcnow)


class MinistryRegistry(Base):
    __tablename__ = "ministry_registry"

    id          = Column(BigInteger, primary_key=True, autoincrement=True)
    key         = Column(String(80), nullable=False, unique=True)
    display_en  = Column(String(200), nullable=False)
    display_ta  = Column(String(200), nullable=True)
    email       = Column(String(255), nullable=True)
    is_active   = Column(Boolean, nullable=False, server_default=text("true"))
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow,
                         onupdate=datetime.utcnow)
