"""Move WAITING appointments to AWAITING_REVIEW (disable waitlist flow)

Revision ID: 047
Revises: 046
Create Date: 2026-07-29

All appointments currently in WAITING status are moved to AWAITING_REVIEW
so they appear under the Petition Review "Awaiting Review" tab instead of
the now-hidden Appointments "Waiting" tab. The waitlist flow is being
disabled (not removed) — this migration can be reversed to restore it.

NOTE (branch sync): authored on akshita/dev as revision "040" (down_revision
"039"), which collided with main's existing 040 (events_attendance_pivot).
Re-based onto the current head (046) during the two-way branch sync, and the
target table corrected from `appointments` (pre-v2-cutover name) to
`appointment` — the v2 cutover (025) renamed the table, so the plural name no
longer exists and the original UPDATE would have failed on `alembic upgrade`.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "047"
down_revision: Union[str, None] = "046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE appointment
        SET status    = 'AWAITING_REVIEW',
            status_id = (SELECT id FROM admin
                         WHERE entity = 'appointment'
                           AND name   = 'AWAITING_REVIEW'
                         LIMIT 1)
        WHERE status = 'WAITING'
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE appointment
        SET status    = 'WAITING',
            status_id = (SELECT id FROM admin
                         WHERE entity = 'appointment'
                           AND name   = 'WAITING'
                         LIMIT 1)
        WHERE status = 'AWAITING_REVIEW'
          AND slot_id IS NULL
          AND scheduled_date IS NULL
    """)
