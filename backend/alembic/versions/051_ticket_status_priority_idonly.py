"""Ticket status/priority → id-only (drop string bridges)

Revision ID: 051
Revises: 050
Create Date: 2026-08-06

Stage 2 of the v2 id-normalization cutover (domain: ticket). The string columns
`status` and `priority` are dropped; both are stored ONLY as FK ids into the
admin lookup (status_id → admin[ticket], priority_id → admin[priority]). The ORM
keeps them as hybrid properties over the ids, so every call site is unchanged.

Priority taxonomy reconciliation (confirmed against the copy DB):
  ticket.priority held a MIX of legacy P0-P3 and UrgencyLevel (low/medium/
  high/critical). We standardise on UrgencyLevel and remap the legacy values:
      P0 → critical, P1 → high, P2 → medium, P3 → low
  and seed low/medium/high/critical into admin[priority] (the legacy P0-P3 rows
  are left in place, harmless, in case anything still resolves them by name).

Every non-null status/priority is asserted to resolve to an admin id before the
string columns are dropped.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "051"
down_revision: Union[str, None] = "050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_URGENCY = [("low", 10), ("medium", 20), ("high", 30), ("critical", 40)]


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1) Seed admin[priority] with the UrgencyLevel scale ─────────────────────
    for name, order in _URGENCY:
        op.execute(sa.text("""
            INSERT INTO admin (entity, name, sort_order, is_active)
            SELECT 'priority', :n, :o, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM admin WHERE entity='priority' AND name=:n)
        """).bindparams(n=name, o=order))

    # ── 2) Remap legacy P0-P3 priorities → UrgencyLevel ─────────────────────────
    op.execute("""
        UPDATE ticket SET priority = CASE priority
            WHEN 'P0' THEN 'critical'
            WHEN 'P1' THEN 'high'
            WHEN 'P2' THEN 'medium'
            WHEN 'P3' THEN 'low'
            ELSE priority
        END
        WHERE priority IS NOT NULL
    """)

    # ── 3) Backfill the FK ids from the strings ─────────────────────────────────
    op.execute("""
        UPDATE ticket t SET status_id = adm.id
        FROM admin adm WHERE adm.entity='ticket' AND adm.name=t.status
    """)
    op.execute("""
        UPDATE ticket t SET priority_id = adm.id
        FROM admin adm WHERE adm.entity='priority' AND adm.name=t.priority
    """)

    # ── 4) Assert nothing failed to map ─────────────────────────────────────────
    for col, cid, entity in [("status", "status_id", "ticket"),
                             ("priority", "priority_id", "priority")]:
        bad = conn.execute(sa.text(
            f"SELECT count(*) FROM ticket WHERE {col} IS NOT NULL AND {cid} IS NULL"
        )).scalar()
        if bad:
            rows = conn.execute(sa.text(
                f"SELECT DISTINCT {col} FROM ticket WHERE {col} IS NOT NULL AND {cid} IS NULL"
            )).fetchall()
            raise RuntimeError(
                f"{bad} ticket row(s) have a {col} with no admin[{entity}] match: "
                f"{[r[0] for r in rows]}."
            )

    # ── 5) Promote status_id/priority_id to real FKs + indexes ──────────────────
    op.create_index("ix_tickets_status_id", "ticket", ["status_id"])
    op.create_index("ix_tickets_priority_id", "ticket", ["priority_id"])
    op.create_foreign_key("fk_ticket_status_admin", "ticket", "admin", ["status_id"], ["id"])
    op.create_foreign_key("fk_ticket_priority_admin", "ticket", "admin", ["priority_id"], ["id"])

    # ── 6) Drop the string bridges + their indexes ──────────────────────────────
    op.drop_index("ix_tickets_status", table_name="ticket")
    op.drop_index("ix_tickets_priority", table_name="ticket")
    op.drop_column("ticket", "status")
    op.drop_column("ticket", "priority")


def downgrade() -> None:
    op.add_column("ticket", sa.Column("status", sa.VARCHAR(length=30), nullable=True))
    op.add_column("ticket", sa.Column("priority", sa.VARCHAR(length=20), nullable=True))
    op.execute("""
        UPDATE ticket t SET status = adm.name
        FROM admin adm WHERE adm.id = t.status_id
    """)
    op.execute("""
        UPDATE ticket t SET priority = adm.name
        FROM admin adm WHERE adm.id = t.priority_id
    """)
    op.execute("UPDATE ticket SET status = 'open' WHERE status IS NULL")
    op.alter_column("ticket", "status", existing_type=sa.VARCHAR(length=30), nullable=False)

    op.drop_constraint("fk_ticket_priority_admin", "ticket", type_="foreignkey")
    op.drop_constraint("fk_ticket_status_admin", "ticket", type_="foreignkey")
    op.drop_index("ix_tickets_priority_id", table_name="ticket")
    op.drop_index("ix_tickets_status_id", table_name="ticket")
    op.create_index("ix_tickets_status", "ticket", ["status"])
    op.create_index("ix_tickets_priority", "ticket", ["priority"])
