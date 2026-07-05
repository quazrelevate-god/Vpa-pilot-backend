"""
v1 → v2 structural cutover + admin seed (shared by the alembic revision 025 and
the standalone runner scripts/migrate_v1_to_v2.py).

The Railway DB is built from alembic 001→024 (v1: plural table names, string
statuses, separate event/booking tables). v2 is the normalised schema our
feature branch runs on: singular table names, an `admin` lookup driving
status/priority/category FKs, a unified `activity` audit log, and a lean
`availability`/`slots` split.

`run_cutover(engine)` performs the whole transformation inside ONE transaction
so a failure rolls back cleanly. It is idempotent: if the `appointment`
(singular) table already exists it assumes v2 and no-ops.

NOTHING here targets a specific database — the caller supplies the engine. Do
NOT point it at Railway until you have explicitly decided to migrate.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


# ── admin lookup seed (mirrors scripts/init_v2_schema.seed_admin) ─────────────
def _admin_groups() -> dict[str, list[str]]:
    from src.models.ticket_models import TicketStatus, TicketPriority
    from src.models.grievance_summary import GrievanceCategory, Ministry

    return {
        "appointment": ["SCHEDULED", "WAITING", "RESCHEDULED",
                        "AWAITING_REVIEW", "REVIEWED", "NOT_CAME", "COURTESY_DONE"],
        "ticket":     [s.value for s in TicketStatus],
        "priority":   [p.value for p in TicketPriority],
        "category":   [c.value for c in GrievanceCategory],
        "ministry":   [m.value for m in Ministry],
        "ai_upload":  ["QUEUED", "PROCESSING", "AWAITING_REVIEW", "REVIEWED", "FAILED"],
        "department": [
            "Director of School Education", "Directorate of Private Schools",
            "Elementary Education", "Government Examinations",
            "Non-Formal and Adult Education", "Public Libraries",
            "State Council of Educational Research and Training (SCERT)",
            "Teacher Recruitment Board", "Tamil Nadu Education Service Corporation",
            "Samagra Shiksha",
        ],
    }


# ── New-table DDL (admin / login / activity) ─────────────────────────────────
_NEW_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS admin (
        id         BIGSERIAL PRIMARY KEY,
        entity     VARCHAR(30)  NOT NULL,
        name       VARCHAR(100) NOT NULL,
        sort_order INTEGER      NOT NULL DEFAULT 0,
        is_active  BOOLEAN      NOT NULL DEFAULT true,
        CONSTRAINT uq_admin_entity_name UNIQUE (entity, name)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_admin_entity ON admin(entity)",
    """
    CREATE TABLE IF NOT EXISTS login (
        id         BIGSERIAL PRIMARY KEY,
        login_name VARCHAR(100) NOT NULL UNIQUE,
        password   VARCHAR(255) NOT NULL,
        scope      JSONB        NOT NULL DEFAULT '{}',
        is_active  BOOLEAN      NOT NULL DEFAULT true,
        created_at TIMESTAMP    NOT NULL DEFAULT now()
    )""",
    """
    CREATE TABLE IF NOT EXISTS activity (
        id             BIGSERIAL PRIMARY KEY,
        appointment_id BIGINT REFERENCES appointment(id) ON DELETE CASCADE,
        ticket_id      BIGINT REFERENCES ticket(id) ON DELETE CASCADE,
        "user"         VARCHAR(100) NOT NULL,
        action_type    VARCHAR(40)  NOT NULL,
        message        TEXT,
        payload        JSONB,
        created_at     TIMESTAMP    NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS ix_activity_appt_created ON activity(appointment_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_activity_ticket_created ON activity(ticket_id, created_at)",
]

# ── Structural transform, in dependency-safe order ───────────────────────────
# Each entry is one SQL statement. Renames first (so later FK targets resolve),
# then column adds/renames, data backfills, then drops.
_TRANSFORM = [
    # ── 1. Table renames ────────────────────────────────────────────────────
    "ALTER TABLE mlas                   RENAME TO mla",
    "ALTER TABLE mla_daily_availability RENAME TO availability",
    "ALTER TABLE appointment_slots      RENAME TO slots",
    "ALTER TABLE appointments           RENAME TO appointment",
    "ALTER TABLE appointment_attachments RENAME TO attachments",
    "ALTER TABLE tickets                RENAME TO ticket",
    "ALTER TABLE gatekeeper_sessions    RENAME TO gatekeeper",
    "ALTER TABLE otp_verifications      RENAME TO otp_verification",

    # ── 2. availability: status(string) → is_open(bool) ─────────────────────
    "ALTER TABLE availability ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT true",
    "UPDATE availability SET is_open = (status = 'ACTIVE')",
    "ALTER TABLE availability DROP COLUMN IF EXISTS start_time",
    "ALTER TABLE availability DROP COLUMN IF EXISTS end_time",
    "ALTER TABLE availability DROP COLUMN IF EXISTS status",
    "ALTER TABLE availability DROP COLUMN IF EXISTS created_at",
    "ALTER TABLE availability DROP COLUMN IF EXISTS created_by",

    # ── 3. slots: drop created_at ───────────────────────────────────────────
    "ALTER TABLE slots DROP COLUMN IF EXISTS created_at",

    # ── 4. appointment: renames, new FK cols, slot linkage, drops ───────────
    "ALTER TABLE appointment RENAME COLUMN token_assigned     TO token_number",
    "ALTER TABLE appointment RENAME COLUMN grievance_category TO category",
    "ALTER TABLE appointment ADD COLUMN IF NOT EXISTS venue       VARCHAR(100)",
    "ALTER TABLE appointment ADD COLUMN IF NOT EXISTS status_id   BIGINT",
    "ALTER TABLE appointment ADD COLUMN IF NOT EXISTS priority_id BIGINT",
    "ALTER TABLE appointment ADD COLUMN IF NOT EXISTS category_id BIGINT",
    # slot_id was a daily-counter int in v1; the real booked slot is
    # appointment_slot_id. Repoint slot_id at the renamed slots table.
    "ALTER TABLE appointment ALTER COLUMN slot_id DROP NOT NULL",
    "UPDATE appointment SET slot_id = appointment_slot_id",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS appointment_slot_id",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS audio_recording_url",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS encrypted_name",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS pre_floor_status",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS priority_score",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS scheduled_date",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS scheduled_start_time",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS scheduled_end_time",
    "ALTER TABLE appointment DROP COLUMN IF EXISTS source",

    # ── 5. citizens: mobile_index → identity_index, drop ward_or_region ─────
    "ALTER TABLE citizens RENAME COLUMN mobile_index TO identity_index",
    "ALTER TABLE citizens DROP COLUMN IF EXISTS ward_or_region",

    # ── 6. gatekeeper: carry venue to the appointment on submit ─────────────
    "ALTER TABLE gatekeeper ADD COLUMN IF NOT EXISTS venue_id VARCHAR(100)",

    # ── 7. otp_verification: link to the appointment it authorised ──────────
    "ALTER TABLE otp_verification ADD COLUMN IF NOT EXISTS token_assigned BIGINT",
    "CREATE INDEX IF NOT EXISTS ix_otp_verification_token_assigned ON otp_verification(token_assigned)",

    # ── 8. ticket: normalised FK columns + login owner + notes ──────────────
    "ALTER TABLE ticket ADD COLUMN IF NOT EXISTS status_id   BIGINT",
    "ALTER TABLE ticket ADD COLUMN IF NOT EXISTS priority_id BIGINT",
    "ALTER TABLE ticket ADD COLUMN IF NOT EXISTS assigned_to BIGINT",
    "ALTER TABLE ticket ADD COLUMN IF NOT EXISTS notes       TEXT",

    # ── 9. attachments: shared between appointment + ticket ─────────────────
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS ticket_id BIGINT",
]

# Event/booking tables folded into `activity`, then dropped.
_FOLD_ACTIVITY = [
    """INSERT INTO activity (appointment_id, "user", action_type, message, payload, created_at)
       SELECT appointment_id, actor, event_type, note, payload, created_at
       FROM appointment_events""",
    """INSERT INTO activity (ticket_id, "user", action_type, message, payload, created_at)
       SELECT ticket_id, actor, event_type, note, payload, created_at
       FROM ticket_events""",
    """INSERT INTO activity (appointment_id, "user", action_type, message, payload, created_at)
       SELECT appointment_id, COALESCE(rescheduled_by, 'system'), 'rescheduled',
              reason_details,
              jsonb_build_object('old_slot_id', old_slot_id, 'new_slot_id', new_slot_id,
                                 'reason', reason),
              created_at
       FROM reschedule_logs""",
    "DROP TABLE IF EXISTS appointment_events",
    "DROP TABLE IF EXISTS ticket_events",
    "DROP TABLE IF EXISTS reschedule_logs",
    "DROP TABLE IF EXISTS slot_bookings",
]

# FK-id backfills from the freshly-seeded admin lookup.
_BACKFILL = [
    "UPDATE appointment a SET status_id = m.id FROM admin m "
    "WHERE m.entity='appointment' AND m.name = a.status AND a.status_id IS NULL",
    "UPDATE appointment a SET category_id = m.id FROM admin m "
    "WHERE m.entity='category' AND m.name = a.category AND a.category_id IS NULL",
    "UPDATE ticket t SET status_id = m.id FROM admin m "
    "WHERE m.entity='ticket' AND m.name = t.status AND t.status_id IS NULL",
    "UPDATE ticket t SET priority_id = m.id FROM admin m "
    "WHERE m.entity='priority' AND m.name = t.priority AND t.priority_id IS NULL",
]

# FK constraints added AFTER data is consistent.
_CONSTRAINTS = [
    "ALTER TABLE appointment ADD CONSTRAINT appointment_slot_id_fkey "
    "FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE SET NULL",
    "ALTER TABLE appointment ADD CONSTRAINT appointment_status_id_fkey "
    "FOREIGN KEY (status_id) REFERENCES admin(id)",
    "ALTER TABLE appointment ADD CONSTRAINT appointment_priority_id_fkey "
    "FOREIGN KEY (priority_id) REFERENCES admin(id)",
    "ALTER TABLE appointment ADD CONSTRAINT appointment_category_id_fkey "
    "FOREIGN KEY (category_id) REFERENCES admin(id)",
    "ALTER TABLE ticket ADD CONSTRAINT ticket_status_id_fkey "
    "FOREIGN KEY (status_id) REFERENCES admin(id)",
    "ALTER TABLE ticket ADD CONSTRAINT ticket_priority_id_fkey "
    "FOREIGN KEY (priority_id) REFERENCES admin(id)",
    "ALTER TABLE ticket ADD CONSTRAINT ticket_assigned_to_fkey "
    "FOREIGN KEY (assigned_to) REFERENCES login(id) ON DELETE SET NULL",
    "ALTER TABLE attachments ADD CONSTRAINT attachments_ticket_id_fkey "
    "FOREIGN KEY (ticket_id) REFERENCES ticket(id) ON DELETE CASCADE",
]


def _seed_admin(conn) -> int:
    inserted = 0
    for entity, names in _admin_groups().items():
        for i, name in enumerate(names):
            r = conn.execute(text(
                "INSERT INTO admin (entity, name, sort_order) "
                "VALUES (:e, :n, :s) ON CONFLICT (entity, name) DO NOTHING"),
                {"e": entity, "n": name, "s": i})
            inserted += r.rowcount or 0
    return inserted


def already_v2(conn) -> bool:
    return conn.execute(text(
        "SELECT to_regclass('public.appointment') IS NOT NULL "
        "AND to_regclass('public.admin') IS NOT NULL")).scalar()


def run_cutover_conn(conn, *, verbose: bool = True) -> dict:
    """Do the whole cutover on an EXISTING connection/transaction.

    Used by the alembic revision (which supplies op.get_bind()). The caller owns
    the transaction — nothing here commits or rolls back.
    """
    def log(msg):
        if verbose:
            print(msg)

    if already_v2(conn):
        log("[cutover] already v2 (appointment + admin exist) — no-op.")
        return {"status": "already_v2"}

    if conn.execute(text("SELECT to_regclass('public.appointments')")).scalar() is None:
        raise RuntimeError("Neither v1 'appointments' nor v2 'appointment' found — "
                           "unexpected schema; aborting.")

    log("[cutover] 1/6 renaming tables + column transforms…")
    for stmt in _TRANSFORM:
        conn.execute(text(stmt))

    log("[cutover] 2/6 creating admin/login/activity…")
    for stmt in _NEW_TABLES:
        conn.execute(text(stmt))

    log("[cutover] 3/6 seeding admin lookup…")
    n = _seed_admin(conn)
    log(f"           admin rows inserted: {n}")

    log("[cutover] 4/6 folding events/reschedule/bookings into activity…")
    for stmt in _FOLD_ACTIVITY:
        conn.execute(text(stmt))

    log("[cutover] 5/6 backfilling status/priority/category FK ids…")
    for stmt in _BACKFILL:
        conn.execute(text(stmt))

    log("[cutover] 6/6 adding FK constraints…")
    for stmt in _CONSTRAINTS:
        conn.execute(text(stmt))

    log("[cutover] done — schema is now v2.")
    return {"status": "migrated", "admin_seeded": n}


def run_cutover(engine: Engine, *, verbose: bool = True) -> dict:
    """Transform a v1 database to v2 in a single transaction. Idempotent."""
    with engine.begin() as conn:
        return run_cutover_conn(conn, verbose=verbose)
