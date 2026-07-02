"""
Seed the 10 School Education department login accounts (idempotent).

    cd backend
    python seed_departments.py                 # default password from env/fallback
    python seed_departments.py --password XYZ   # set/reset all to XYZ

Username = department key (e.g. 'scert'). Each department shares one login.
Change passwords afterwards, or pass --password. Run once after migration 019.
"""
import argparse
import asyncio
import os
import re

import psycopg

from src.core.config import settings
from src.models.department_account import hash_password
from src.models.school_department import SchoolDepartment, department_label


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", default=os.getenv("DEPARTMENT_DEFAULT_PASSWORD", "changeme123"))
    args = ap.parse_args()
    pw_hash = hash_password(args.password)

    url = re.sub(r"postgresql\+\w+://", "postgresql://", settings.DATABASE_URL)
    created = updated = 0
    with psycopg.connect(url, autocommit=True, connect_timeout=15) as conn:
        c = conn.cursor()
        for d in SchoolDepartment:
            key = d.value
            c.execute("SELECT id FROM department_accounts WHERE department=%s", (key,))
            if c.fetchone():
                c.execute("UPDATE department_accounts SET password_hash=%s WHERE department=%s", (pw_hash, key))
                updated += 1
            else:
                c.execute(
                    "INSERT INTO department_accounts(department, username, password_hash, display_name, created_at) "
                    "VALUES (%s, %s, %s, %s, now())",
                    (key, key, pw_hash, department_label(key)),
                )
                created += 1

    print(f"department accounts: {created} created, {updated} updated (password set for all 10)")
    print("usernames = department keys:", ", ".join(d.value for d in SchoolDepartment))


if __name__ == "__main__":
    main()
