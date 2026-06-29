"""durable AI-summarisation state on appointments

Revision ID: 017
Revises: 016
Create Date: 2026-06-29

Summarisation was a fire-and-forget asyncio task on the web loop — a deploy or
crash mid-run silently dropped the summary with no retry. Add durable state
(summary_status / attempts / claimed_at) so the worker owns summarisation and
restarts are safe. Existing rows are backfilled to DONE so the deploy doesn't
trigger a flood of re-summarisation (and cost).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '017'
down_revision: Union[str, None] = '016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column(
        'summary_status', sa.String(20), nullable=False, server_default='PENDING'))
    op.add_column('appointments', sa.Column(
        'summary_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('appointments', sa.Column(
        'summary_claimed_at', sa.DateTime(), nullable=True))

    # Existing appointments are historical — don't re-summarise them on deploy.
    op.execute("UPDATE appointments SET summary_status = 'DONE'")

    op.create_index(
        'ix_appointments_summary_pending', 'appointments', ['summary_status'],
        postgresql_where=sa.text("summary_status IN ('PENDING','PROCESSING')"),
    )


def downgrade() -> None:
    op.drop_index('ix_appointments_summary_pending', table_name='appointments')
    op.drop_column('appointments', 'summary_claimed_at')
    op.drop_column('appointments', 'summary_attempts')
    op.drop_column('appointments', 'summary_status')
