"""add department column to grievance_summary_records

Revision ID: 003
Revises: 002
Create Date: 2026-06-20

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add department column to grievance_summary_records table
    op.add_column('grievance_summary_records', 
                  sa.Column('department', sa.VARCHAR(60), 
                           nullable=False, 
                           server_default='other',
                           comment='Department enum: TN govt department best suited to action this grievance'))
    
    # Add index for department column
    op.create_index('ix_gsr_department', 'grievance_summary_records', ['department'])


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_gsr_department', 'grievance_summary_records')
    
    # Remove department column
    op.drop_column('grievance_summary_records', 'department')
