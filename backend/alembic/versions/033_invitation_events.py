"""events PWA: create invitation_events table

Revision ID: 033
Revises: 032
Create Date: 2026-07-21

New standalone table backing the /events invitation-calendar PWA. Each row is
one photographed greeting/invitation card: the stored photo, the PA's optional
note, and the Gemini-extracted event fields (title/venue/type/date/times),
moving through QUEUED -> PROCESSING -> READY | FAILED.

Isolated from the petition/appointment tables on purpose — the events PWA is
a separate shared calendar with its own login (events_session cookie).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invitation_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("image_path", sa.Text(), nullable=False),
        sa.Column("image_mime", sa.VARCHAR(100), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("title", sa.VARCHAR(300), nullable=True),
        sa.Column("venue", sa.VARCHAR(300), nullable=True),
        sa.Column("event_type", sa.VARCHAR(50), nullable=True),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("status", sa.VARCHAR(20), nullable=False, server_default="QUEUED"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("extraction_json", JSONB(), nullable=True),
        sa.Column("created_by", sa.VARCHAR(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_inv_events_date", "invitation_events", ["event_date"])
    op.create_index("ix_inv_events_status", "invitation_events", ["status"])
    op.create_index("ix_inv_events_created", "invitation_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_inv_events_created", table_name="invitation_events")
    op.drop_index("ix_inv_events_status", table_name="invitation_events")
    op.drop_index("ix_inv_events_date", table_name="invitation_events")
    op.drop_table("invitation_events")
