"""add status column to referral_bookings (floor attendance)

Revision ID: 007
Revises: 006
Create Date: 2026-06-27

The crowd-management floor board marks each referral visitor as CAME / NOT_CAME.
ReferralBooking had no status field. Add it, defaulting existing rows to PENDING.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '007'
down_revision: Union[str, None] = '006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'referral_bookings',
        sa.Column('status', sa.String(length=12), nullable=False,
                  server_default='PENDING',
                  comment='Floor attendance: PENDING / CAME / NOT_CAME'),
    )


def downgrade() -> None:
    op.drop_column('referral_bookings', 'status')
