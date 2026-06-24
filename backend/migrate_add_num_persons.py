"""
One-shot migration: add `num_persons` column to appointments.

Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
Run once after pulling the num_persons changes:

    python migrate_add_num_persons.py
"""
from __future__ import annotations

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from src.core.config import settings


SQL_STATEMENTS = [
    # ── Number of persons attending the meeting (citizen-selected, 1–4) ──────
    """
    ALTER TABLE appointments
        ADD COLUMN IF NOT EXISTS num_persons INTEGER NOT NULL DEFAULT 1
    """,
]


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        for stmt in SQL_STATEMENTS:
            print(f"  → {stmt.strip().splitlines()[0]} …")
            await conn.execute(text(stmt))
    await engine.dispose()
    print("Done. appointments.num_persons is now available.")


if __name__ == "__main__":
    asyncio.run(main())
