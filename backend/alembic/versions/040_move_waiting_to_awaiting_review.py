"""Move WAITING appointments to AWAITING_REVIEW (disable waitlist flow)

Revision ID: 040
Revises: 039
Create Date: 2026-07-29

All appointments currently in WAITING status are moved to AWAITING_REVIEW
so they appear under the Petition Review "Awaiting Review" tab instead of
the now-hidden Appointments "Waiting" tab. The waitlist flow is being
disabled (not removed) — this migration can be reversed to restore it.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE appointments
        SET status    = 'AWAITING_REVIEW',
            status_id = (SELECT id FROM admin
                         WHERE entity = 'appointment'
                           AND name   = 'AWAITING_REVIEW'
                         LIMIT 1)
        WHERE status = 'WAITING'
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE appointments
        SET status    = 'WAITING',
            status_id = (SELECT id FROM admin
                         WHERE entity = 'appointment'
                           AND name   = 'WAITING'
                         LIMIT 1)
        WHERE status = 'AWAITING_REVIEW'
          AND slot_id IS NULL
          AND scheduled_date IS NULL
    """)
