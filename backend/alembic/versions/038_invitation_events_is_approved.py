"""events: is_approved flag — all new events wait in Needs Review

Revision ID: 038
Revises: 037
Create Date: 2026-07-29

Every event (photo upload OR manual form) now lands unapproved and stays out
of the calendar view until a reviewer confirms with the Minister and clicks
Approve. Existing rows are backfilled to `is_approved=true` — they're already
visible on today's calendar, retroactively hiding them would be a regression
disguised as a security feature.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "038"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invitation_events",
        # Default false so any row inserted AFTER this migration (via the
        # updated service code, or by any external client) is off-calendar
        # until a reviewer approves it — closes the race where the app rolls
        # out before the code that sets it to True.
        sa.Column("is_approved", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    # Backfill: existing rows were live on the calendar before this migration,
    # so mark them approved. Bulk update — the table is small (thousands, not
    # millions) so no batching needed.
    op.execute("UPDATE invitation_events SET is_approved = true")
    op.create_index(
        "ix_invitation_events_is_approved", "invitation_events", ["is_approved"],
    )


def downgrade() -> None:
    op.drop_index("ix_invitation_events_is_approved", table_name="invitation_events")
    op.drop_column("invitation_events", "is_approved")
