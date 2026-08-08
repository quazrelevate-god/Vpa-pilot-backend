"""dedup columns — file_hash + fingerprint + duplicate_of back-pointer

Revision ID: 057
Revises: 056
Create Date: 2026-08-08

Deduplication strategy — three layers stacked, each catching a different
flavour of duplicate. This migration lays the columns; the service-side
guards are wired in follow-up commits.

Layer 1A — file hash at AI upload intake (`ai_uploads.file_hash`)
  Compute SHA-256 of the incoming file bytes. New batches skip files
  whose hash already exists. Catches the ~90% of accidental re-uploads
  (drag same folder twice, forward the same batch PDF, etc.).

Layer 1B — post-extraction fingerprint (`*.dedup_fingerprint`)
  Once Gemini extraction has run, compute a normalised fingerprint
  (org+title+ask for proposals, name+ask for associations) and check
  a 90-day rolling window for prior matches. A hit soft-flags the new
  row: `is_duplicate=True` + `duplicate_of_id` back-pointer.
  The row still enters review; the drawer surfaces a warning pill and
  the reviewer decides. Never auto-refuses a fingerprint match — a
  slightly-edited legitimate re-submission must still be reviewable.

Layer 2 — reviewer-triggered "Find similar"
  Trigram Jaccard on the ask, mirrors the petition merge service.
  Human backstop for cases the deterministic layers missed. Backed by
  the same columns (uses is_duplicate/duplicate_of_id for the UI
  chip), no new schema needed for the fuzzy match itself.

All columns are nullable + additive. Legacy rows remain valid.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "057"
down_revision: Union[str, None] = "056"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Layer 1A — file hash on ai_uploads ─────────────────────────────────
    op.add_column(
        "ai_uploads",
        sa.Column(
            "file_hash",
            sa.VARCHAR(64),
            nullable=True,
            comment="SHA-256 hex digest of the uploaded file bytes. Set at "
                    "intake; used to hard-refuse exact re-uploads.",
        ),
    )
    op.create_index("ix_ai_uploads_file_hash", "ai_uploads", ["file_hash"])

    # ── Layer 1B — fingerprint + soft-flag for proposal_submissions ────────
    op.add_column(
        "proposal_submissions",
        sa.Column(
            "dedup_fingerprint",
            sa.VARCHAR(40),
            nullable=True,
            comment="SHA-1 of sha1(org_name + '|' + title + '|' + norm_ask). "
                    "Set after extraction completes. Nullable for legacy rows.",
        ),
    )
    op.create_index("ix_proposal_submissions_dedup_fingerprint",
                    "proposal_submissions", ["dedup_fingerprint"])
    op.add_column(
        "proposal_submissions",
        sa.Column(
            "is_duplicate",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
            comment="Soft-flag set when the fingerprint matches an earlier "
                    "row within the dedup window. Row still reviewable; "
                    "the drawer surfaces a warning pill.",
        ),
    )
    op.add_column(
        "proposal_submissions",
        sa.Column(
            "duplicate_of_id",
            sa.BigInteger,
            nullable=True,
            comment="Back-pointer to the earlier proposal this row is "
                    "suspected to duplicate. Plain FK-less BigInteger "
                    "so hard-delete of the original doesn't cascade.",
        ),
    )
    op.create_index("ix_proposal_submissions_duplicate_of_id",
                    "proposal_submissions", ["duplicate_of_id"])

    # ── Layer 1B — same triad for association_submissions ─────────────────
    op.add_column(
        "association_submissions",
        sa.Column(
            "dedup_fingerprint",
            sa.VARCHAR(40),
            nullable=True,
            comment="SHA-1 of sha1(association_name + '|' + norm_ask). "
                    "Set at create_from_extraction time.",
        ),
    )
    op.create_index("ix_association_submissions_dedup_fingerprint",
                    "association_submissions", ["dedup_fingerprint"])
    op.add_column(
        "association_submissions",
        sa.Column(
            "is_duplicate",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "association_submissions",
        sa.Column(
            "duplicate_of_id",
            sa.BigInteger,
            nullable=True,
        ),
    )
    op.create_index("ix_association_submissions_duplicate_of_id",
                    "association_submissions", ["duplicate_of_id"])


def downgrade() -> None:
    op.drop_index("ix_association_submissions_duplicate_of_id",
                  table_name="association_submissions")
    op.drop_column("association_submissions", "duplicate_of_id")
    op.drop_column("association_submissions", "is_duplicate")
    op.drop_index("ix_association_submissions_dedup_fingerprint",
                  table_name="association_submissions")
    op.drop_column("association_submissions", "dedup_fingerprint")

    op.drop_index("ix_proposal_submissions_duplicate_of_id",
                  table_name="proposal_submissions")
    op.drop_column("proposal_submissions", "duplicate_of_id")
    op.drop_column("proposal_submissions", "is_duplicate")
    op.drop_index("ix_proposal_submissions_dedup_fingerprint",
                  table_name="proposal_submissions")
    op.drop_column("proposal_submissions", "dedup_fingerprint")

    op.drop_index("ix_ai_uploads_file_hash", table_name="ai_uploads")
    op.drop_column("ai_uploads", "file_hash")
