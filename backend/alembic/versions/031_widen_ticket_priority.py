"""ticket.priority: widen VARCHAR(5) -> VARCHAR(20)

Revision ID: 031
Revises: 030
Create Date: 2026-07-17

The ticket.priority column was originally sized for a legacy P0/P1/P2/P3
enum. Current code stores the AI-review urgency directly (low, medium,
high, critical) which overflows at 'medium' (6) and 'critical' (8) chars,
so any PATCH /api/tickets/{id} with priority=medium|critical was 500ing
with StringDataRightTruncation. Widen to 20 characters.

No backfill needed — existing rows already fit inside the new bound.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "ticket", "priority",
        existing_type=sa.VARCHAR(length=5),
        type_=sa.VARCHAR(length=20),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "ticket", "priority",
        existing_type=sa.VARCHAR(length=20),
        type_=sa.VARCHAR(length=5),
        existing_nullable=True,
    )
