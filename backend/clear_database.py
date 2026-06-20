"""
Clear all data from the database to start fresh.
WARNING: This will delete ALL data including appointments, citizens, QR logs, etc.
"""
import asyncio
import sys
from sqlalchemy import text

from src.core.database import get_db_session


async def clear_all_tables():
    """Clear all data from all tables."""
    
    print("⚠️  WARNING: This will delete ALL data from the database!")
    print("Tables to be cleared:")
    print("  - qr_logs")
    print("  - gatekeeper_sessions")
    print("  - otp_verifications")
    print("  - appointment_attachments")
    print("  - appointments")
    print("  - citizens")
    print("  - grievance_summary_records")
    print("  - appointment_slots")
    print("  - time_windows")
    print("  - mla_daily_availability")
    print("  - reschedule_logs")
    print("  - mlas")
    
    confirm = input("\nType 'DELETE ALL' to confirm: ")
    
    if confirm != "DELETE ALL":
        print("❌ Cancelled. No data was deleted.")
        return
    
    async with get_db_session() as db:
        try:
            print("\n🗑️  Deleting data...")
            
            # Delete in correct order (respecting foreign keys)
            tables = [
                "appointment_attachments",
                "appointment_slots",
                "time_windows",
                "reschedule_logs",
                "appointments",
                "citizens",
                "otp_verifications",
                "gatekeeper_sessions",
                "qr_logs",
                "mla_daily_availability",
                "mlas",
                "grievance_summary_records",
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
