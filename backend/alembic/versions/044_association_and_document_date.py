"""association pipeline + document_date on petition/proposal

Revision ID: 044
Revises: 043
Create Date: 2026-08-01

Two additive changes for the intake-router work:

  1. `association_submissions` — the staging + review table for union/association
     submissions the classifier routes as `association`. Uses the same grievance
     categorisation as petitions (category/ministry/urgency/district) plus the
     association's own identity + collective ask. Never becomes a Ticket.

  2. `document_date` (VARCHAR ISO 'YYYY-MM-DD', nullable) added to
     `grievance_summary_records` and `proposal_submissions` — the date written ON
     the document (letterhead/signature date), distinct from the received date.
     Stored as text so a malformed extracted date can never break a write.

All additive — new table + two nullable columns. Nothing to backfill; existing
rows keep document_date = NULL until re-extracted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "044"
down_revision: Union[str, None] = "043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "association_submissions",
        sa.Column("id",         sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(),   nullable=False, server_default=sa.func.now()),
        sa.Column("source",     sa.VARCHAR(40),  nullable=True),
        sa.Column("source_ref", sa.VARCHAR(80),  nullable=True),
        sa.Column("documents",  postgresql.JSONB(astext_type=sa.Text()), nullable=True),

        sa.Column("association_name",           sa.VARCHAR(300), nullable=True),
        sa.Column("member_count",               sa.VARCHAR(120), nullable=True),
        sa.Column("representative_name",        sa.VARCHAR(200), nullable=True),
        sa.Column("representative_designation", sa.VARCHAR(200), nullable=True),

        sa.Column("category",      sa.VARCHAR(50), nullable=True),
        sa.Column("ministry",      sa.VARCHAR(80), nullable=True),
        sa.Column("urgency",       sa.VARCHAR(20), nullable=True),
        sa.Column("district",      sa.VARCHAR(60), nullable=True),
        sa.Column("document_date", sa.VARCHAR(10), nullable=True),

        sa.Column("extraction_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),

        sa.Column("status", sa.VARCHAR(24), nullable=False, server_default="AWAITING_REVIEW"),
        sa.Column("reviewed_by",   sa.VARCHAR(100), nullable=True),
        sa.Column("reviewed_at",   sa.DateTime(),   nullable=True),
        sa.Column("decision_note", sa.Text(),       nullable=True),
    )
    op.create_index("ix_association_submissions_status",   "association_submissions", ["status"])
    op.create_index("ix_association_submissions_created",  "association_submissions", ["created_at"])
    op.create_index("ix_association_submissions_category", "association_submissions", ["category"])

    # document_date on the petition + proposal records (ISO text, nullable)
    op.add_column("grievance_summary_records", sa.Column("document_date", sa.VARCHAR(10), nullable=True))
    op.add_column("proposal_submissions",      sa.Column("document_date", sa.VARCHAR(10), nullable=True))


def downgrade() -> None:
    op.drop_column("proposal_submissions", "document_date")
    op.drop_column("grievance_summary_records", "document_date")
    op.drop_index("ix_association_submissions_category", table_name="association_submissions")
    op.drop_index("ix_association_submissions_created", table_name="association_submissions")
    op.drop_index("ix_association_submissions_status", table_name="association_submissions")
    op.drop_table("association_submissions")
