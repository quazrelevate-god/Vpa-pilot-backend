"""
Build the redesigned ("v2") schema in a fresh LOCAL database and seed `admin`.

Non-destructive: creates a separate database (default `mla_scheduler_v2`) so the
existing local db and the legacy app keep working. Idempotent — re-running only
adds missing admin rows and any missing tables.

Run from backend/:
    ./env/Scripts/python.exe scripts/init_v2_schema.py

Options:
    --seed-only          Skip database + schema creation, only run seeds.
                         Use this on a DB that's already been migrated past
                         the v2 base (e.g. after migrate_v2_final.sql), where
                         create_all would collide with renamed indexes.
    --db NAME            Override the target db name (default: mla_scheduler_v2).
                         For back-compat, a positional arg still works.
"""
from __future__ import annotations

import argparse
import os
import sys

# Make `src` importable when run as a plain script from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from src.models_v2.schema import Base, Admin, Mla  # noqa: E402

# Local Postgres (matches backend/.env DB_* for dev).
PGUSER = os.getenv("DB_USER", "postgres")
PGPASS = os.getenv("DB_PASSWORD", "postgres")
PGHOST = os.getenv("DB_HOST", "localhost")
PGPORT = os.getenv("DB_PORT", "5432")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build v2 schema + seed admin/mla.")
    p.add_argument("--seed-only", action="store_true",
                   help="Skip DB/schema creation, only run seeds.")
    p.add_argument("--db", default=None,
                   help="Target db name (default: mla_scheduler_v2).")
    # Back-compat: allow a positional db name arg too.
    p.add_argument("db_positional", nargs="?", default=None,
                   help=argparse.SUPPRESS)
    args = p.parse_args()
    args.db = args.db or args.db_positional or "mla_scheduler_v2"
    return args


_ARGS = _parse_args()
TARGET_DB = _ARGS.db

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
                        "AWAITING_REVIEW", "REVIEWED", "NOT_CAME",
                        "COURTESY_DONE"],
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


def seed_mla(session: Session) -> int:
    """Seed a default MLA row. Every scheduling flow assumes mla_id=1 exists
    (single-office deployment). Idempotent — skips if any MLA already exists."""
    existing = session.execute(select(func.count()).select_from(Mla)).scalar() or 0
    if existing > 0:
        return 0
    session.add(Mla(name="Minister", is_active=True))
    session.commit()
    return 1


def main() -> None:
    seed_only = _ARGS.seed_only

    if seed_only:
        print(f"[mode] --seed-only: skipping database + schema creation")
    else:
        ensure_database()

    engine = create_engine(_V2_URL)

    if not seed_only:
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

        mla_inserted = seed_mla(s)
        mla_total = s.execute(select(func.count()).select_from(Mla)).scalar()
        print(f"[seed] mla rows inserted this run: {mla_inserted} (total: {mla_total})")

    engine.dispose()
    print("[done] v2 schema built + admin seeded on", TARGET_DB)


if __name__ == "__main__":
    main()
