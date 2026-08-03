# Backup & Restore Runbook

**Audience:** whoever operates the NamKural VPS in production.
**Why this exists:** the go-live review (P2) flagged that there was no documented
backup/restore procedure. This covers the three things that must be backed up
**together** to be recoverable: the Postgres database, the encryption keys, and
the MinIO object store.

> ⚠️ **The single most important rule:** the database and the encryption keys
> must be restored from the **same point in time**. Citizen PII in Postgres is
> Fernet-encrypted; a DB backup is useless without the key that encrypted it,
> and rotating the key (`ENCRYPTION_KEY` / its fallback `SECRET_KEY`) makes every
> encrypted column unreadable forever. Never rotate these keys casually, and
> always snapshot them alongside the DB.

---

## 1. What to back up

| Asset | Where | Contains | Cadence |
|---|---|---|---|
| **Postgres** | DB host | All application data (PII is Fernet-encrypted) | Nightly dump + continuous WAL (see §2) |
| **Encryption keys** | `backend/.env` | `SECRET_KEY`, `ENCRYPTION_KEY` (and `DASHBOARD_*`, APM/Gemini/Sarvam keys) | On every change; store in a separate secrets vault |
| **MinIO bucket** | object store (`FILE_STORAGE_BUCKET`, default `vpa-uploads`) | Uploaded petition/proposal/event files & audio — often the **same PII in un-encrypted form** | Nightly mirror + versioning |

Keep the key backup in a **different** location/vault from the DB backup, so a
single compromised backup doesn't yield both ciphertext and its key.

---

## 2. Postgres

### Nightly logical dump (simplest)
```bash
# Adjust to your DATABASE_URL / DB_* values.
pg_dump --format=custom --no-owner --file="/backups/namkural_$(date +%F).dump" "$DATABASE_URL"
# Retain 30 days:
find /backups -name 'namkural_*.dump' -mtime +30 -delete
```

### Point-in-time recovery (preferred for prod)
Enable WAL archiving in `postgresql.conf` so you can restore to any moment, not
just the last nightly:
```
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /wal_archive/%f && cp %p /wal_archive/%f'
```
Take a periodic base backup (`pg_basebackup -D /basebackup -Ft -z`) and ship
`/wal_archive` off-box. Restore = restore the base backup, then replay WAL up to
the target time via a `recovery.conf`/`recovery.signal`.

### Restore (logical dump)
```bash
# Into a fresh, empty database:
pg_restore --no-owner --clean --if-exists --dbname "$DATABASE_URL" /backups/namkural_YYYY-MM-DD.dump
```
Then set `ENCRYPTION_KEY` / `SECRET_KEY` in `.env` to the values **from the same
day** before starting the app (see §3). The app's crypto self-test (P0-4) will
refuse to boot if the key can't round-trip.

### Migrations
Migrations are `down_revision`-chained and mostly idempotent. `alembic downgrade
-1` works, but **verify against a staging clone first** — some migrations
back-fill data (e.g. 011, 013 for citizen mobile) that isn't cheaply reversible.

---

## 3. Encryption keys (Fernet)

- `ENCRYPTION_KEY` derives the Fernet key that encrypts all `encrypted_*`
  columns. `SECRET_KEY` is the fallback **and** signs session cookies + the
  (legacy) password hashes.
- **Back these up on every change** to the same-timestamped secure store as the
  DB snapshot. A row-level restore is only usable with the matching key.
- **Lost key = unrecoverable PII.** There is no brute-force path. This is why
  P0-4 requires `ENCRYPTION_KEY` in production and forbids relying on the
  `SECRET_KEY` fallback (rotating `SECRET_KEY` would then also destroy PII).
- Rotation, if ever truly required, is a migration: decrypt-with-old →
  encrypt-with-new for every column, in one controlled pass, with both keys
  available. Do not "just change the env var."

---

## 4. MinIO / object store

The bucket holds the raw uploaded files (PDFs, images, audio) — frequently the
same PII the DB encrypts, in the clear. Treat it as sensitive.

### Nightly mirror (off-box copy)
```bash
mc mirror --overwrite --remove minio/vpa-uploads /backups/minio/vpa-uploads
```

### Versioning + lifecycle (recommended)
```bash
mc version enable minio/vpa-uploads          # protects against overwrite/delete
mc ilm add --expiry-days 90 --tags "deleted=true" minio/vpa-uploads   # pairs with soft-delete
```

### At-rest encryption (do this — it's an ops task, zero code)
```bash
mc encrypt set sse-s3 minio/vpa-uploads      # encrypt every new object at rest
```
A stolen MinIO backup otherwise hands an attacker the PII the DB carefully
encrypts. (This is finding **T-5** from the schema/storage audit.)

### Restore
```bash
mc mirror --overwrite /backups/minio/vpa-uploads minio/vpa-uploads
```

---

## 5. Full disaster-recovery order

1. Provision Postgres + MinIO.
2. Restore the **DB** to time *T* (§2).
3. Restore `.env` **keys from the same time *T*** (§3) — DB + keys must match.
4. Restore the **MinIO** bucket (§4).
5. Set required prod env (`ENCRYPTION_KEY`, `SERVER_BASE_URL`, non-default
   `DASHBOARD_/DISPLAY_/EVENTS_` creds — the app refuses to boot otherwise).
6. Start the app. The startup **crypto self-test** and **/health/ready** DB
   probe confirm keys + DB are wired correctly.
7. Smoke-check: log into the dashboard, open a petition with an attachment
   (exercises DB + MinIO + decryption together).

---

## 6. What to verify quarterly
- A dump actually **restores** into a scratch database (an untested backup is
  not a backup).
- The MinIO mirror is **non-empty** and objects open.
- The `.env` key backup matches the running key (encrypt a probe with the backup
  key, confirm it decrypts a known row).
