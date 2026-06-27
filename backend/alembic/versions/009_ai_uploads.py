"""create ai_uploads table (bulk petition extraction pipeline)

Revision ID: 009
Revises: 008
Create Date: 2026-06-27

Isolated table for the AI Uploads section: each bulk-uploaded petition file moves
QUEUED -> PROCESSING -> AWAITING_REVIEW -> REVIEWED (or FAILED). Citizen/Appointment/
Ticket are created only on approve, so this stays decoupled from the appointment flow.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '009'
down_revision: Union[str, None] = '008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_uploads',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('batch_id', sa.VARCHAR(40), nullable=False),
        sa.Column('original_filename', sa.VARCHAR(300), nullable=False),
        sa.Column('storage_url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.VARCHAR(100), nullable=False),
        sa.Column('status', sa.VARCHAR(20), nullable=False, server_default='QUEUED'),
        sa.Column('extracted_name', sa.VARCHAR(200), nullable=True),
        sa.Column('extracted_name_ta', sa.VARCHAR(200), nullable=True),
        sa.Column('extracted_mobile', sa.VARCHAR(20), nullable=True),
        sa.Column('grievance_category', sa.VARCHAR(50), nullable=True),
        sa.Column('urgency', sa.VARCHAR(20), nullable=True),
        sa.Column('summary_json', JSONB(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('appointment_id', sa.Integer(),
                  sa.ForeignKey('appointments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('ticket_id', sa.BigInteger(),
                  sa.ForeignKey('tickets.id', ondelete='SET NULL'), nullable=True),
        sa.Column('ticket_number', sa.VARCHAR(20), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('reviewed_by', sa.VARCHAR(100), nullable=True),
    )
    op.create_index('ix_ai_uploads_status', 'ai_uploads', ['status'])
    op.create_index('ix_ai_uploads_batch', 'ai_uploads', ['batch_id'])
    op.create_index('ix_ai_uploads_created', 'ai_uploads', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_ai_uploads_created', table_name='ai_uploads')
    op.drop_index('ix_ai_uploads_batch', table_name='ai_uploads')
    op.drop_index('ix_ai_uploads_status', table_name='ai_uploads')
    op.drop_table('ai_uploads')
