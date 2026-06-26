"""
Migration: add the referral booking tables (isolated from petitions).

Run with:  python migrate_add_referral.py
Idempotent — uses IF NOT EXISTS guards.

Creates:
  referral_availability  — one row per open referral date (11:00–13:00)
  referral_slots         — 4 half-hour slots per date
  referral_bookings      — one row per referral booking
"""
import asyncio
import sys
import os
import re

sys.path.insert(0, os.path.dirname(__file__))

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
ASYNCPG_URL = re.sub(r"^postgresql\+\w+://", "postgresql://", DATABASE_URL)
ASYNCPG_URL = ASYNCPG_URL.replace("postgresql://", "postgres://")

SQL_STATEMENTS = [
    # ── referral_availability ────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS referral_availability (
        id         SERIAL PRIMARY KEY,
        date       DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time   TIME NOT NULL,
        status     VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by VARCHAR(100),
        CONSTRAINT uq_referral_date UNIQUE (date)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_referral_availability_date ON referral_availability (date);",

    # ── referral_slots ───────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS referral_slots (
        id              SERIAL PRIMARY KEY,
        availability_id INTEGER NOT NULL REFERENCES referral_availability(id) ON DELETE CASCADE,
        slot_number     INTEGER NOT NULL,
        start_time      TIME NOT NULL,
        end_time        TIME NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
        max_capacity    INTEGER NOT NULL DEFAULT 6,
        booked_count    INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_referral_slots_availability ON referral_slots (availability_id);",
    "CREATE INDEX IF NOT EXISTS ix_referral_slots_status ON referral_slots (status);",

    # ── referral_bookings ────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS referral_bookings (
        id                   SERIAL PRIMARY KEY,
        slot_id              INTEGER NOT NULL REFERENCES referral_slots(id) ON DELETE CASCADE,
        token_number         BIGINT NOT NULL,
        name                 VARCHAR(150) NOT NULL,
        mobile               VARCHAR(15),
        num_persons          INTEGER NOT NULL DEFAULT 1,
        referred_by          VARCHAR(200) NOT NULL,
        reason               VARCHAR(500) NOT NULL DEFAULT '',
        scheduled_date       DATE NOT NULL,
        scheduled_start_time TIME NOT NULL,
        scheduled_end_time   TIME NOT NULL,
        created_at           TIMESTAMP NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_referral_bookings_slot_id ON referral_bookings (slot_id);",
    "CREATE INDEX IF NOT EXISTS ix_referral_bookings_date ON referral_bookings (scheduled_date);",
]


async def run():
    if not ASYNCPG_URL or ASYNCPG_URL == "postgres://":
        print("[ERROR] DATABASE_URL not set.")
        sys.exit(1)
    print("[MIGRATE] Connecting…")
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
                raise
    finally:
        await conn.close()
    print("\n[MIGRATE] Referral tables created. Restart FastAPI.")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run())
