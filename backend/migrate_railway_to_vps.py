"""
Safe data migration: Railway PostgreSQL → VPS PostgreSQL.

NO DATA LOSS — this script:
  1. Exports ALL data from Railway (read-only, Railway untouched)
  2. Imports into VPS tables (VPS schema must already exist)
  3. Resets sequences so new inserts get correct IDs

Usage:
  python migrate_railway_to_vps.py

Requirements:
  pip install psycopg2-binary   (sync driver for both source + target)

You will be prompted for both connection strings.
"""
import sys
import psycopg2
from psycopg2 import sql

# ── Table order: parents before children (respects FK constraints) ───────────
# Ephemeral tables included for completeness (qr_logs, gatekeeper_sessions,
# otp_verifications) — they migrate too so zero data loss.
TABLES_IN_ORDER = [
    # Identity & access (no FKs)
    "qr_logs",
    "gatekeeper_sessions",

    # Scheduling root (no FKs)
    "mlas",

    # Citizens (no FKs)
    "citizens",

    # Scheduling children
    "mla_daily_availability",   # → mlas
    "appointment_slots",        # → mla_daily_availability

    # Referral system (isolated tree)
    "referral_availability",
    "referral_slots",           # → referral_availability
    "referral_bookings",        # → referral_slots

    # Appointments (→ citizens, → appointment_slots)
    "appointments",

    # Appointment children
    "otp_verifications",        # no FK to appointments, but logically related
    "slot_bookings",            # → appointment_slots, → appointments
    "appointment_attachments",  # → appointments
    "appointment_events",       # → appointments

    # Ticketing (→ appointments)
    "tickets",
    "ticket_events",            # → tickets

    # AI summaries (→ appointments)
    "grievance_summary_records",

    # Rescheduling audit log
    "reschedule_logs",          # → appointments, → appointment_slots
]


def get_columns(cur, table_name):
    """Get column names for a table (excluding generated/virtual columns)."""
    cur.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = %s
          AND table_schema = 'public'
          AND is_generated = 'NEVER'
        ORDER BY ordinal_position
    """, (table_name,))
    return [row[0] for row in cur.fetchall()]


def get_row_count(cur, table_name):
    cur.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table_name)))
    return cur.fetchone()[0]


def reset_sequence(cur, table_name, pk_column="id"):
    """Reset the auto-increment sequence to max(pk) + 1."""
    try:
        cur.execute(sql.SQL(
            "SELECT setval(pg_get_serial_sequence({tbl}, {col}), COALESCE(MAX({pk}), 0) + 1, false) FROM {table}"
        ).format(
            tbl=sql.Literal(table_name),
            col=sql.Literal(pk_column),
            pk=sql.Identifier(pk_column),
            table=sql.Identifier(table_name),
        ))
    except Exception as e:
        # Some tables might not have a sequence (e.g. no autoincrement)
        print(f"    [WARN] Could not reset sequence for {table_name}.{pk_column}: {e}")
        cur.connection.rollback()


def migrate():
    print("=" * 60)
    print("  Railway → VPS Data Migration (zero data loss)")
    print("=" * 60)
    print()

    # ── Get connection strings ───────────────────────────────────────────
    print("Paste your RAILWAY PostgreSQL connection string")
    print("  (from Railway dashboard → Variables → DATABASE_URL)")
    print("  Format: postgresql://user:pass@host:port/dbname")
    railway_url = input("\nRAILWAY DB URL: ").strip()

    print()
    print("Paste your VPS PostgreSQL connection string")
    print("  Format: postgresql://user:pass@localhost:5432/dbname")
    vps_url = input("VPS DB URL: ").strip()

    # Normalize URLs for psycopg2 (strip +asyncpg etc.)
    import re
    railway_url = re.sub(r"^postgresql\+\w+://", "postgresql://", railway_url)
    vps_url = re.sub(r"^postgresql\+\w+://", "postgresql://", vps_url)

    # Append sslmode=require for Railway if not already present
    if "sslmode" not in railway_url:
        sep = "&" if "?" in railway_url else "?"
        railway_url += sep + "sslmode=require"

    print()
    print("[1/4] Connecting to Railway (source) ...")
    src = psycopg2.connect(railway_url)
    src.set_session(readonly=True)
    src_cur = src.cursor()

    print("[2/4] Connecting to VPS (target) ...")
    dst = psycopg2.connect(vps_url)
    dst_cur = dst.cursor()

    # ── Show what we're about to migrate ─────────────────────────────────
    print()
    print("  Table                          Railway rows")
    print("  " + "-" * 45)
    total_rows = 0
    table_counts = {}
    for table in TABLES_IN_ORDER:
        try:
            count = get_row_count(src_cur, table)
            table_counts[table] = count
            total_rows += count
            print(f"  {table:<33} {count:>8}")
        except Exception as e:
            print(f"  {table:<33} MISSING ({e})")
            src.rollback()
            table_counts[table] = -1  # mark as missing

    print(f"  {'TOTAL':<33} {total_rows:>8}")
    print()

    confirm = input(f"Migrate {total_rows} rows to VPS? This will REPLACE data in VPS tables. (yes/no): ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        return

    # ── Disable FK checks during import ──────────────────────────────────
    print()
    print("[3/4] Migrating data ...")
    dst_cur.execute("SET session_replication_role = 'replica';")  # disables FK triggers

    migrated = 0
    for table in TABLES_IN_ORDER:
        if table_counts.get(table, -1) < 0:
            print(f"  SKIP  {table} (not in Railway)")
            continue

        count = table_counts[table]
        if count == 0:
            print(f"  SKIP  {table} (0 rows)")
            continue

        # Get common columns (intersection of source and target)
        src_cols = get_columns(src_cur, table)
        dst_cols = get_columns(dst_cur, table)
        common = [c for c in src_cols if c in dst_cols]

        if not common:
            print(f"  SKIP  {table} (no common columns)")
            continue

        # Truncate target table
        dst_cur.execute(sql.SQL("TRUNCATE {} CASCADE").format(sql.Identifier(table)))

        # Read all rows from Railway
        col_ids = sql.SQL(", ").join(sql.Identifier(c) for c in common)
        src_cur.execute(sql.SQL("SELECT {} FROM {}").format(col_ids, sql.Identifier(table)))
        rows = src_cur.fetchall()

        # Insert into VPS
        placeholders = sql.SQL(", ").join(sql.Placeholder() * len(common))
        insert_sql = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
            sql.Identifier(table),
            col_ids,
            placeholders,
        )

        batch_size = 500
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            dst_cur.executemany(insert_sql, batch)

        # Reset sequence
        reset_sequence(dst_cur, table)

        migrated += len(rows)
        print(f"  OK    {table:<33} {len(rows):>6} rows")

    # Re-enable FK checks
    dst_cur.execute("SET session_replication_role = 'origin';")

    dst.commit()
    print()
    print(f"[4/4] Verifying ...")

    # Verify counts
    ok = True
    for table in TABLES_IN_ORDER:
        if table_counts.get(table, -1) <= 0:
            continue
        try:
            vps_count = get_row_count(dst_cur, table)
            railway_count = table_counts[table]
            status = "OK" if vps_count == railway_count else "MISMATCH"
            if status == "MISMATCH":
                ok = False
            print(f"  {status}  {table}: Railway={railway_count}, VPS={vps_count}")
        except Exception as e:
            print(f"  ERR   {table}: {e}")
            dst.rollback()
            ok = False

    # Cleanup
    src_cur.close()
    src.close()
    dst_cur.close()
    dst.close()

    print()
    if ok:
        print("Migration complete. All row counts match.")
        print()
        print("Next steps:")
        print("  1. Fix presigned URLs: change FILE_STORAGE_ENDPOINT to http://127.0.0.1:9000 in .env")
        print("  2. Migrate files: mc mirror railway-bucket vps-bucket (see README)")
        print("  3. Restart backend: sudo systemctl restart vpa-backend")
        print("  4. Verify: open https://namkural.in and check dashboard")
    else:
        print("WARNING: Some tables have mismatched counts. Check errors above.")

    print()


if __name__ == "__main__":
    migrate()
