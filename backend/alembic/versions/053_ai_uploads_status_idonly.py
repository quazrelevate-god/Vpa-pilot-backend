"""ai_uploads.status → id-only (drop string bridge)

Revision ID: 053
Revises: 052
Create Date: 2026-08-06

Final stage of the v2 id-normalization cutover (domain: ai_uploads pipeline
status). The string `status` column is dropped; it is stored ONLY as a FK id
into the admin lookup (entity=ai_upload). The ORM keeps `status` as a hybrid
over the id — including an update_expression so the service's Core
`update(AiUpload).values(status=...)` claim/transition statements keep working.

Seeds the ai_upload states that were missing from admin (DISMISSED, ROUTED — the
latter added by the classifier-routing feature), backfills status_id, asserts
every row maps, then drops the string.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "053"
down_revision: Union[str, None] = "052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_AI_UPLOAD_STATES = [
    "QUEUED", "PROCESSING", "AWAITING_REVIEW", "REVIEWED",
    "FAILED", "DISMISSED", "ROUTED",
]


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1) Seed the full ai_upload state set (idempotent) ───────────────────────
    for i, name in enumerate(_AI_UPLOAD_STATES):
        op.execute(sa.text("""
            INSERT INTO admin (entity, name, sort_order, is_active)
            SELECT 'ai_upload', :n, :o, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM admin WHERE entity='ai_upload' AND name=:n)
        """).bindparams(n=name, o=i))

    # ── 2) Add status_id, backfill from the string ──────────────────────────────
    op.add_column("ai_uploads", sa.Column("status_id", sa.BigInteger(), nullable=True))
    op.execute("""
        UPDATE ai_uploads a SET status_id = adm.id
        FROM admin adm WHERE adm.entity='ai_upload' AND adm.name=a.status
    """)

    # ── 3) Assert every row mapped (status is NOT NULL) ─────────────────────────
    bad = conn.execute(sa.text(
        "SELECT count(*) FROM ai_uploads WHERE status_id IS NULL"
    )).scalar()
    if bad:
        rows = conn.execute(sa.text(
            "SELECT DISTINCT status FROM ai_uploads WHERE status_id IS NULL"
        )).fetchall()
        raise RuntimeError(
            f"{bad} ai_uploads row(s) have a status with no admin[ai_upload] match: "
            f"{[r[0] for r in rows]}."
        )

    # ── 4) FK + index, then NOT NULL ────────────────────────────────────────────
    op.create_index("ix_ai_uploads_status_id", "ai_uploads", ["status_id"])
    op.create_foreign_key(
        "fk_ai_uploads_status_admin", "ai_uploads", "admin", ["status_id"], ["id"],
    )
    op.alter_column("ai_uploads", "status_id", existing_type=sa.BigInteger(), nullable=False)

    # ── 5) Drop the string bridge (its index drops with it) ─────────────────────
    op.drop_index("ix_ai_uploads_status", table_name="ai_uploads")
    op.drop_column("ai_uploads", "status")


def downgrade() -> None:
    op.add_column("ai_uploads", sa.Column("status", sa.VARCHAR(length=20), nullable=True))
    op.execute("""
        UPDATE ai_uploads a SET status = adm.name
        FROM admin adm WHERE adm.id = a.status_id
    """)
    op.execute("UPDATE ai_uploads SET status = 'QUEUED' WHERE status IS NULL")
    op.alter_column("ai_uploads", "status", existing_type=sa.VARCHAR(length=20),
                    nullable=False, server_default="QUEUED")
    op.create_index("ix_ai_uploads_status", "ai_uploads", ["status"])

    op.drop_constraint("fk_ai_uploads_status_admin", "ai_uploads", type_="foreignkey")
    op.drop_index("ix_ai_uploads_status_id", table_name="ai_uploads")
    op.drop_column("ai_uploads", "status_id")
