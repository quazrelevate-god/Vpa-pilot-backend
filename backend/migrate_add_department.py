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
    # ── Department column (added previously, idempotent) ──────────────────────
    """
    ALTER TABLE grievance_summary_records
        ADD COLUMN IF NOT EXISTS department VARCHAR(60) NOT NULL DEFAULT 'other'
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_gsr_department
        ON grievance_summary_records (department)
    """,
    # ── Audio transcript columns (Gemini STT) ────────────────────────────────
    """
    ALTER TABLE grievance_summary_records
        ADD COLUMN IF NOT EXISTS audio_transcript TEXT
    """,
    """
    ALTER TABLE grievance_summary_records
        ADD COLUMN IF NOT EXISTS audio_stt_latency_ms INTEGER
    """,
    # ── Remap old subject-based categories → new pattern-based ones ───────────
    # Old categories were department-like; the new ones describe the grievance
    # pattern. We map only the most confident pairs; anything ambiguous → 'other'
    # so the PA can review and re-summarise if needed.
    """
    UPDATE grievance_summary_records
       SET category = CASE category
            WHEN 'corruption'       THEN 'corruption_bribery'
            WHEN 'disaster_relief'  THEN 'emergency_disaster_relief'
            WHEN 'land_revenue'     THEN 'land_property_dispute'
            WHEN 'infrastructure'   THEN 'infrastructure_maintenance'
            WHEN 'water_sanitation' THEN 'infrastructure_maintenance'
            WHEN 'electricity'      THEN 'infrastructure_maintenance'
            WHEN 'pension_welfare'  THEN 'denial_of_entitlement'
            WHEN 'housing'          THEN 'denial_of_entitlement'
            WHEN 'employment'       THEN 'denial_of_entitlement'
            WHEN 'legal_justice'    THEN 'appeal_legal_compliance'
            WHEN 'health'           THEN 'other'
            WHEN 'education'        THEN 'other'
            ELSE category
       END
     WHERE category IN (
        'corruption','disaster_relief','land_revenue','infrastructure',
        'water_sanitation','electricity','pension_welfare','housing',
        'employment','legal_justice','health','education'
     )
    """,
    # ── Drop sentiment column (no longer captured by Gemini) ─────────────────
    """
    ALTER TABLE grievance_summary_records
        DROP COLUMN IF EXISTS sentiment
    """,
    # ── Secondary departments (0–2 additional depts to loop in) ──────────────
    """
    ALTER TABLE grievance_summary_records
        ADD COLUMN IF NOT EXISTS secondary_departments JSONB NOT NULL DEFAULT '[]'::jsonb
    """,
    # Same remap on the appointments.grievance_category mirror column
    """
    UPDATE appointments
       SET grievance_category = CASE grievance_category
            WHEN 'corruption'       THEN 'corruption_bribery'
            WHEN 'disaster_relief'  THEN 'emergency_disaster_relief'
            WHEN 'land_revenue'     THEN 'land_property_dispute'
            WHEN 'infrastructure'   THEN 'infrastructure_maintenance'
            WHEN 'water_sanitation' THEN 'infrastructure_maintenance'
            WHEN 'electricity'      THEN 'infrastructure_maintenance'
            WHEN 'pension_welfare'  THEN 'denial_of_entitlement'
            WHEN 'housing'          THEN 'denial_of_entitlement'
            WHEN 'employment'       THEN 'denial_of_entitlement'
            WHEN 'legal_justice'    THEN 'appeal_legal_compliance'
            WHEN 'health'           THEN 'other'
            WHEN 'education'        THEN 'other'
            ELSE grievance_category
       END
     WHERE grievance_category IN (
        'corruption','disaster_relief','land_revenue','infrastructure',
        'water_sanitation','electricity','pension_welfare','housing',
        'employment','legal_justice','health','education'
     )
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
