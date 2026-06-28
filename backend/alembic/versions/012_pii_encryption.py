"""prep citizens for real PII encryption (mobile_index + drop unique mobile)

Revision ID: 012
Revises: 011
Create Date: 2026-06-28

Real (Fernet) encryption is non-deterministic, so:
  - the same mobile no longer encrypts to the same value -> the UNIQUE constraint
    on encrypted_mobile is meaningless; drop it.
  - dedup/lookup of a returning citizen moves to a deterministic mobile_index (HMAC).
  - widen encrypted_mobile (Fernet tokens are longer than base64).

After this migration, run scripts/encrypt_pii.py to re-encrypt existing rows and
backfill mobile_index.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '012'
down_revision: Union[str, None] = '011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('citizens', sa.Column('mobile_index', sa.String(64), nullable=True))
    op.create_index('ix_citizens_mobile_index', 'citizens', ['mobile_index'])
    op.execute("ALTER TABLE citizens ALTER COLUMN encrypted_mobile TYPE VARCHAR(512)")
    op.execute("ALTER TABLE citizens DROP CONSTRAINT IF EXISTS citizens_encrypted_mobile_key")


def downgrade() -> None:
    op.drop_index('ix_citizens_mobile_index', table_name='citizens')
    op.drop_column('citizens', 'mobile_index')
