"""events: approved_by + approved_at audit columns

Revision ID: 039
Revises: 038
Create Date: 2026-07-29

Migration 038 shipped `is_approved` but the model added THREE columns —
`is_approved`, `approved_by`, `approved_at` — and every SELECT against the
model 500'd on the missing ones once the code rolled out. This backfills
the two audit columns to match the model. Both nullable so no backfill of
existing rows is needed; rows approved before this migration will show
"approved by —" which is honest (we don't know who did it retroactively).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "039"
down_revision: Union[str, None] = "038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invitation_events",
        sa.Column("approved_by", sa.VARCHAR(100), nullable=True,
                  comment="events_session username who approved"),
    )
    op.add_column(
        "invitation_events",
        sa.Column("approved_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("invitation_events", "approved_at")
    op.drop_column("invitation_events", "approved_by")
