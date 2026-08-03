"""
Department login accounts — one shared account per School Education department.

Ten rows, one per SchoolDepartment. Department staff sign in with the account's
username + password; the session cookie carries the department so every action
is scoped + attributed to that department. Seed with scripts/seed_departments.py.
"""
from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime

from src.core.database import Base
# Shared password hashing (salted PBKDF2, with legacy-HMAC verify). Re-exported
# so existing `from src.models.department_account import ..., verify_password`
# imports keep working.
from src.core.passwords import hash_password, needs_rehash, verify_password  # noqa: F401


class DepartmentAccount(Base):
    __tablename__ = "department_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    department = Column(String(60), nullable=False, unique=True, index=True,
                        comment="SchoolDepartment enum value")
    username = Column(String(60), nullable=False, unique=True, index=True)
    password_hash = Column(String(128), nullable=False)
    display_name = Column(String(150), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
