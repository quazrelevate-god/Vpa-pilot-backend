"""
Add qr_signature_hash column to gatekeeper_sessions table.
Run this once to enable per-device QR scan tracking.
"""
import asyncio
import sys
from sqlalchemy import text
from src.core.database import engine

# Windows event loop fix for psycopg async
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def add_column():
    async with engine.begin() as conn:
        # Check if column already exists
        check_result = await conn.execute(
            text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='gatekeeper_sessions' 
                AND column_name='qr_signature_hash'
            """)
        )
        exists = check_result.fetchone()
        
        if exists:
            print("[MIGRATION] Column qr_signature_hash already exists. Skipping.")
            return
        
        # Add the column
        await conn.execute(
            text("""
                ALTER TABLE gatekeeper_sessions 
                ADD COLUMN qr_signature_hash VARCHAR(255) NULL
            """)
        )
        
        # Create the composite index
        await conn.execute(
            text("""
                CREATE INDEX IF NOT EXISTS idx_qr_device_duplicate 
                ON gatekeeper_sessions (qr_signature_hash, device_fingerprint)
            """)
        )
        
        print("[MIGRATION] Added qr_signature_hash column and index successfully.")


if __name__ == "__main__":
    asyncio.run(add_column())
