"""
Add encrypted_name column to appointments table.
Run once.
"""
import asyncio
import sys
from sqlalchemy import text
from src.core.database import engine

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(text("""
            ALTER TABLE appointments
            ADD COLUMN IF NOT EXISTS encrypted_name TEXT
        """))
        print("[MIGRATION] Added encrypted_name column to appointments table.")


if __name__ == "__main__":
    asyncio.run(migrate())
