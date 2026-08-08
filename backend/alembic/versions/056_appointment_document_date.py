"""appointment.document_date — enable document-date filter on petitions

Revision ID: 056
Revises: 055
Create Date: 2026-08-08

Petitions had no `document_date` column of their own — the extracted date
lived only on `grievance_summary_records`, so any list/ticket filter by
document date required a JOIN and could not be indexed off the primary
table. Association / Proposal have carried their own top-level
`document_date` since day one; this brings appointments to parity.

Additive-only:
  * `document_date` is nullable — every existing row remains valid.
  * New rows created by the QR citizen form / kiosk intake / staff
    manual-entry auto-seed this to today's date at submit time so a
    document_date filter always finds them (see appointment_service +
    api/v1/appointments write-paths).
  * The AI-scan pipeline continues to write whatever extraction reads
    off the scanned document (via GSR + shadow-appointment mint); no
    change there.
  * Later extraction on form-uploaded PDFs may overwrite the seed if
    it finds a printed date on the document — that's more accurate
    than the submission date and matches how proposal_submissions and
    association_submissions already behave.

Indexed because it's a hot filter path — the tickets and AI-review
lists will filter on it and would fall back to seq-scanning `appointment`
without this.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "056"
down_revision: Union[str, None] = "055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "appointment",
        sa.Column(
            "document_date",
            sa.VARCHAR(10),
            nullable=True,
            comment="ISO YYYY-MM-DD. Auto-seeded to submit date for form "
                    "submissions; overwritten by Gemini extraction if the "
                    "attached document has a printed date. Nullable for "
                    "legacy rows created before migration 056.",
        ),
    )
    op.create_index(
        "ix_appointment_document_date",
        "appointment",
        ["document_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointment_document_date", table_name="appointment")
    op.drop_column("appointment", "document_date")
