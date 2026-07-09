"""venue registry + FK on appointment.venue

Revision ID: 027
Revises: 026
Create Date: 2026-07-09

Adds `venue_registry` — the super-admin-managed list of scan venues (offices /
camps) — and turns `appointment.venue` into a real FOREIGN KEY into it.

Order matters so the FK can't fail on existing data:
  1. create venue_registry (unique key)
  2. normalise blank venues to NULL
  3. seed the default "main_office" venue + backfill every distinct
     appointment.venue already in the DB (display defaults to the key; the
     super-admin can rename it later)
  4. add the FK appointment.venue -> venue_registry.key
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "venue_registry",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("display_en", sa.String(length=200), nullable=False),
        sa.Column("display_ta", sa.String(length=200), nullable=True),
        sa.Column("address", sa.String(length=400), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
    )
    op.create_unique_constraint("uq_venue_registry_key", "venue_registry", ["key"])

    # Blank venues would violate the FK — normalise them to NULL first.
    op.execute("UPDATE appointment SET venue = NULL WHERE venue IS NOT NULL AND btrim(venue) = ''")

    # Seed the default display venue (the QR display's default venue_id).
    op.execute(
        "INSERT INTO venue_registry (key, display_en, is_active, is_builtin, created_at, updated_at) "
        "VALUES ('main_office', 'Main Office', true, true, now(), now()) "
        "ON CONFLICT (key) DO NOTHING"
    )

    # Backfill every distinct venue already used on appointments so the FK holds.
    op.execute(
        "INSERT INTO venue_registry (key, display_en, is_active, is_builtin, created_at, updated_at) "
        "SELECT DISTINCT venue, venue, true, false, now(), now() FROM appointment "
        "WHERE venue IS NOT NULL AND btrim(venue) <> '' "
        "ON CONFLICT (key) DO NOTHING"
    )

    op.create_foreign_key(
        "fk_appointment_venue",
        source_table="appointment",
        referent_table="venue_registry",
        local_cols=["venue"],
        remote_cols=["key"],
        onupdate="CASCADE",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_appointment_venue", "appointment", type_="foreignkey")
    op.drop_table("venue_registry")
