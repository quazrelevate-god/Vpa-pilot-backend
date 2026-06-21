"""
Drop uq_mla_date unique constraint and replace with (mla_id, date, start_time)
to allow multiple availability blocks per day for the same MLA.
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
        # Drop the old single-block-per-day constraint
        await conn.execute(text("""
            ALTER TABLE mla_daily_availability
            DROP CONSTRAINT IF EXISTS uq_mla_date
        """))
        print("[MIGRATION] Dropped constraint uq_mla_date.")

        # Add new constraint: one block per (mla, date, start_time)
        await conn.execute(text("""
            ALTER TABLE mla_daily_availability
            ADD CONSTRAINT uq_mla_date_start
            UNIQUE (mla_id, date, start_time)
        """))
        print("[MIGRATION] Added constraint uq_mla_date_start (mla_id, date, start_time).")


if __name__ == "__main__":
    asyncio.run(migrate())
