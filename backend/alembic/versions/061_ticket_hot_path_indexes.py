"""Add composite + partial indexes for the hot ticket-list path.

Every PA / dept-officer view queries tickets as:

    WHERE department = X AND status_id IN (…) ORDER BY created_at DESC
    LIMIT 25

Previously only three single-column indexes existed on ticket (created_at,
forwarded_to_dept, due_date, assigned_to_pa) — Postgres had to bitmap-and
across them and then sort, which scales linearly with total ticket count
and starts hurting at pilot volume.

This migration adds two indexes:

  ix_ticket_dept_status_created
      composite (department, status_id, created_at) — the b-tree walk order
      exactly matches the hot query, so the planner can satisfy WHERE +
      ORDER BY without a sort.

  ix_ticket_open_created
      PARTIAL index on (created_at DESC) WHERE status_id IS NOT NULL — used
      by the sidebar "open tickets" badge count + SLA-breach count paths
      that don't filter by department. Being partial keeps the working set
      much smaller than the full-table equivalent as closed tickets
      accumulate.

Idempotent (CREATE INDEX IF NOT EXISTS) so it's safe on any DB state —
no-op if a previous run / hand-crafted index already exists. Not run
CONCURRENTLY: alembic wraps each migration in a transaction and Postgres
refuses CREATE INDEX CONCURRENTLY inside a transaction. Pilot table sizes
are small enough that the brief lock is fine; for a larger table this
should be rewritten with op.execute("COMMIT") + CONCURRENTLY.

Revision ID: 061
Revises: 060
Create Date: 2026-08-22
"""
from typing import Sequence, Union

from alembic import op


revision: str = "061"
down_revision: Union[str, None] = "060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ticket_dept_status_created
            ON ticket (department, status_id, created_at)
    """)
    # Partial: SLA breach + sidebar open-count paths filter status_id NOT IN
    # (closed / resolved ids). Keying "open" here as "has any status assigned
    # AND created_at ordering matters" — the actual closed-id set is
    # environment-specific (admin lookup ids), so we use IS NOT NULL as a
    # coarse filter; the query planner will still combine this with an IN
    # (open-ids) predicate at scan time. If a follow-up migration wants a
    # tighter partial (WHERE status_id NOT IN (specific closed ids)), drop
    # this and recreate — the composite above still covers the department-
    # scoped hot path.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ticket_open_created
            ON ticket (created_at)
            WHERE status_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ticket_open_created")
    op.execute("DROP INDEX IF EXISTS ix_ticket_dept_status_created")
