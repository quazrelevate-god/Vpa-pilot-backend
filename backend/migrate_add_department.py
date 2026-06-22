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
    # ── Ticketing system: tickets table ──────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS tickets (
        id              BIGSERIAL PRIMARY KEY,
        appointment_id  INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
        ticket_number   VARCHAR(20) NOT NULL UNIQUE,
        status          VARCHAR(30) NOT NULL DEFAULT 'open',
        priority        VARCHAR(5),
        assigned_to_pa  VARCHAR(100),
        due_date        TIMESTAMP,
        forwarded_to_dept   VARCHAR(60),
        forwarded_at        TIMESTAMP,
        forwarded_by        VARCHAR(100),
        forwarded_notes     TEXT,
        resolution_notes    TEXT,
        closure_reason      VARCHAR(40),
        resolved_at         TIMESTAMP,
        closed_at           TIMESTAMP,
        reopened_at         TIMESTAMP,
        reopen_count        INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_tickets_status              ON tickets (status)",
    "CREATE INDEX IF NOT EXISTS ix_tickets_priority            ON tickets (priority)",
    "CREATE INDEX IF NOT EXISTS ix_tickets_assigned_to         ON tickets (assigned_to_pa)",
    "CREATE INDEX IF NOT EXISTS ix_tickets_created_at          ON tickets (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_tickets_forwarded_to_dept   ON tickets (forwarded_to_dept)",
    "CREATE INDEX IF NOT EXISTS ix_tickets_due_date            ON tickets (due_date)",

    # ── Ticket events (audit log) ────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS ticket_events (
        id          BIGSERIAL PRIMARY KEY,
        ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        event_type  VARCHAR(40) NOT NULL,
        actor       VARCHAR(100) NOT NULL,
        note        TEXT,
        payload     JSONB,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_ticket_events_ticket_id      ON ticket_events (ticket_id)",
    "CREATE INDEX IF NOT EXISTS ix_ticket_events_ticket_created ON ticket_events (ticket_id, created_at)",

    # ── Backfill: create an OPEN ticket for every existing appointment ───────
    # Uses a windowed row_number per year offset by existing ticket count
    # so ticket numbers don't collide with already-created tickets.
    """
    WITH existing_counts AS (
        SELECT
            EXTRACT(YEAR FROM created_at)::int AS yr,
            COUNT(*) AS cnt
        FROM tickets
        GROUP BY EXTRACT(YEAR FROM created_at)
    ),
    to_insert AS (
        SELECT
            a.id,
            'TKT-' || TO_CHAR(a.created_at, 'YYYY') || '-' ||
                LPAD(
                    (COALESCE((SELECT cnt FROM existing_counts WHERE yr = EXTRACT(YEAR FROM a.created_at)), 0)
                     + ROW_NUMBER() OVER (
                        PARTITION BY EXTRACT(YEAR FROM a.created_at)
                        ORDER BY a.id
                    ))::text,
                    5, '0'
                ) AS ticket_number,
            'open' AS status,
            a.created_at,
            a.created_at AS updated_at
        FROM appointments a
        LEFT JOIN tickets t ON t.appointment_id = a.id
        WHERE t.id IS NULL
    )
    INSERT INTO tickets (appointment_id, ticket_number, status, created_at, updated_at)
    SELECT id, ticket_number, status, created_at, updated_at
    FROM to_insert
    WHERE NOT EXISTS (
        SELECT 1 FROM tickets t2 WHERE t2.ticket_number = to_insert.ticket_number
    )
    ON CONFLICT (appointment_id) DO NOTHING
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
    # ── Appointment events (audit log for appointment activity tab) ──────────
    """
    CREATE TABLE IF NOT EXISTS appointment_events (
        id              BIGSERIAL PRIMARY KEY,
        appointment_id  INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        event_type      VARCHAR(40) NOT NULL,
        actor           VARCHAR(100) NOT NULL,
        note            TEXT,
        payload         JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_appointment_events_appointment_id ON appointment_events (appointment_id)",
    "CREATE INDEX IF NOT EXISTS ix_appt_events_appt_created ON appointment_events (appointment_id, created_at)",
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
