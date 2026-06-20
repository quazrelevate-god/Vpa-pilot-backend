"""
One-shot migration: add `department` column to grievance_summary_records.

Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
Run once after pulling the new Department enum changes:

    python migrate_add_department.py
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
    """
    ALTER TABLE grievance_summary_records
        ADD COLUMN IF NOT EXISTS department VARCHAR(60) NOT NULL DEFAULT 'other'
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_gsr_department
        ON grievance_summary_records (department)
    """,
]


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        for stmt in SQL_STATEMENTS:
            print(f"  → {stmt.strip().splitlines()[0]} …")
            await conn.execute(text(stmt))
    await engine.dispose()
    print("Done. grievance_summary_records.department is now available.")


if __name__ == "__main__":
    asyncio.run(main())
