"""enforce one citizen per mobile via UNIQUE mobile_index

Revision ID: 013
Revises: 012
Create Date: 2026-06-29

Migration 012 dropped the UNIQUE constraint on encrypted_mobile (Fernet is
non-deterministic) and moved dedup to a plain, non-unique mobile_index. That
left a gap: two concurrent first-time submissions from the same mobile could
both pass the "look first" check and insert duplicate citizen rows.

Restore the DB-level guarantee: replace the plain index with a UNIQUE one.
Postgres allows multiple NULLs under a unique index, so citizens without a
mobile are unaffected. The application catches IntegrityError and falls back to
reusing the existing citizen.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '013'
down_revision: Union[str, None] = '012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Swap the plain lookup index for a unique one (serves both lookup + dedup).
    op.drop_index('ix_citizens_mobile_index', table_name='citizens')
    op.create_index('ix_citizens_mobile_index', 'citizens', ['mobile_index'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_citizens_mobile_index', table_name='citizens')
    op.create_index('ix_citizens_mobile_index', 'citizens', ['mobile_index'])
