"""make referral_bookings.token_number unique (delete-safe numbering)

Revision ID: 016
Revises: 015
Create Date: 2026-06-29

Referral token generation switched from COUNT(*)+1 to MAX(token)+1 (delete-safe),
mirroring the appointment token fix. Add a UNIQUE index on token_number so a
duplicate referral token can never persist.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '016'
down_revision: Union[str, None] = '015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_referral_bookings_token', 'referral_bookings', ['token_number'], unique=True
    )


def downgrade() -> None:
    op.drop_index('ix_referral_bookings_token', table_name='referral_bookings')
