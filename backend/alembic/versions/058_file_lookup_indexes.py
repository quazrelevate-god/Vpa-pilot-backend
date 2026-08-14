"""file lookup indexes on storage_url

Revision ID: 058
Revises: 057
Create Date: 2026-08-15

The file-server authorization pass (H2 fix) turns every /dashboard/api/files/*
request into a `SELECT ... WHERE storage_url = <key>` on the owning table.
Without indexes these become sequential scans that get slower as the tables
grow (fine at 500 rows, ~200ms per fetch at 50k). A page that renders 3-4
attachments compounds that.

Pure DDL — no data touched, no downtime. Postgres builds a btree on Text
values fast; CREATE INDEX does not block reads. Rollback drops cleanly.

Not indexing proposal_submissions.documents / association_submissions.documents:
those are JSONB arrays of {storage_url, ...} — indexing needs a GIN
expression, and those endpoints are cold-path (Minister-only, one review at
a time). Sequential scan on those small tables stays fine.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "058"
down_revision: Union[str, None] = "057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # One btree index per storage-url-bearing table. Each is what the file
    # server's per-request owner lookup queries by. Not marked UNIQUE — the
    # authorization check tolerates duplicate rows pointing at the same key
    # (any-match passes), and enforcing uniqueness would break existing rows
    # if the intake ever wrote the same key twice.
    op.create_index("ix_attachments_storage_url", "attachments", ["storage_url"])
    op.create_index("ix_ticket_attachments_storage_url", "ticket_attachments", ["storage_url"])
    op.create_index("ix_ai_uploads_storage_url", "ai_uploads", ["storage_url"])


def downgrade() -> None:
    op.drop_index("ix_ai_uploads_storage_url", table_name="ai_uploads")
    op.drop_index("ix_ticket_attachments_storage_url", table_name="ticket_attachments")
    op.drop_index("ix_attachments_storage_url", table_name="attachments")
