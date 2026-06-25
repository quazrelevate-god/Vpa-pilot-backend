"""add_num_persons_to_appointments

Revision ID: 343b6d4ced3e
Revises: 004
Create Date: 2026-06-25 07:20:16.638458

"""
from typing import Sequence, Union

from alembic import op

revision: str = '343b6d4ced3e'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS num_persons INTEGER NOT NULL DEFAULT 1"
    )


def downgrade() -> None:
    pass
