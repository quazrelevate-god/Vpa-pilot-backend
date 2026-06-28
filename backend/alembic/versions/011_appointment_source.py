"""add source (intake channel) to appointments + backfill

Revision ID: 011
Revises: 010
Create Date: 2026-06-28

Lets the analytics dashboard break petitions down by channel:
  qr_citizen   - citizen self-submit (QR form)
  ai_scan      - AI Uploads (bulk scanned petitions)
  manual_staff - staff manual scan-petition

Backfill: appointments linked from ai_uploads => ai_scan; everything else qr_citizen.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '011'
down_revision: Union[str, None] = '010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column(
        'source', sa.String(20), nullable=False, server_default='qr_citizen'))
    op.create_index('ix_appointments_source', 'appointments', ['source'])
    # Backfill AI-upload-originated cases (table may not exist on very old DBs)
    op.execute("""
        UPDATE appointments a SET source = 'ai_scan'
        WHERE EXISTS (SELECT 1 FROM ai_uploads u WHERE u.appointment_id = a.id)
    """)


def downgrade() -> None:
    op.drop_index('ix_appointments_source', table_name='appointments')
    op.drop_column('appointments', 'source')
