"""rename grievance_summary_records.urgency* -> priority*

Revision ID: 020
Revises: 019
Create Date: 2026-07-03

Unifies terminology to "priority" (driven by the AI review). Renames three
columns and the supporting index on grievance_summary_records:
    urgency          -> priority
    urgency_reason   -> priority_reason
    urgency_reason_ta-> priority_reason_ta
    ix_gsr_urgency   -> ix_gsr_priority

Plain column renames (VARCHAR/Text, no PG enum type), so data is preserved.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '020'
down_revision: Union[str, None] = '019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'grievance_summary_records'


def upgrade() -> None:
    op.alter_column(_TABLE, 'urgency', new_column_name='priority')
    op.alter_column(_TABLE, 'urgency_reason', new_column_name='priority_reason')
    op.alter_column(_TABLE, 'urgency_reason_ta', new_column_name='priority_reason_ta')
    op.execute('ALTER INDEX IF EXISTS ix_gsr_urgency RENAME TO ix_gsr_priority')
    # AI folder/scanned uploads carry their own denormalised urgency column.
    op.alter_column('ai_uploads', 'urgency', new_column_name='priority')


def downgrade() -> None:
    op.alter_column('ai_uploads', 'priority', new_column_name='urgency')
    op.execute('ALTER INDEX IF EXISTS ix_gsr_priority RENAME TO ix_gsr_urgency')
    op.alter_column(_TABLE, 'priority_reason_ta', new_column_name='urgency_reason_ta')
    op.alter_column(_TABLE, 'priority_reason', new_column_name='urgency_reason')
    op.alter_column(_TABLE, 'priority', new_column_name='urgency')
