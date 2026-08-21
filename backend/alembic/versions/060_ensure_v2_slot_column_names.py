"""Ensure the slots table uses the v2 column names the ORM expects.

Background: the v1→v2 slot rename (total_slots → max_capacity,
slots_booked → booked_count) lived only in scripts/migrate_v2_final.sql,
never in an alembic revision. Result: a DB that reached the current alembic
head purely through `alembic upgrade head` (without running the standalone
SQL first) still had the v1 column names, so every slot query the ORM issued
500'd with UndefinedColumn.

This migration closes that gap. It's fully idempotent — safe to run on:
  • a DB that already had the rename (via migrate_v2_final.sql) → no-op;
  • a DB with only the v1 names → performs the rename;
  • a DB with neither name (fresh partial-state) → no-op (no crash).

Only touches the `slots` table (v2). The unrelated v1 `appointment_slots`
table left over from migration 001 is not affected.

Revision ID: 060
Revises: 059
Create Date: 2026-08-21
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect


revision: str = "060"
down_revision: Union[str, None] = "059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLE = "slots"
_RENAMES = (
    # (from, to)
    ("total_slots", "max_capacity"),
    ("slots_booked", "booked_count"),
)


def _column_names(bind, table: str) -> set[str]:
    """Return the set of column names on `table`, or empty if it doesn't exist."""
    inspector = inspect(bind)
    if not inspector.has_table(table):
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, _TABLE)
    if not cols:
        # No `slots` table at all — fresh DB that hasn't been bootstrapped
        # yet, or a partial state. Downstream migrations / app startup will
        # surface the real problem; nothing sensible to do here.
        return

    for old, new in _RENAMES:
        # Only rename when the OLD column exists AND the NEW one does not.
        # Any other state (already renamed, both present, neither present)
        # is a no-op — we never overwrite existing columns.
        if old in cols and new not in cols:
            op.alter_column(_TABLE, old, new_column_name=new)


def downgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, _TABLE)
    if not cols:
        return

    for old, new in _RENAMES:
        if new in cols and old not in cols:
            op.alter_column(_TABLE, new, new_column_name=old)
