"""Move ai_uploads extracted content onto grievance_summary_records

Revision ID: 049
Revises: 048
Create Date: 2026-08-06

De-duplicates the AI-scan pipeline. Previously `ai_uploads` carried its own
copy of the extracted content (extracted_name/_ta, extracted_mobile,
grievance_category, priority, and the full summary_json), which was then
re-shaped into a GrievanceSummaryRecord (GSR) on approve — the same data twice.

After this migration:
  * `grievance_summary_records` is the single home for extracted content. It
    gains `ai_upload_id` (FK) + `contact_mobile`, and `appointment_id` becomes
    nullable so an extraction can exist before an appointment does. A CHECK
    guarantees at least one parent link.
  * `ai_uploads` keeps only pipeline + review + classifier-routing columns; the
    six content columns are dropped.

Data migration:
  1. Link every already-approved upload's GSR back to its upload row
     (ai_upload_id), matched by appointment_id.
  2. For not-yet-approved uploads holding an extraction (AWAITING_REVIEW /
     DISMISSED with summary_json), create a GSR (appointment_id NULL,
     ai_upload_id set) from the old columns + summary_json.
  3. Drop the six content columns.

FAILED / QUEUED / PROCESSING / ROUTED rows have no petition extraction and get
no GSR (ROUTED content lives in proposal_submissions / association_submissions).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "049"
down_revision: Union[str, None] = "048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1) Schema: extend grievance_summary_records ─────────────────────────────
    op.add_column(
        "grievance_summary_records",
        sa.Column("ai_upload_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "grievance_summary_records",
        sa.Column("contact_mobile", sa.String(length=20), nullable=True),
    )
    op.alter_column(
        "grievance_summary_records", "appointment_id",
        existing_type=sa.Integer(), nullable=True,
    )
    op.create_foreign_key(
        "fk_gsr_ai_upload", "grievance_summary_records", "ai_uploads",
        ["ai_upload_id"], ["id"], ondelete="CASCADE",
    )
    op.create_index(
        "ix_gsr_ai_upload_latest", "grievance_summary_records",
        ["ai_upload_id", "is_latest"],
    )

    # ── 2) Backfill A: link approved uploads to their existing GSR ───────────────
    op.execute("""
        UPDATE grievance_summary_records g
        SET ai_upload_id = a.id
        FROM ai_uploads a
        WHERE a.appointment_id IS NOT NULL
          AND a.appointment_id = g.appointment_id
    """)

    # ── 3) Backfill B: create GSRs for not-yet-approved extractions ──────────────
    # Reads the soon-to-be-dropped columns while they still exist.
    op.execute("""
        INSERT INTO grievance_summary_records
            (appointment_id, ai_upload_id, contact_mobile, is_latest,
             priority, category, ministry, district, document_date,
             name_en, name_ta,
             summary, citizen_ask, key_details,
             summary_ta, citizen_ask_ta, key_details_ta,
             audio_transcript, audio_stt_latency_ms,
             gemini_model_used, gemini_latency_ms, created_at)
        SELECT
            NULL,
            a.id,
            a.extracted_mobile,
            TRUE,
            COALESCE(a.priority, a.summary_json->>'urgency', 'low'),
            COALESCE(a.grievance_category, a.summary_json->>'category', 'other'),
            COALESCE(a.summary_json->>'ministry', 'other'),
            NULLIF(NULLIF(a.summary_json->>'district', ''), 'unknown'),
            NULLIF(a.summary_json->>'document_date', ''),
            COALESCE(a.extracted_name, a.summary_json->>'name_en', ''),
            COALESCE(a.extracted_name_ta, a.summary_json->>'name_ta', ''),
            COALESCE(a.summary_json->>'summary', ''),
            COALESCE(a.summary_json->>'citizen_ask', ''),
            COALESCE(a.summary_json->'key_details', '[]'::jsonb),
            COALESCE(a.summary_json->>'summary_ta', ''),
            COALESCE(a.summary_json->>'citizen_ask_ta', ''),
            COALESCE(a.summary_json->'key_details_ta', '[]'::jsonb),
            a.summary_json->>'audio_transcript',
            NULL,
            COALESCE(a.summary_json->>'_model_used', 'gemini'),
            NULLIF(a.summary_json->>'_latency_ms', '')::int,
            a.created_at
        FROM ai_uploads a
        WHERE a.appointment_id IS NULL
          AND a.summary_json IS NOT NULL
          AND a.status IN ('AWAITING_REVIEW', 'DISMISSED')
    """)

    # ── 4) Enforce the parent invariant now that every row has one ──────────────
    op.create_check_constraint(
        "ck_gsr_has_parent", "grievance_summary_records",
        "appointment_id IS NOT NULL OR ai_upload_id IS NOT NULL",
    )

    # ── 5) Drop the duplicated content columns from ai_uploads ──────────────────
    op.drop_column("ai_uploads", "summary_json")
    op.drop_column("ai_uploads", "priority")
    op.drop_column("ai_uploads", "grievance_category")
    op.drop_column("ai_uploads", "extracted_mobile")
    op.drop_column("ai_uploads", "extracted_name_ta")
    op.drop_column("ai_uploads", "extracted_name")


def downgrade() -> None:
    # ── 1) Re-add the ai_uploads content columns ────────────────────────────────
    op.add_column("ai_uploads", sa.Column("extracted_name", sa.VARCHAR(length=200), nullable=True))
    op.add_column("ai_uploads", sa.Column("extracted_name_ta", sa.VARCHAR(length=200), nullable=True))
    op.add_column("ai_uploads", sa.Column("extracted_mobile", sa.VARCHAR(length=20), nullable=True))
    op.add_column("ai_uploads", sa.Column("grievance_category", sa.VARCHAR(length=50), nullable=True))
    op.add_column("ai_uploads", sa.Column("priority", sa.VARCHAR(length=20), nullable=True))
    op.add_column(
        "ai_uploads",
        sa.Column("summary_json", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    # ── 2) Rebuild the ai_uploads columns from the linked GSR ───────────────────
    op.execute("""
        UPDATE ai_uploads a
        SET extracted_name     = g.name_en,
            extracted_name_ta  = g.name_ta,
            extracted_mobile   = g.contact_mobile,
            grievance_category = g.category,
            priority           = g.priority,
            summary_json = jsonb_strip_nulls(jsonb_build_object(
                'category',        g.category,
                'urgency',         g.priority,
                'ministry',        g.ministry,
                'district',        g.district,
                'document_date',   g.document_date,
                'name_en',         g.name_en,
                'name_ta',         g.name_ta,
                'mobile',          g.contact_mobile,
                'summary',         g.summary,
                'summary_ta',      g.summary_ta,
                'citizen_ask',     g.citizen_ask,
                'citizen_ask_ta',  g.citizen_ask_ta,
                'key_details',     g.key_details,
                'key_details_ta',  g.key_details_ta,
                '_model_used',     g.gemini_model_used,
                '_latency_ms',     g.gemini_latency_ms
            ))
        FROM grievance_summary_records g
        WHERE g.ai_upload_id = a.id
          AND g.is_latest = TRUE
    """)

    # ── 3) Remove the pre-approval draft GSRs (no pre-049 equivalent) ───────────
    op.execute("""
        DELETE FROM grievance_summary_records
        WHERE appointment_id IS NULL AND ai_upload_id IS NOT NULL
    """)

    # ── 4) Restore constraints on grievance_summary_records ─────────────────────
    op.drop_constraint("ck_gsr_has_parent", "grievance_summary_records", type_="check")
    op.drop_index("ix_gsr_ai_upload_latest", table_name="grievance_summary_records")
    op.drop_constraint("fk_gsr_ai_upload", "grievance_summary_records", type_="foreignkey")
    op.alter_column(
        "grievance_summary_records", "appointment_id",
        existing_type=sa.Integer(), nullable=False,
    )
    op.drop_column("grievance_summary_records", "contact_mobile")
    op.drop_column("grievance_summary_records", "ai_upload_id")
