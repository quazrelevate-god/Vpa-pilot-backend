"""
Combined production initialization script.
Run this ONCE on a fresh database before starting the application.

Usage:
    cd backend
    python init_db.py

This script:
1. Creates all database tables from SQLAlchemy models
2. Seeds the default MLA record (configurable via .env)
3. Verifies all tables exist

Prerequisites:
    - PostgreSQL database running and accessible
    - .env file configured with correct DB_* settings
    - All dependencies installed (pip install -r requirements.txt)
"""
import asyncio
import sys

# Fix for Windows: psycopg requires SelectorEventLoop
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def init_database():
    print("=" * 60)
    print("  Production Database Initialization")
    print("=" * 60)

    # ── Step 1: Create all tables ───────────────────────────────────────────
    print("\n[1/3] Creating database tables...")

    from sqlalchemy.ext.asyncio import create_async_engine
    from src.core.config import settings
    from src.core.database import Base

    # Import all models so SQLAlchemy discovers them
    from src.models.qr_models import QRLog, GatekeeperSession
    from src.models.appointment_models import (
        OTPVerification,
        Citizen,
        Appointment,
        AppointmentAttachment,
        AppointmentEvent,
    )
    from src.models.grievance_summary_record import GrievanceSummaryRecord
    from src.models.scheduling_models import (
        MLA,
        MLADailyAvailability,
        AppointmentSlot,
        RescheduleLog,
    )
    from src.models.ticket_models import Ticket, TicketEvent

    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("      [OK] All tables created successfully!")

    # ── Step 2: Seed default MLA ────────────────────────────────────────────
    print("\n[2/3] Seeding default MLA record...")

    from sqlalchemy import text
    from src.core.config import settings as cfg

    mla_name = getattr(cfg, 'MLA_NAME', None) or 'Default MLA'
    mla_constituency = getattr(cfg, 'MLA_CONSTITUENCY', None) or 'Default Constituency'
    mla_mobile = getattr(cfg, 'MLA_CONTACT_MOBILE', None) or ''
    mla_email = getattr(cfg, 'MLA_CONTACT_EMAIL', None) or ''
    mla_office = getattr(cfg, 'MLA_OFFICE_ADDRESS', None) or ''

    async with engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO mlas (id, name, constituency, contact_mobile, contact_email, office_address, is_active, created_at)
                VALUES (1, :name, :constituency, :mobile, :email, :office, true, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    constituency = EXCLUDED.constituency,
                    contact_mobile = EXCLUDED.contact_mobile,
                    contact_email = EXCLUDED.contact_email,
                    office_address = EXCLUDED.office_address,
                    is_active = true
            """),
            {
                "name": mla_name,
                "constituency": mla_constituency,
                "mobile": mla_mobile or None,
                "email": mla_email or None,
                "office": mla_office or None,
            }
        )
    print(f"      [OK] MLA (id=1) '{mla_name}' / '{mla_constituency}' seeded!")

    # ── Step 3: Verify tables ───────────────────────────────────────────────
    print("\n[3/3] Verifying tables...")

    expected_tables = [
        'qr_logs',
        'gatekeeper_sessions',
        'otp_verifications',
        'citizens',
        'appointments',
        'appointment_attachments',
        'appointment_events',
        'grievance_summary_records',
        'mlas',
        'mla_daily_availability',
        'appointment_slots',
        'reschedule_logs',
        'tickets',
        'ticket_events',
    ]

    async with engine.begin() as conn:
        result = await conn.execute(
            text("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
            """)
        )
        existing = {row[0] for row in result}

    missing = [t for t in expected_tables if t not in existing]
    if missing:
        print(f"      [WARN] Missing tables: {missing}")
    else:
        print(f"      [OK] All {len(expected_tables)} expected tables verified!")

    # List table count
    print(f"      Database has {len(existing)} tables total.")

    await engine.dispose()

    print("\n" + "=" * 60)
    print("  Database initialization complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Review the seeded MLA record in the PA portal")
    print("  2. Set up MLA daily availability via the scheduling page")
    print("  3. Generate QR codes for citizen access")
    print("  4. Start the application: uvicorn src.main:app --host 0.0.0.0 --port 8000")


if __name__ == "__main__":
    asyncio.run(init_database())
