"""
create_tables_scratch_vps.py
────────────────────────────
⚠️  DESTRUCTIVE — drops ALL application tables then recreates them from scratch.

Use this ONLY when you need a completely clean slate (e.g. new VPS deployment,
local dev reset). ALL existing data will be permanently deleted.

Run:
    python create_tables_scratch_vps.py

The script will ask for explicit confirmation before dropping anything.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

from src.core.config import settings
from src.core.database import Base

# ── Import every model so SQLAlchemy registers all tables in Base.metadata ────
from src.models.qr_models import (
    QRLog, GatekeeperSession
)
from src.models.appointment_models import (
    OTPVerification, Citizen, Appointment,
    AppointmentAttachment, AppointmentEvent,
)
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.scheduling_models import (
    MLA, MLADailyAvailability, AppointmentSlot,
    SlotBooking, RescheduleLog,
)
from src.models.ticket_models import Ticket, TicketEvent
from src.models.referral_models import (
    ReferralAvailability, ReferralSlot, ReferralBooking,
)

# Fix for Windows event loop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# All tables in dependency-safe drop order (children before parents)
DROP_ORDER = [
    # Referral (leaf → root)
    "referral_bookings",
    "referral_slots",
    "referral_availability",
    # Tickets
    "ticket_events",
    "tickets",
    # Scheduling
    "reschedule_logs",
    "slot_bookings",
    "appointment_slots",
    "mla_daily_availability",
    "mlas",
    # Grievance summaries
    "grievance_summary_records",
    # Appointments (leaf → root)
    "appointment_events",
    "appointment_attachments",
    "appointments",
    "citizens",
    "otp_verifications",
    # QR / sessions
    "gatekeeper_sessions",
    "qr_logs",
]


async def run():
    print()
    print("=" * 60)
    print("  ⚠️   create_tables_scratch_vps.py")
    print("=" * 60)
    print()
    print("  This will DROP and RECREATE all application tables.")
    print("  ALL data will be permanently deleted.")
    print()
    print(f"  Database: {settings.DATABASE_URL[:40]}…")
    print()
    confirm = input("  Type  YES  to continue, anything else to abort: ").strip()
    if confirm != "YES":
        print("\n  Aborted — no changes made.")
        return

    print()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        # ── Step 1: Drop all tables in safe order ─────────────────────────────
        print("  [1/2] Dropping existing tables…")
        for table in DROP_ORDER:
            try:
                await conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
                print(f"        ✓ dropped  {table}")
            except Exception as e:
                print(f"        ✗ error    {table}: {e}")

        # ── Step 2: Recreate all tables from SQLAlchemy metadata ──────────────
        print()
        print("  [2/2] Creating tables from current models…")
        await conn.run_sync(Base.metadata.create_all)

    await engine.dispose()

    print()
    # Verify by listing what was created
    async with engine.begin() as conn:
        result = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        )
        tables = [r[0] for r in result.fetchall()]

    await engine.dispose()

    print("  Tables now in database:")
    for t in tables:
        print(f"        • {t}")
    print()
    print("  ✅  Done — all tables recreated from scratch.")
    print()


if __name__ == "__main__":
    asyncio.run(run())
