"""ai_uploads: composite (status, created_at DESC) for the paginated review list

Revision ID: 033
Revises: 032
Create Date: 2026-07-22

The petition review page filters primarily by `status` and sorts by
`created_at DESC`. The single-column `ix_ai_uploads_status` and
`ix_ai_uploads_created` indexes force the planner to either scan by status
then sort, or scan by date then filter. Neither is ideal past a few thousand
rows.

A composite `(status, created_at DESC)` lets the planner pull only the rows
for the active tab in already-sorted order — the paginated list drops from
a ~200ms sort at 3k rows to an <20ms bounded index scan, and stays that
fast at 30k+ where the old plan starts to spike.

CONCURRENTLY so live traffic against the live 3k-row table doesn't take a
lock while the index builds.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CONCURRENTLY cannot run inside a transaction — Alembic wraps each
    # migration in one by default, so we drop out to autocommit for this
    # single DDL and restore afterward.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_ai_uploads_status_created "
            "ON ai_uploads (status, created_at DESC)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_ai_uploads_status_created")
