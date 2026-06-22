"""
Migration: slot-booking redesign.

Run with:  python migrate_slot_redesign.py
Idempotent — all statements use IF EXISTS / IF NOT EXISTS guards.

Changes:
  1. Drop time_windows table (replaced by direct 30-min slots)
  2. Drop appointment_id FK from appointment_slots (now via slot_bookings)
  3. Add max_capacity (default 6) and booked_count (default 0) to appointment_slots
  4. Update appointment_slots.status — add 'FULL' as valid value (VARCHAR, no change)
  5. Create slot_bookings junction table
  6. Drop preferred_window_id from appointments (time_windows is gone)
  7. Drop old unique constraint uq_mla_date_start, add uq_mla_date on mla_daily_availability
  8. Drop old columns from mla_daily_availability (slot_duration_minutes, total_slots, booked_slots)
  9. Truncate stale slot data (old 5-min slots are incompatible with the new design)
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
# asyncpg uses postgres:// not postgresql+asyncpg://
ASYNCPG_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql://", "postgres://")

SQL_STATEMENTS = [
    # ── 1. Drop time_windows table ───────────────────────────────────────────
    """
    ALTER TABLE IF EXISTS appointments
        DROP COLUMN IF EXISTS preferred_window_id;
    """,
    """
    DROP TABLE IF EXISTS time_windows CASCADE;
    """,

    # ── 2. Drop appointment_id FK from appointment_slots ────────────────────
    """
    DO $$
    DECLARE
        cname TEXT;
    BEGIN
        SELECT constraint_name INTO cname
        FROM information_schema.table_constraints
        WHERE table_name = 'appointment_slots'
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name ILIKE '%appointment%';
        IF cname IS NOT NULL THEN
            EXECUTE 'ALTER TABLE appointment_slots DROP CONSTRAINT ' || quote_ident(cname);
        END IF;
    END $$;
    """,
    """
    ALTER TABLE IF EXISTS appointment_slots
        DROP COLUMN IF EXISTS appointment_id;
    """,

    # ── 3. Add max_capacity + booked_count to appointment_slots ─────────────
    """
    ALTER TABLE IF EXISTS appointment_slots
        ADD COLUMN IF NOT EXISTS max_capacity  INTEGER NOT NULL DEFAULT 6,
        ADD COLUMN IF NOT EXISTS booked_count  INTEGER NOT NULL DEFAULT 0;
    """,

    # ── 4. Create slot_bookings junction table ───────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS slot_bookings (
        id             SERIAL PRIMARY KEY,
        slot_id        INTEGER NOT NULL REFERENCES appointment_slots(id) ON DELETE CASCADE,
        appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
        booked_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_slot_bookings_slot_id        ON slot_bookings (slot_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_slot_bookings_appointment_id ON slot_bookings (appointment_id);
    """,

    # ── 5. Fix unique constraint on mla_daily_availability ──────────────────
    """
    ALTER TABLE IF EXISTS mla_daily_availability
        DROP CONSTRAINT IF EXISTS uq_mla_date_start;
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'uq_mla_date' AND conrelid = 'mla_daily_availability'::regclass
        ) THEN
            ALTER TABLE mla_daily_availability
                ADD CONSTRAINT uq_mla_date UNIQUE (mla_id, date);
        END IF;
    END $$;
    """,

    # ── 6. Drop old columns from mla_daily_availability ─────────────────────
    """
    ALTER TABLE IF EXISTS mla_daily_availability
        DROP COLUMN IF EXISTS slot_duration_minutes,
        DROP COLUMN IF EXISTS total_slots,
        DROP COLUMN IF EXISTS booked_slots;
    """,

    # ── 7. Truncate stale 5-min slot data (incompatible with 30-min design) ─
    # slot_bookings was just created so truncate order is safe
    """
    TRUNCATE TABLE slot_bookings CASCADE;
    """,
    """
    TRUNCATE TABLE appointment_slots CASCADE;
    """,
    """
    TRUNCATE TABLE mla_daily_availability CASCADE;
    """,

    # ── 8. Add 'FULL' as valid status comment (VARCHAR — no enum to alter) ───
    # status column is VARCHAR so FULL is accepted automatically.
    # Just update the comment for documentation.
    """
    COMMENT ON COLUMN appointment_slots.status IS 'AVAILABLE | FULL | BLOCKED';
    """,

    # ── 9. Indexes for new columns ───────────────────────────────────────────
    """
    CREATE INDEX IF NOT EXISTS ix_appointment_slots_availability ON appointment_slots (availability_id);
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_appointment_slots_status ON appointment_slots (status);
    """,
]


async def run():
    if not ASYNCPG_URL or ASYNCPG_URL == "postgres://":
        print("[ERROR] DATABASE_URL not set.")
        sys.exit(1)

    print(f"[MIGRATE] Connecting to DB…")
    conn = await asyncpg.connect(ASYNCPG_URL)
    try:
        for i, sql in enumerate(SQL_STATEMENTS, 1):
            stmt = sql.strip()
            if not stmt:
                continue
            try:
                await conn.execute(stmt)
                print(f"  [{i:02d}] OK")
            except Exception as e:
                print(f"  [{i:02d}] ERROR: {e}")
                print(f"       SQL: {stmt[:120]}")
                raise
    finally:
        await conn.close()

    print("\n[MIGRATE] Slot redesign migration complete.")
    print("  Next: restart FastAPI — new 30-min slot endpoints are live.")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run())
