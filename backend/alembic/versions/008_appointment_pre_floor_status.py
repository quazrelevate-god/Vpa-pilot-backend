"""add pre_floor_status to appointments (floor-board revert)

Revision ID: 008
Revises: 007
Create Date: 2026-06-27

The crowd-management board can mark a scheduled visitor Came (-> AWAITING_REVIEW)
or Not Came (-> NOT_CAME). To undo a mistaken tap, we remember the original
scheduling status the first time the board touches a row, so revert restores it
exactly (SCHEDULED vs RESCHEDULED). Nullable — null means 'not yet touched'.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'appointments',
        sa.Column('pre_floor_status', sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('appointments', 'pre_floor_status')
