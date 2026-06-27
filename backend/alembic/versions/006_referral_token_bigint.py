"""widen referral_bookings.token_number to BIGINT

Revision ID: 006
Revises: 005
Create Date: 2026-06-27

The daily referral token is YYYYMMDD * 100000 + n (e.g. 2026062700001), a
13-digit value that overflows a 32-bit INTEGER. The ORM model declared the
column as Integer, so SQLAlchemy emitted an ::INTEGER cast on the parameter and
every booking failed with 'integer out of range'. Widen the column to BIGINT.

Safe + idempotent: ALTER ... TYPE BIGINT is a no-op where the column is already
bigint (e.g. Railway dev) and a lossless widening where it is integer (VPS prod).
"""
from typing import Sequence, Union
from alembic import op

revision: str = '006'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE referral_bookings "
        "ALTER COLUMN token_number TYPE BIGINT"
    )


def downgrade() -> None:
    # Narrowing back to INTEGER would overflow real tokens — intentionally a no-op.
    pass
