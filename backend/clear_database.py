"""
Clear all data from the database to start fresh.
WARNING: This will delete ALL data including appointments, citizens, QR logs, etc.
"""
import asyncio
import sys
from sqlalchemy import text

from src.core.database import AsyncSessionLocal


async def clear_all_tables():
    """Clear all data from all tables."""

    print("⚠️  WARNING: This will delete ALL data from the database!")
    print("Tables to be cleared:")
    print("  - ticket_events")
    print("  - tickets")
    print("  - appointment_attachments")
    print("  - reschedule_logs")
    print("  - grievance_summary_records")
    print("  - appointment_slots")
    print("  - time_windows")
    print("  - appointments")
    print("  - citizens")
    print("  - otp_verifications")
    print("  - gatekeeper_sessions")
    print("  - qr_logs")
    print("  - mla_daily_availability")
    print("  - mlas")

    confirm = input("\nType 'DELETE ALL' to confirm: ")

    if confirm != "DELETE ALL":
        print("❌ Cancelled. No data was deleted.")
        return

    async with AsyncSessionLocal() as db:
        try:
            print("\n🗑️  Deleting data...")
            
            # Delete in 
             order (respecting foreign keys).
            # Child tables referencing appointments must be cleared before appointments.
            tables = [
                "ticket_events",
                "tickets",
                "appointment_attachments",
                "reschedule_logs",
                "grievance_summary_records",
                "appointment_slots",
                "time_windows",
                "appointments",
                "citizens",
                "otp_verifications",
                "gatekeeper_sessions",
                "qr_logs",
                "mla_daily_availability",
                "mlas",
            ]
            
            for table in tables:
                result = await db.execute(text(f"DELETE FROM {table}"))
                count = result.rowcount
                print(f"  ✓ Deleted {count} rows from {table}")
            
            await db.commit()
            
            print("\n✅ All data cleared successfully!")
            print("You can now start fresh with clean tables.")
            
        except Exception as e:
            await db.rollback()
            print(f"\n❌ Error: {e}")
            sys.exit(1)


if __name__ == "__main__":
    # Fix for Windows: psycopg requires SelectorEventLoop
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    asyncio.run(clear_all_tables())
