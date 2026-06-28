"""
One-time data migration: re-encrypt existing PII (base64 -> Fernet) and backfill
citizens.mobile_index. Idempotent — safe to run more than once (already-encrypted
rows are skipped; mobile_index is only filled when missing).

Run AFTER `alembic upgrade head` (needs the mobile_index column):

    cd backend
    python encrypt_pii.py
"""
import re
import sys

import psycopg

from src.core.config import settings
from src.core import crypto


def _reencrypt(value):
    """Return new Fernet ciphertext if `value` is legacy base64, else None (unchanged)."""
    if value and not crypto.is_encrypted(value):
        return crypto.encrypt(crypto.decrypt(value))
    return None


def main() -> None:
    url = re.sub(r"postgresql\+\w+://", "postgresql://", settings.DATABASE_URL)
    citizens_updated = appts_updated = idx_filled = 0

    with psycopg.connect(url, autocommit=False) as conn:
        c = conn.cursor()

        # ── Citizens ──────────────────────────────────────────────────────────
        c.execute("SELECT id, encrypted_name, encrypted_mobile, mobile_index FROM citizens")
        for cid, enc_name, enc_mobile, mobile_index in c.fetchall():
            updates = {}
            new_name = _reencrypt(enc_name)
            if new_name is not None:
                updates["encrypted_name"] = new_name
            new_mobile = _reencrypt(enc_mobile)
            if new_mobile is not None:
                updates["encrypted_mobile"] = new_mobile
            if mobile_index is None and enc_mobile:
                plain = crypto.decrypt(enc_mobile)   # works for both legacy + Fernet
                updates["mobile_index"] = crypto.blind_index(plain)
                idx_filled += 1
            if updates:
                cols = ", ".join(f"{k}=%s" for k in updates)
                c.execute(f"UPDATE citizens SET {cols} WHERE id=%s", (*updates.values(), cid))
                citizens_updated += 1

        # ── Appointments ──────────────────────────────────────────────────────
        c.execute("SELECT id, encrypted_name, encrypted_grievance FROM appointments")
        for aid, enc_name, enc_griev in c.fetchall():
            updates = {}
            x = _reencrypt(enc_name)
            if x is not None:
                updates["encrypted_name"] = x
            x = _reencrypt(enc_griev)
            if x is not None:
                updates["encrypted_grievance"] = x
            if updates:
                cols = ", ".join(f"{k}=%s" for k in updates)
                c.execute(f"UPDATE appointments SET {cols} WHERE id=%s", (*updates.values(), aid))
                appts_updated += 1

        conn.commit()

    print(f"citizens re-encrypted: {citizens_updated} | mobile_index filled: {idx_filled} | "
          f"appointments re-encrypted: {appts_updated}")
    print("done.")


if __name__ == "__main__":
    main()
