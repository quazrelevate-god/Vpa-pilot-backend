"""
Build the redesigned ("v2") schema in a fresh LOCAL database and seed `admin`.

Non-destructive: creates a separate database (default `mla_scheduler_v2`) so the
existing local db and the legacy app keep working. Idempotent — re-running only
adds missing admin rows and any missing tables.

Run from backend/:
    ./env/Scripts/python.exe scripts/init_v2_schema.py
Optionally override the target db name:
    ./env/Scripts/python.exe scripts/init_v2_schema.py mla_scheduler_v2
"""
from __future__ import annotations

import os
import sys

# Make `src` importable when run as a plain script from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from src.models_v2.schema import Base, Admin  # noqa: E402

# Local Postgres (matches backend/.env DB_* for dev).
PGUSER = os.getenv("DB_USER", "postgres")
PGPASS = os.getenv("DB_PASSWORD", "postgres")
PGHOST = os.getenv("DB_HOST", "localhost")
PGPORT = os.getenv("DB_PORT", "5432")
TARGET_DB = sys.argv[1] if len(sys.argv) > 1 else "mla_scheduler_v2"

_ADMIN_URL = f"postgresql+psycopg://{PGUSER}:{PGPASS}@{PGHOST}:{PGPORT}/postgres"
_V2_URL = f"postgresql+psycopg://{PGUSER}:{PGPASS}@{PGHOST}:{PGPORT}/{TARGET_DB}"


def ensure_database() -> None:
    eng = create_engine(_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        exists = c.execute(
            text("select 1 from pg_database where datname = :n"), {"n": TARGET_DB}
        ).scalar()
        if exists:
            print(f"[db] '{TARGET_DB}' already exists")
        else:
            c.execute(text(f'CREATE DATABASE "{TARGET_DB}"'))
            print(f"[db] created '{TARGET_DB}'")
    eng.dispose()


def seed_admin(session: Session) -> int:
    """Seed the admin lookup from existing enums + the new department list."""
    from src.models.ticket_models import TicketStatus, TicketPriority
    from src.models.grievance_summary import GrievanceCategory, Department

    groups: dict[str, list[str]] = {
        "appointment": ["SCHEDULED", "WAITING", "RESCHEDULED",
                        "AWAITING_REVIEW", "REVIEWED", "NOT_CAME"],
        "ticket":   [s.value for s in TicketStatus],
        "priority": [p.value for p in TicketPriority],
        "category": [c.value for c in GrievanceCategory],
        "ministry": [d.value for d in Department],
        "ai_upload": ["QUEUED", "PROCESSING", "AWAITING_REVIEW", "REVIEWED", "FAILED"],
        "department": [
            "Director of School Education",
            "Directorate of Private Schools",
            "Elementary Education",
            "Government Examinations",
            "Non-Formal and Adult Education",
            "Public Libraries",
            "State Council of Educational Research and Training (SCERT)",
            "Teacher Recruitment Board",
            "Tamil Nadu Education Service Corporation",
            "Samagra Shiksha",
        ],
    }

    inserted = 0
    for entity, names in groups.items():
        for i, name in enumerate(names):
            found = session.execute(
                select(Admin.id).where(Admin.entity == entity, Admin.name == name)
            ).scalar_one_or_none()
            if found is None:
                session.add(Admin(entity=entity, name=name, sort_order=i))
                inserted += 1
    session.commit()
    return inserted


def main() -> None:
    ensure_database()

    engine = create_engine(_V2_URL)
    Base.metadata.create_all(engine)
    print(f"[schema] ensured {len(Base.metadata.tables)} tables: "
          f"{', '.join(sorted(Base.metadata.tables))}")

    with Session(engine) as s:
        inserted = seed_admin(s)
        print(f"[seed] admin rows inserted this run: {inserted}")
        print("[seed] admin counts by entity:")
        rows = s.execute(
            select(Admin.entity, func.count()).group_by(Admin.entity).order_by(Admin.entity)
        ).all()
        for entity, n in rows:
            print(f"        {entity:12s} {n}")
        total = s.execute(select(func.count()).select_from(Admin)).scalar()
        print(f"[seed] admin total: {total}")

    engine.dispose()
    print("[done] v2 schema built + admin seeded on", TARGET_DB)


if __name__ == "__main__":
    main()
