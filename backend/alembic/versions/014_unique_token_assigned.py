"""make token_assigned unique (delete-safe token numbering)

Revision ID: 014
Revises: 013
Create Date: 2026-06-29

Token assignment switched from COUNT(*)+1 to MAX(token)+1 (delete-safe). Add a
UNIQUE index on token_assigned so a duplicate token can never be persisted, and
to back the per-day MAX range lookup efficiently.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '014'
down_revision: Union[str, None] = '013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_appointments_token_assigned', 'appointments', ['token_assigned'], unique=True
    )


def downgrade() -> None:
    op.drop_index('ix_appointments_token_assigned', table_name='appointments')
