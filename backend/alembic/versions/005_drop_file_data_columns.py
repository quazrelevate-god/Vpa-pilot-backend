"""drop file_data and original_filename from appointment_attachments,
make storage_url NOT NULL

Revision ID: 005
Revises: 343b6d4ced3e
Create Date: 2026-06-25

Run migrate_attachments_to_disk.py FIRST before applying this migration.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '005'
down_revision: Union[str, None] = '343b6d4ced3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Set a placeholder for any rows still missing storage_url (safety net)
    op.execute("""
        UPDATE appointment_attachments
        SET storage_url = 'uploads/missing/' || id::text
        WHERE storage_url IS NULL
    """)

    # Drop binary storage columns
    op.execute("ALTER TABLE appointment_attachments DROP COLUMN IF EXISTS file_data")
    op.execute("ALTER TABLE appointment_attachments DROP COLUMN IF EXISTS original_filename")

    # Make storage_url NOT NULL now that all rows have a value
    op.alter_column('appointment_attachments', 'storage_url', nullable=False)


def downgrade() -> None:
    op.alter_column('appointment_attachments', 'storage_url', nullable=True)
    op.execute("ALTER TABLE appointment_attachments ADD COLUMN IF NOT EXISTS file_data BYTEA")
    op.execute("ALTER TABLE appointment_attachments ADD COLUMN IF NOT EXISTS original_filename TEXT")
