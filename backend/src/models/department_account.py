"""
Department login accounts — one shared account per School Education department.

Ten rows, one per SchoolDepartment. Department staff sign in with the account's
username + password; the session cookie carries the department so every action
is scoped + attributed to that department. Seed with scripts/seed_departments.py.
"""
import hashlib
import hmac

from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime

from src.core.database import Base
from src.core.config import settings


def hash_password(password: str) -> str:
    """Salted SHA-256 (keyed on SECRET_KEY). Matches the project's simple-auth bar."""
    return hmac.new(settings.SECRET_KEY.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(hash_password(password), password_hash or "")


class DepartmentAccount(Base):
    __tablename__ = "department_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    department = Column(String(60), nullable=False, unique=True, index=True,
                        comment="SchoolDepartment enum value")
    username = Column(String(60), nullable=False, unique=True, index=True)
    password_hash = Column(String(128), nullable=False)
    display_name = Column(String(150), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
