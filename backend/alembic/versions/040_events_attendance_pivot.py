"""events: drop attendance column; flip is_approved to false for all rows

Revision ID: 040
Revises: 039
Create Date: 2026-07-29

Semantic pivot: `is_approved` no longer means "published to calendar" — it now
means "did the Minister attend / commit to attend". Consequences:
  • The old `attendance` column becomes dead weight → dropped.
  • Every existing row is reset to is_approved=false (unattended). The reviewer
    can only approve today+ events going forward; past events stay unattended
    unless someone manually flips them via a future backfill.
  • The calendar view stops gating on is_approved (see list_events change) so
    all events remain visible; is_approved is now a per-row marker, not a
    visibility gate.

Downgrade is best-effort: re-adds the attendance column but the original
per-row attended/not_attended data is gone. Leave it null; the operator can
re-collect if they roll back.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Flip every row to unattended before dropping attendance so no state is
    # carried over from the old marker. Reviewers use the Approve button on
    # today+ events to move them into "attended".
    op.execute("UPDATE invitation_events SET is_approved = false")
    op.drop_column("invitation_events", "attendance")


def downgrade() -> None:
    # Best-effort: recreate the column empty. Historical values are lost.
    op.add_column(
        "invitation_events",
        sa.Column("attendance", sa.VARCHAR(20), nullable=True,
                  comment="attended | not_attended | NULL"),
    )
