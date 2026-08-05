"""Appointment status/category → id-only (drop string bridges)

Revision ID: 050
Revises: 049
Create Date: 2026-08-06

Stage 1 of the v2 id-normalization cutover (domain: appointment). The string
columns `status` and `category` (ORM attr grievance_category) are dropped;
classification is stored ONLY as FK ids into the admin lookup
(status_id → admin[entity=appointment], category_id → admin[entity=category]).
The dead `priority_id` (write-only, read nowhere) is dropped too.

The ORM keeps `status` / `grievance_category` as hybrid properties over the ids
(see appointment_models), so every call site keeps working unchanged.

Data cleaning done here (found on the copy DB):
  * appointment.category held title-case junk ('Action Required', 'General',
    'Pension Requests', 'Proposals', 'School Admission') mixed with machine
    values. Normalised to lower_snake so they resolve to admin categories.
  * appointment.status 'DISMISSED' was missing from the admin lookup — seeded.

Every non-null status/category is asserted to resolve to an admin id before the
string columns are dropped, so nothing is silently lost.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "050"
down_revision: Union[str, None] = "049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1) Seed any missing admin rows this domain needs ────────────────────────
    # DISMISSED appointment status exists in data but was absent from the seed.
    op.execute("""
        INSERT INTO admin (entity, name, sort_order, is_active)
        SELECT 'appointment', 'DISMISSED',
               COALESCE((SELECT MAX(sort_order)+1 FROM admin WHERE entity='appointment'), 0),
               TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM admin WHERE entity='appointment' AND name='DISMISSED'
        )
    """)

    # ── 2) Clean the dirty category strings → lower_snake machine form ───────────
    # 'Action Required' → 'action_required', 'School Admission' → 'school_admission'.
    # Already-machine values (no spaces) are unchanged.
    op.execute("""
        UPDATE appointment
        SET category = lower(replace(trim(category), ' ', '_'))
        WHERE category IS NOT NULL
    """)

    # ── 3) Backfill the FK ids from the (cleaned) strings ───────────────────────
    op.execute("""
        UPDATE appointment a
        SET status_id = adm.id
        FROM admin adm
        WHERE adm.entity = 'appointment' AND adm.name = a.status
    """)
    op.execute("""
        UPDATE appointment a
        SET category_id = adm.id
        FROM admin adm
        WHERE adm.entity = 'category' AND adm.name = a.category
    """)

    # ── 4) Assert nothing failed to map before we drop the strings ──────────────
    bad_status = conn.execute(sa.text(
        "SELECT count(*) FROM appointment WHERE status IS NOT NULL AND status_id IS NULL"
    )).scalar()
    if bad_status:
        rows = conn.execute(sa.text(
            "SELECT DISTINCT status FROM appointment WHERE status IS NOT NULL AND status_id IS NULL"
        )).fetchall()
        raise RuntimeError(
            f"{bad_status} appointment row(s) have a status with no admin match: "
            f"{[r[0] for r in rows]}. Seed these into admin(entity='appointment') first."
        )
    bad_cat = conn.execute(sa.text(
        "SELECT count(*) FROM appointment WHERE category IS NOT NULL AND category_id IS NULL"
    )).scalar()
    if bad_cat:
        rows = conn.execute(sa.text(
            "SELECT DISTINCT category FROM appointment WHERE category IS NOT NULL AND category_id IS NULL"
        )).fetchall()
        raise RuntimeError(
            f"{bad_cat} appointment row(s) have a category with no admin match: "
            f"{[r[0] for r in rows]}. Seed these into admin(entity='category') first."
        )

    # ── 5) Promote status_id/category_id to real FKs + index ────────────────────
    op.create_index("ix_appointments_status_id", "appointment", ["status_id"])
    op.create_foreign_key(
        "fk_appointment_status_admin", "appointment", "admin", ["status_id"], ["id"],
    )
    op.create_foreign_key(
        "fk_appointment_category_admin", "appointment", "admin", ["category_id"], ["id"],
    )

    # ── 6) Drop the string bridges + the dead priority_id ───────────────────────
    op.drop_index("ix_appointments_status", table_name="appointment")
    op.drop_column("appointment", "status")
    op.drop_column("appointment", "category")
    op.drop_column("appointment", "priority_id")


def downgrade() -> None:
    # Re-add the string columns + dead priority_id, backfill from the ids.
    op.add_column("appointment", sa.Column("status", sa.String(length=20), nullable=True))
    op.add_column("appointment", sa.Column("category", sa.String(length=50), nullable=True))
    op.add_column("appointment", sa.Column("priority_id", sa.BigInteger(), nullable=True))

    op.execute("""
        UPDATE appointment a
        SET status = adm.name
        FROM admin adm
        WHERE adm.id = a.status_id
    """)
    op.execute("""
        UPDATE appointment a
        SET category = adm.name
        FROM admin adm
        WHERE adm.id = a.category_id
    """)
    op.execute("UPDATE appointment SET status = 'SCHEDULED' WHERE status IS NULL")
    op.alter_column("appointment", "status", existing_type=sa.String(length=20), nullable=False)

    op.drop_constraint("fk_appointment_category_admin", "appointment", type_="foreignkey")
    op.drop_constraint("fk_appointment_status_admin", "appointment", type_="foreignkey")
    op.drop_index("ix_appointments_status_id", table_name="appointment")
    op.create_index("ix_appointments_status", "appointment", ["status"])
