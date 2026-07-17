"""appointment: add source column (intake channel)

Revision ID: 030
Revises: 029
Create Date: 2026-07-17

Restores the intake-channel column on `appointment` that was removed in the
v2 normalised cutover. Needed for the ticket-list Source filter and to keep
the origin of each petition on the case record itself, not derived from
whichever service happened to create it.

Values match the frontend SOURCE_DISPLAY enum:
    qr_citizen | ai_scan | postal | manual_staff | cm_office

Backfill defaults every existing row to `qr_citizen` — the value the
dashboard serializer was already returning as a hardcoded fallback, so no
row's displayed source changes. Rows created from the ai-upload approve
flow after this migration will carry the ai_upload row's real source
(ai_scan / postal / …).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "appointment",
        sa.Column("source", sa.VARCHAR(50), nullable=False, server_default="qr_citizen"),
    )
    op.create_index("ix_appointment_source", "appointment", ["source"])


def downgrade() -> None:
    op.drop_index("ix_appointment_source", table_name="appointment")
    op.drop_column("appointment", "source")
