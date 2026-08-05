"""GrievanceSummaryRecord classification → id-only (drop string bridges)

Revision ID: 052
Revises: 051
Create Date: 2026-08-06

Stage 3 of the v2 id-normalization cutover (domain: grievance_summary_records —
the AI-extraction snapshot). The string columns category/priority/ministry/
district are dropped; each is stored ONLY as a FK id into the admin lookup. The
ORM keeps them as hybrid properties over the ids, so from_gemini_response() and
every reader/query keeps working.

Correctness gate: because the AI snapshot is now stored as FKs, every enum value
Gemini can emit MUST exist in admin. This migration seeds admin from the code
enums (GrievanceCategory, UrgencyLevel, Ministry, District) and then ASSERTS that
every non-null string in the table resolves to an admin id before dropping the
strings — so nothing is silently lost, now or on future writes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "052"
down_revision: Union[str, None] = "051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _seed(entity: str, names) -> None:
    for i, name in enumerate(names):
        op.execute(sa.text("""
            INSERT INTO admin (entity, name, sort_order, is_active)
            SELECT :e, :n, :o, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM admin WHERE entity=:e AND name=:n)
        """).bindparams(e=entity, n=name, o=i))


def upgrade() -> None:
    conn = op.get_bind()
    from src.models.grievance_summary import (
        GrievanceCategory, UrgencyLevel, Ministry, District,
    )

    # ── 1) Seed admin from the code enums (superset of all Gemini outputs) ──────
    _seed("category", [c.value for c in GrievanceCategory])
    _seed("priority", [u.value for u in UrgencyLevel])
    _seed("ministry", [m.value for m in Ministry])
    _seed("district", [d.value for d in District if d.value != "unknown"])

    # ── 2) Add the FK id columns (nullable during backfill) ─────────────────────
    for col in ("category_id", "priority_id", "ministry_id", "district_id"):
        op.add_column("grievance_summary_records", sa.Column(col, sa.BigInteger(), nullable=True))

    # ── 3) Backfill from the strings via admin ──────────────────────────────────
    for col, entity in [("category", "category"), ("priority", "priority"),
                        ("ministry", "ministry"), ("district", "district")]:
        op.execute(sa.text(f"""
            UPDATE grievance_summary_records g SET {col}_id = adm.id
            FROM admin adm WHERE adm.entity='{entity}' AND adm.name=g.{col}
        """))

    # ── 4) Assert every non-null string resolved ────────────────────────────────
    for col in ("category", "priority", "ministry", "district"):
        bad = conn.execute(sa.text(
            f"SELECT count(*) FROM grievance_summary_records WHERE {col} IS NOT NULL AND {col}_id IS NULL"
        )).scalar()
        if bad:
            rows = conn.execute(sa.text(
                f"SELECT DISTINCT {col} FROM grievance_summary_records WHERE {col} IS NOT NULL AND {col}_id IS NULL"
            )).fetchall()
            raise RuntimeError(
                f"{bad} GSR row(s) have a {col} with no admin match: "
                f"{[r[0] for r in rows]}. Seed these into admin(entity='{col}') first."
            )

    # ── 5) FK constraints + indexes ─────────────────────────────────────────────
    for col in ("category", "priority", "ministry", "district"):
        op.create_index(f"ix_gsr_{col}_id", "grievance_summary_records", [f"{col}_id"])
        op.create_foreign_key(
            f"fk_gsr_{col}_admin", "grievance_summary_records", "admin",
            [f"{col}_id"], ["id"],
        )

    # category/priority/ministry were NOT NULL as strings — keep that on the ids.
    for col in ("category_id", "priority_id", "ministry_id"):
        op.alter_column("grievance_summary_records", col,
                        existing_type=sa.BigInteger(), nullable=False)

    # ── 6) Drop the string columns (their indexes drop with them) ───────────────
    for col in ("category", "priority", "ministry", "district"):
        op.drop_column("grievance_summary_records", col)


def downgrade() -> None:
    op.add_column("grievance_summary_records", sa.Column("category", sa.VARCHAR(length=50), nullable=True))
    op.add_column("grievance_summary_records", sa.Column("priority", sa.VARCHAR(length=20), nullable=True))
    op.add_column("grievance_summary_records", sa.Column("ministry", sa.VARCHAR(length=60), server_default="other", nullable=True))
    op.add_column("grievance_summary_records", sa.Column("district", sa.VARCHAR(length=40), nullable=True))

    for col in ("category", "priority", "ministry", "district"):
        op.execute(sa.text(f"""
            UPDATE grievance_summary_records g SET {col} = adm.name
            FROM admin adm WHERE adm.id = g.{col}_id
        """))
    op.execute("UPDATE grievance_summary_records SET ministry='other' WHERE ministry IS NULL")
    for col in ("category", "priority", "ministry"):
        op.alter_column("grievance_summary_records", col,
                        existing_type=sa.VARCHAR(length=60), nullable=False)

    for col in ("category", "priority", "ministry", "district"):
        op.drop_constraint(f"fk_gsr_{col}_admin", "grievance_summary_records", type_="foreignkey")
        op.drop_index(f"ix_gsr_{col}_id", table_name="grievance_summary_records")
        op.drop_column("grievance_summary_records", f"{col}_id")

    op.create_index("ix_gsr_priority", "grievance_summary_records", ["priority"])
    op.create_index("ix_gsr_category", "grievance_summary_records", ["category"])
    op.create_index("ix_gsr_ministry", "grievance_summary_records", ["ministry"])
    op.create_index("ix_gsr_district", "grievance_summary_records", ["district"])
