"""proposal intake: proposal_submissions staging table

Revision ID: 043
Revises: 042
Create Date: 2026-08-01

Creates `proposal_submissions` — the staging table for the public /proposal
intake (Nam Kural institutional proposals to the Hon'ble Minister for School
Education). Each row is one submission moving through:

    QUEUED -> PROCESSING -> AWAITING_REVIEW -> (APPROVED | REJECTED | NEEDS_CLARIFICATION)
    (PROCESSING may instead go to FAILED)

Deliberately isolated from appointment/ticket — a proposal is judged on merit,
never becomes a Ticket, never enters the grievance/redress pipeline. Identity
(org / person / contact) comes from the form; email + phone are stored Fernet-
encrypted like citizen PII. Gemini fills `extraction_json` (the pitch brief).

New table only — no changes to existing tables, nothing to backfill.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "043"
down_revision: Union[str, None] = "042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "proposal_submissions",
        sa.Column("id",           sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tracking_ref", sa.VARCHAR(40),  nullable=False,
                  comment="Public reference shown to the submitter, e.g. NK/SCH/2026/AB12C"),
        sa.Column("category",     sa.VARCHAR(40),  nullable=True,
                  comment="Desk the proposal is aimed at: school | tamil | information | film"),

        # Identity — from the form, authoritative. Email + phone encrypted.
        sa.Column("org_name",    sa.VARCHAR(300), nullable=True),
        sa.Column("person_name", sa.VARCHAR(200), nullable=True),
        sa.Column("designation", sa.VARCHAR(200), nullable=True),
        sa.Column("email_enc",   sa.Text(),       nullable=True, comment="Fernet-encrypted email"),
        sa.Column("phone_enc",   sa.VARCHAR(512), nullable=True, comment="Fernet-encrypted phone"),
        sa.Column("phone_index", sa.VARCHAR(64),  nullable=True,
                  comment="Blind HMAC index of phone for equality lookup"),

        # Uploaded documents: [{original_filename, storage_url, mime_type}, ...]
        sa.Column("documents", postgresql.JSONB(astext_type=sa.Text()), nullable=True),

        sa.Column("status", sa.VARCHAR(24), nullable=False, server_default="QUEUED",
                  comment="QUEUED | PROCESSING | AWAITING_REVIEW | FAILED | APPROVED | REJECTED | NEEDS_CLARIFICATION"),

        # Gemini brief (ProposalExtraction schema)
        sa.Column("extraction_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message",   sa.Text(), nullable=True, comment="Reason a PROCESSING run FAILED"),

        # Decision — set by the super-admin reviewer
        sa.Column("reviewed_by",   sa.VARCHAR(100), nullable=True),
        sa.Column("reviewed_at",   sa.DateTime(),   nullable=True),
        sa.Column("decision_note", sa.Text(),       nullable=True),

        sa.Column("created_at",   sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ux_proposal_submissions_tracking_ref", "proposal_submissions", ["tracking_ref"], unique=True)
    op.create_index("ix_proposal_submissions_status",   "proposal_submissions", ["status"])
    op.create_index("ix_proposal_submissions_created",  "proposal_submissions", ["created_at"])
    op.create_index("ix_proposal_submissions_category", "proposal_submissions", ["category"])
    op.create_index("ix_proposal_submissions_phone_index", "proposal_submissions", ["phone_index"])


def downgrade() -> None:
    op.drop_index("ix_proposal_submissions_phone_index", table_name="proposal_submissions")
    op.drop_index("ix_proposal_submissions_category", table_name="proposal_submissions")
    op.drop_index("ix_proposal_submissions_created", table_name="proposal_submissions")
    op.drop_index("ix_proposal_submissions_status", table_name="proposal_submissions")
    op.drop_index("ux_proposal_submissions_tracking_ref", table_name="proposal_submissions")
    op.drop_table("proposal_submissions")
