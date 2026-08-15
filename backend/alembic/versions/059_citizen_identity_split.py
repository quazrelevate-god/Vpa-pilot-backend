"""split citizen dedup: identity_index=(name,mobile), mobile_index=mobile-only

Revision ID: 059
Revises: 058
Create Date: 2026-08-15

Historically citizens.identity_index held HMAC(mobile only) despite its name,
so every re-submission with the same phone but a different name was forced
onto the SAME citizen row and overwrote the previous submitter's name in
place. In shared-phone households (very common) this corrupted every
previous appointment's displayed submitter.

This revision splits the semantics into two columns:

  identity_index  — HMAC(normalise(name) | digits(mobile)) — UNIQUE
                    One row per unique (name, mobile) pair. Same phone
                    with a new name creates a new citizen row instead of
                    overwriting.

  mobile_index    — HMAC(digits(mobile)) — non-unique index (NEW)
                    Used by the "one petition per phone per day" rate
                    gate and any mobile-scoped join. Kept separate so a
                    citizen splitting into N name-rows still counts as
                    one phone for rate-limiting.

Historically clobbered names cannot be recovered from the citizen row
alone (previous overwrites are lost). This migration only stops the
bleeding going forward — every new submission preserves its own name.

Backfill safety: existing rows had mobile-unique identity_index values,
so recomputing to HMAC(name|mobile) keeps them unique — no collision
risk. Rows whose PII cannot be decrypted (extremely rare) fall back to
NULL for both columns; Postgres allows many NULLs under a UNIQUE index.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from src.core import crypto


revision: str = "059"
down_revision: Union[str, None] = "058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _decrypt_safe(token):
    if token is None:
        return None
    try:
        return crypto.decrypt(token)
    except Exception:
        return None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Add the new mobile-only blind-index column.
    op.add_column(
        "citizens",
        sa.Column("mobile_index", sa.String(64), nullable=True),
    )
    op.create_index("ix_citizens_mobile_index", "citizens", ["mobile_index"])

    # 2) Backfill both columns from decrypted PII, one UPDATE per row.
    #    Small tables in this pilot; a set-based CTE isn't worth the
    #    complexity when we need the crypto helper in Python.
    rows = bind.execute(
        sa.text("SELECT id, encrypted_name, encrypted_mobile FROM citizens")
    ).fetchall()

    for row in rows:
        cid, enc_name, enc_mobile = row
        name   = _decrypt_safe(enc_name)
        mobile = _decrypt_safe(enc_mobile)
        mob_idx   = crypto.blind_index(mobile) if mobile else None
        ident_idx = crypto.identity_blind_index(name, mobile)
        bind.execute(
            sa.text(
                "UPDATE citizens "
                "SET mobile_index = :mob, identity_index = :ident "
                "WHERE id = :id"
            ),
            {"mob": mob_idx, "ident": ident_idx, "id": cid},
        )


def downgrade() -> None:
    bind = op.get_bind()

    # Restore identity_index to mobile-only HMAC (the pre-059 meaning).
    rows = bind.execute(
        sa.text("SELECT id, encrypted_mobile FROM citizens")
    ).fetchall()
    for row in rows:
        cid, enc_mobile = row
        mobile  = _decrypt_safe(enc_mobile)
        mob_idx = crypto.blind_index(mobile) if mobile else None
        bind.execute(
            sa.text("UPDATE citizens SET identity_index = :ident WHERE id = :id"),
            {"ident": mob_idx, "id": cid},
        )

    op.drop_index("ix_citizens_mobile_index", table_name="citizens")
    op.drop_column("citizens", "mobile_index")
