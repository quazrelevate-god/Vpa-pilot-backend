"""add appointments.encrypted_name_ta

Revision ID: 021
Revises: 020
Create Date: 2026-07-03

Lets the PA record/edit a Tamil name for QR/staff petitions in the unified
review drawer (parity with scanned uploads' extracted_name_ta). Fernet-encrypted
like the other PII columns; nullable.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '021'
down_revision: Union[str, None] = '020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column('encrypted_name_ta', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('appointments', 'encrypted_name_ta')
