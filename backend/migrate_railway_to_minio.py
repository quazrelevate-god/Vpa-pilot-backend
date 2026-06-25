"""
One-time migration: upload existing files from Railway's local uploads/ folder
to MinIO on VPS AND update DB records to match new key format.

Completely standalone — no imports from the project. Reads config from env vars.

Run on Railway BEFORE redeploying:
    python migrate_railway_to_minio.py

What it does:
  1. Reads all files from local uploads/ folder
  2. Uploads each file to MinIO (key = path relative to uploads/)
  3. Updates appointment_attachments.storage_url — strips "uploads/" prefix
  4. Updates appointments.audio_recording_url — strips "uploads/" prefix

After this completes, Railway can safely redeploy (uploads/ folder is disposable).
"""
import asyncio
import mimetypes
import os
import sys
from pathlib import Path

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION — reads from env vars (Railway sets these automatically)
# ══════════════════════════════════════════════════════════════════════════════
MINIO_ENDPOINT   = os.getenv("FILE_STORAGE_ENDPOINT",   "http://103.91.186.75:9000")
MINIO_ACCESS_KEY = os.getenv("FILE_STORAGE_ACCESS_KEY", "vpaadmin")
MINIO_SECRET_KEY = os.getenv("FILE_STORAGE_SECRET_KEY", "ChooseAStrongPassword2026")
MINIO_BUCKET     = os.getenv("FILE_STORAGE_BUCKET",     "vpa-uploads1")
DATABASE_URL     = os.getenv("DATABASE_URL", "")  # Railway sets this automatically
UPLOADS_DIR      = Path("uploads")
# ══════════════════════════════════════════════════════════════════════════════


def get_minio_client():
    """Create a boto3 S3 client configured for MinIO with path-style addressing."""
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        region_name="us-east-1",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )


def ensure_bucket(client):
    """Make sure the MinIO bucket exists."""
    try:
        client.head_bucket(Bucket=MINIO_BUCKET)
        print(f"Bucket '{MINIO_BUCKET}' exists.")
    except Exception:
        client.create_bucket(Bucket=MINIO_BUCKET)
        print(f"Created bucket: {MINIO_BUCKET}")


def upload_files(client):
    """Upload all files from uploads/ to MinIO. Returns (success, failed, total)."""
    if not UPLOADS_DIR.exists():
        print("No uploads/ directory found — nothing to migrate.")
        return 0, 0, 0

    files = [f for f in UPLOADS_DIR.rglob("*") if f.is_file()]
    print(f"\nFound {len(files)} files to upload.\n")

    success = 0
    failed = 0
    for f in files:
        key = str(f.relative_to(UPLOADS_DIR)).replace("\\", "/")
        try:
            ct, _ = mimetypes.guess_type(str(f))
            kwargs = {"Bucket": MINIO_BUCKET, "Key": key, "Body": f.read_bytes()}
            if ct:
                kwargs["ContentType"] = ct
            client.put_object(**kwargs)
            success += 1
            print(f"  ✓ {key}")
        except Exception as e:
            failed += 1
            print(f"  ✗ {key}: {e}")

    print(f"\nUpload complete: {success} success, {failed} failed, {len(files)} total.")
    return success, failed, len(files)


async def update_db_records():
    """Update storage_url in DB to strip 'uploads/' prefix for MinIO key format."""
    if not DATABASE_URL:
        print("\n[DB] DATABASE_URL not set — skipping DB update.")
        print("     You'll need to manually strip 'uploads/' from storage_url columns.")
        return

    # Normalize Railway's postgres:// to postgresql:// for asyncpg
    db_url = DATABASE_URL
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy import text

    engine = create_async_engine(db_url)

    print("\n--- Updating DB records ---\n")

    async with AsyncSession(engine) as db:
        # 1. Update appointment_attachments.storage_url
        result = await db.execute(
            text("SELECT id, storage_url FROM appointment_attachments WHERE storage_url LIKE 'uploads/%'")
        )
        attachments = result.fetchall()
        print(f"Found {len(attachments)} attachment records to update.")

        att_updated = 0
        for row in attachments:
            old_url = row[1]
            new_url = old_url.replace("\\", "/")
            if new_url.startswith("uploads/"):
                new_url = new_url[len("uploads/"):]
            await db.execute(
                text("UPDATE appointment_attachments SET storage_url = :new WHERE id = :id"),
                {"new": new_url, "id": row[0]},
            )
            att_updated += 1
            print(f"  attachment {row[0]}: {old_url} → {new_url}")

        # 2. Update appointments.audio_recording_url
        result = await db.execute(
            text("SELECT id, audio_recording_url FROM appointments WHERE audio_recording_url LIKE 'uploads/%'")
        )
        appointments = result.fetchall()
        print(f"\nFound {len(appointments)} appointment audio records to update.")

        apt_updated = 0
        for row in appointments:
            old_url = row[1]
            new_url = old_url.replace("\\", "/")
            if new_url.startswith("uploads/"):
                new_url = new_url[len("uploads/"):]
            await db.execute(
                text("UPDATE appointments SET audio_recording_url = :new WHERE id = :id"),
                {"new": new_url, "id": row[0]},
            )
            apt_updated += 1
            print(f"  appointment {row[0]}: {old_url} → {new_url}")

        await db.commit()
        print(f"\nDB update complete: {att_updated} attachments, {apt_updated} audio records updated.")

    await engine.dispose()


async def main():
    print("=" * 60)
    print("  Railway → MinIO Migration (standalone)")
    print("=" * 60)
    print(f"  MinIO endpoint: {MINIO_ENDPOINT}")
    print(f"  Bucket:         {MINIO_BUCKET}")
    print(f"  Database:       {'set' if DATABASE_URL else 'NOT SET'}")
    print(f"  Uploads dir:    {UPLOADS_DIR.resolve()}")
    print("=" * 60)

    # Step 1: Upload files to MinIO
    print("\n[Step 1] Uploading files to MinIO...\n")
    try:
        client = get_minio_client()
        ensure_bucket(client)
        success, failed, total = upload_files(client)
    except Exception as e:
        print(f"\nFATAL: Cannot connect to MinIO: {e}")
        print("Check FILE_STORAGE_ENDPOINT, ACCESS_KEY, SECRET_KEY.")
        return

    # Step 2: Update DB records
    print("\n[Step 2] Updating DB storage_url records...\n")
    await update_db_records()

    print("\n" + "=" * 60)
    print("  Migration complete!")
    print("=" * 60)
    print(f"\n  Files uploaded:  {success}")
    print(f"  Files failed:    {failed}")
    print(f"\n  You can now safely redeploy on Railway.")
    print(f"  Files persist in MinIO at {MINIO_ENDPOINT}")
    print("=" * 60)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
