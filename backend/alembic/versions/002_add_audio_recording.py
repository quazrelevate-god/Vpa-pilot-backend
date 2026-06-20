"""add audio recording field

Revision ID: 002
Revises: 001
Create Date: 2026-06-20

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add audio_recording_url column to appointments table
    op.add_column('appointments', sa.Column('audio_recording_url', sa.Text(), nullable=True, comment='Storage URL for citizen\'s voice recording (blob storage path)'))
    
    # Make encrypted_grievance nullable (optional if audio provided)
    op.alter_column('appointments', 'encrypted_grievance',
                    existing_type=sa.Text(),
                    nullable=True,
                    comment='AES-256 encrypted grievance/query description (optional if audio provided)')


def downgrade() -> None:
    # Remove audio_recording_url column
    op.drop_column('appointments', 'audio_recording_url')
    
    # Make encrypted_grievance required again
    op.alter_column('appointments', 'encrypted_grievance',
                    existing_type=sa.Text(),
                    nullable=False,
                    comment='AES-256 encrypted grievance/query description')
