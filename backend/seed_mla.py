"""
Seed default MLA record for scheduling.
Run this once to create the default MLA with id=1.
"""
import asyncio
import sys
from sqlalchemy import text
from src.core.database import engine

# Windows event loop fix for psycopg async
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def seed_mla():
    async with engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO mlas (id, name, constituency, is_active, created_at)
                VALUES (1, 'Default MLA', 'Default Constituency', true, NOW())
                ON CONFLICT (id) DO NOTHING
            """)
        )
        print("[SEED] Default MLA (id=1) created successfully.")


if __name__ == "__main__":
    asyncio.run(seed_mla())
