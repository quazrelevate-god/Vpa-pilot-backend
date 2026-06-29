"""widen referral_bookings name/mobile for Fernet encryption

Revision ID: 015
Revises: 014
Create Date: 2026-06-29

Referral bookings stored name/mobile in plaintext — the only citizen-facing flow
that wasn't encrypted. Widen the columns to hold Fernet tokens; the existing rows
are re-encrypted by encrypt_pii.py (idempotent).
"""
from typing import Sequence, Union
from alembic import op

revision: str = '015'
down_revision: Union[str, None] = '014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE referral_bookings ALTER COLUMN name TYPE TEXT")
    op.execute("ALTER TABLE referral_bookings ALTER COLUMN mobile TYPE VARCHAR(512)")


def downgrade() -> None:
    op.execute("ALTER TABLE referral_bookings ALTER COLUMN mobile TYPE VARCHAR(15)")
    op.execute("ALTER TABLE referral_bookings ALTER COLUMN name TYPE VARCHAR(150)")
