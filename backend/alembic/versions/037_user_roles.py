"""rbac: user_roles table (capability roles alongside login.role)

Revision ID: 037
Revises: 036
Create Date: 2026-07-29

Adds a many-to-many `user_roles` table so a Login can hold multiple capability
roles (event_uploader, event_reviewer, …) in addition to its single primary
dashboard role (login.role: super_admin | pa | dept_officer | …).

Rationale: the events PWA needs per-user login with distinct upload / review
capabilities. Extending the single-string login.role would force one-role-per-
user forever; a M2M table lets one operator hold both (or just one) and
future capability roles (crowd_operator, etc.) drop in without schema churn.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_roles",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("login_id", sa.BigInteger,
                  sa.ForeignKey("login.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(40), nullable=False,
                  comment="capability role — e.g. event_uploader, event_reviewer"),
        sa.Column("granted_at", sa.DateTime, nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("login_id", "role", name="uq_user_roles_login_role"),
    )
    op.create_index("ix_user_roles_login_id", "user_roles", ["login_id"])
    op.create_index("ix_user_roles_role", "user_roles", ["role"])


def downgrade() -> None:
    op.drop_index("ix_user_roles_role", table_name="user_roles")
    op.drop_index("ix_user_roles_login_id", table_name="user_roles")
    op.drop_table("user_roles")
