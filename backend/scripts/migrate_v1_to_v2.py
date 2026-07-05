"""
Standalone v1 → v2 migration runner (structural cutover + admin seed).

For environments that don't drive alembic directly (or to run the cutover as a
one-off against a specific database). Does exactly what the alembic revision 025
does, then stamps alembic_version to '025' so a later `alembic upgrade head`
is a clean no-op.

    cd backend
    # dry inspection (prints the plan, changes nothing):
    ./env/Scripts/python.exe scripts/migrate_v1_to_v2.py --url postgresql+psycopg://user:pass@host/db --dry-run
    # run it:
    ./env/Scripts/python.exe scripts/migrate_v1_to_v2.py --url postgresql+psycopg://user:pass@host/db

If --url is omitted it falls back to $MIGRATE_DB_URL, then to the app's
DATABASE_URL (converted to a sync driver). It NEVER silently targets Railway —
you must pass the URL (or set the env var) on purpose.

SAFETY: take a database backup first. The cutover drops columns and folds the
event tables into `activity`; it is not reversible.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from scripts.v1_to_v2_cutover import run_cutover_conn, already_v2  # noqa: E402


def _sync_url(raw: str) -> str:
    # alembic/this runner are sync — normalise async drivers.
    return re.sub(r"postgresql\+(psycopg_async|asyncpg)", "postgresql+psycopg", raw)


def _resolve_url(cli: str | None) -> str:
    if cli:
        return _sync_url(cli)
    if os.getenv("MIGRATE_DB_URL"):
        return _sync_url(os.environ["MIGRATE_DB_URL"])
    from src.core.config import settings
    return _sync_url(settings.DATABASE_URL)


def main() -> None:
    ap = argparse.ArgumentParser(description="Upgrade a v1 database to the v2 schema.")
    ap.add_argument("--url", default=None, help="sync SQLAlchemy URL of the target DB")
    ap.add_argument("--dry-run", action="store_true", help="report current state only, change nothing")
    ap.add_argument("--stamp/--no-stamp", dest="stamp", default=True, action="store_true",
                    help="stamp alembic_version to 025 after migrating (default: yes)")
    args = ap.parse_args()

    url = _resolve_url(args.url)
    safe = re.sub(r"://[^@]+@", "://***@", url)
    print(f"[migrate] target: {safe}")
    engine = create_engine(url)

    with engine.connect() as conn:
        v1 = conn.execute(text("SELECT to_regclass('public.appointments')")).scalar() is not None
        v2 = already_v2(conn)
        print(f"[migrate] detected: {'v2 (already migrated)' if v2 else 'v1' if v1 else 'unknown/empty'}")

    if args.dry_run:
        print("[migrate] --dry-run: no changes made.")
        return
    if not v1 and not v2:
        print("[migrate] neither v1 nor v2 recognised — refusing to touch it.")
        sys.exit(1)

    with engine.begin() as conn:
        result = run_cutover_conn(conn, verbose=True)
        if args.stamp and result["status"] != "already_v2":
            conn.execute(text("CREATE TABLE IF NOT EXISTS alembic_version "
                              "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
            conn.execute(text("DELETE FROM alembic_version"))
            conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('025')"))
            print("[migrate] stamped alembic_version = 025")

    # Report
    with engine.connect() as conn:
        for tbl in ("admin", "appointment", "ticket", "activity", "citizens",
                    "grievance_summary_records", "referral_bookings", "ai_uploads"):
            n = conn.execute(text(f"SELECT count(*) FROM {tbl}")).scalar()
            print(f"        {tbl:28s} {n}")
    print(f"[migrate] {result}")


if __name__ == "__main__":
    main()
