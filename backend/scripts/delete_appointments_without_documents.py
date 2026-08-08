"""
Delete appointments whose document/image upload is missing or never existed.

Scope: PETITIONS (i.e. non-courtesy Appointments). A row is a DELETE candidate
when it has no readable document/image attachment — either it has no attachments
at all, its "attachments" are audio-only, or its DOCUMENT/IMAGE storage keys all
resolve to a real 404 in MinIO (the DB row points at a key that isn't there).
These petitions have nothing for a reviewer to read, so they're dead records.

Deleting the appointment cascades in Postgres (all FKs are ON DELETE CASCADE):
    appointment  ->  ticket  ->  ticket_attachments, activity
                 ->  grievance_summary_records
                 ->  attachments (petition uploads)
(ai_uploads.appointment_id / ticket_id are SET NULL — harmless orphan pointer.)
The DB does NOT remove MinIO objects, so any petition storage keys the row still
held are deleted here too, best-effort.

**Courtesy is ALWAYS preserved.** Any appointment whose grievance_category is in
COURTESY_CATEGORIES ({"greetings", "invitation"}) is skipped no matter what its
attachments look like — a voice-only greeting or an invitation with no photo is
a legitimate courtesy record, not a broken petition.

Correctness under a wobbly MinIO: every HEAD is classified as exists / missing
(true 404) / error. Only exists+missing count as authoritative — if any of a
row's doc keys returned an 'error' (network / auth / timeout), the row is KEPT
so a transient outage can't wipe the DB. The summary reports how many rows were
kept solely because of inconclusive probes; a big number means re-run later.

MinIO HEADs are dispatched in parallel with a bounded semaphore so a large table
finishes in seconds instead of minutes; every URL is still checked individually.

    cd backend
    ./env/bin/python scripts/delete_appointments_without_documents.py            # dry-run
    ./env/bin/python scripts/delete_appointments_without_documents.py --yes      # execute
    ./env/bin/python scripts/delete_appointments_without_documents.py --yes --limit 25
    ./env/bin/python scripts/delete_appointments_without_documents.py --concurrency 64
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

# Import model modules so every mapper is registered before we query.
import src.models.login_models  # noqa: E402,F401
import src.models.ticket_models  # noqa: E402,F401
import src.models.grievance_summary_record  # noqa: E402,F401
import src.models.ai_upload_models  # noqa: E402,F401
import src.models.scheduling_models  # noqa: E402,F401
import src.models.activity_models  # noqa: E402,F401
import src.models.referral_models  # noqa: E402,F401

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.models.appointment_models import Appointment  # noqa: E402
from src.services import storage_service  # noqa: E402
from src.services.admin_lookup import admin  # noqa: E402
from src.services.appointment_service import COURTESY_CATEGORIES  # noqa: E402

# Attachment types that count as a "readable upload" — the reviewer's document.
# AUDIO alone is NOT a document; it's a voice note attached to a petition (which
# under the current rules is a petition with no readable document, i.e. dead).
_DOC_TYPES = {"DOCUMENT", "IMAGE"}

# Probe outcomes for a single storage key. 'error' is deliberately distinct from
# 'missing' so a transient MinIO hiccup can't be misread as "gone forever".
_EXISTS = "exists"
_MISSING = "missing"
_ERROR = "error"


try:  # optional import — only used to classify boto errors precisely
    from botocore.exceptions import ClientError as _BotoClientError  # type: ignore
except ImportError:  # pragma: no cover — dev machine without boto3
    _BotoClientError = None  # type: ignore


def _probe_key(key: str) -> str:
    """Classify a MinIO/S3 key as exists / missing / error.

    Uses storage_service's private client so we hit the SAME bucket + key
    normalisation as the app. Only a real 404 (NoSuchKey / '404' / 'NotFound')
    resolves to 'missing'; every other exception (network, auth, timeout)
    resolves to 'error' — the caller treats 'error' as inconclusive and keeps
    the row, so a MinIO outage never causes an over-delete.
    """
    if not key:
        return _MISSING
    client = storage_service._get_client()   # noqa: SLF001 — intentional
    if client is None:
        # Local-disk fallback (dev): treat presence-with-size as exists.
        size = storage_service.get_file_size(key)
        return _EXISTS if (size and size > 0) else _MISSING
    k = key.replace("\\", "/")
    if k.startswith("uploads/"):
        k = k[len("uploads/"):]
    try:
        obj = client.head_object(Bucket=storage_service._bucket(), Key=k)  # noqa: SLF001
        return _EXISTS if int(obj.get("ContentLength") or 0) > 0 else _MISSING
    except Exception as exc:  # noqa: BLE001
        if _BotoClientError is not None and isinstance(exc, _BotoClientError):
            code = str(exc.response.get("Error", {}).get("Code", "")).lower()  # type: ignore[attr-defined]
            status = str(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", ""))  # type: ignore[attr-defined]
            if code in ("nosuchkey", "notfound", "404") or status == "404":
                return _MISSING
        return _ERROR


async def _probe_async(key: str, sem: asyncio.Semaphore) -> str:
    async with sem:
        return await asyncio.to_thread(_probe_key, key)


class Decision:
    __slots__ = ("kind", "reason", "purge_keys", "cat")

    def __init__(self, kind: str, reason: Optional[str] = None,
                 purge_keys: Optional[List[str]] = None, cat: str = ""):
        self.kind = kind                    # "KEEP" | "DELETE" | "SKIP" | "INCONCLUSIVE"
        self.reason = reason
        self.purge_keys = purge_keys or []
        self.cat = cat


async def _decide(appt: Appointment, sem: asyncio.Semaphore) -> Decision:
    """Return a Decision for one appointment.

    - SKIP           → courtesy (always preserved).
    - KEEP           → at least one DOCUMENT/IMAGE key exists in storage.
    - INCONCLUSIVE   → no confirmed 'exists' but at least one 'error' —
                       kept for safety; caller reports the count.
    - DELETE         → every DOCUMENT/IMAGE key confirmed missing (or none
                       exist at all → audio-only / no attachments).
    """
    cat = (getattr(appt, "grievance_category", None) or "").strip().lower()
    if cat in COURTESY_CATEGORIES:
        return Decision("SKIP", cat=cat)

    atts = list(appt.attachments or [])
    doc_atts = [a for a in atts if (a.attachment_type or "").upper() in _DOC_TYPES]

    saw_error = False
    if doc_atts:
        # Parallel HEAD on this appointment's doc keys — the semaphore caps
        # total concurrency across the whole run, so a batch of 1000 rows with
        # 3 docs each still stays inside its budget.
        states = await asyncio.gather(*(_probe_async(a.storage_url or "", sem) for a in doc_atts))
        for s in states:
            if s == _EXISTS:
                return Decision("KEEP", cat=cat)
            if s == _ERROR:
                saw_error = True

    if saw_error:
        # Some docs couldn't be probed cleanly — cannot safely conclude
        # "missing". Keep the row; the operator will re-run once MinIO is
        # healthy. This is the only branch that stops an over-delete during
        # an outage, so it's non-negotiable.
        return Decision("INCONCLUSIVE", cat=cat)

    # Every doc probe returned 'missing', OR there were no doc attachments —
    # the row is a delete. Note which flavour so the log is useful.
    audio_only = any((a.attachment_type or "").upper() == "AUDIO" for a in atts)
    if not atts:
        reason = "no attachments at all"
    elif not doc_atts and audio_only:
        reason = "audio-only, no document"
    else:
        reason = "has doc attachments but all storage keys 404"

    # Keys to purge — every key this row owned, minus the migrated-namespace
    # keys that belong to proposals/associations rows.
    purge = [
        (a.storage_url or "") for a in atts
        if a.storage_url
        and not str(a.storage_url).startswith("proposals/")
        and not str(a.storage_url).startswith("associations/")
    ]
    return Decision("DELETE", reason=reason, purge_keys=purge, cat=cat)


async def run(*, commit: bool, limit: Optional[int], concurrency: int) -> None:
    sem = asyncio.Semaphore(max(1, concurrency))
    kept = skipped = inconclusive = 0
    deletes: List[Tuple[int, Decision]] = []

    async with AsyncSessionLocal() as db:
        # The Appointment.grievance_category hybrid reads through the admin
        # cache; a script run has no FastAPI startup to warm it, so we load it
        # ourselves before touching any hybrid column.
        await admin.load(db)

        appts = (await db.execute(
            select(Appointment)
            .options(selectinload(Appointment.attachments))
            .order_by(Appointment.id)
        )).scalars().all()

        target = appts if limit is None else appts[:limit]
        print(f"[scan] {len(appts)} appointment(s); scanning {len(target)}; "
              f"mode={'EXECUTE' if commit else 'DRY-RUN'}; concurrency={concurrency}\n")

        # Fan out every appointment's decision in parallel. The semaphore inside
        # _probe_async caps the total number of concurrent MinIO HEADs across
        # the run — the outer gather itself has no cap beyond that.
        decisions = await asyncio.gather(*(_decide(a, sem) for a in target))

        for appt, d in zip(target, decisions):
            if d.kind == "SKIP":
                skipped += 1
                # Silent by default — courtesy rows are often the majority.
            elif d.kind == "KEEP":
                kept += 1
            elif d.kind == "INCONCLUSIVE":
                inconclusive += 1
                print(f"  appt {appt.id}: KEEP  (INCONCLUSIVE — storage probe error, re-run later)")
            else:  # DELETE
                deletes.append((appt.id, d))
                print(f"  appt {appt.id}: DELETE  cat={d.cat or '—'}  ({d.reason})")

        if commit and deletes:
            ids = [i for i, _ in deletes]
            await db.execute(delete(Appointment).where(Appointment.id.in_(ids)))
            await db.commit()
            print(f"\n  deleted {len(ids)} appointment(s) (Postgres cascade removed tickets, GSR, attachments)")

            # Purge storage in parallel too — same semaphore budget.
            all_keys = [k for _, d in deletes for k in d.purge_keys]
            purged = 0

            async def _purge(k: str) -> bool:
                async with sem:
                    try:
                        return bool(await asyncio.to_thread(storage_service.delete_file, k))
                    except Exception as exc:  # noqa: BLE001
                        print(f"     · storage purge failed for {k}: {exc!r}")
                        return False

            results = await asyncio.gather(*(_purge(k) for k in all_keys))
            purged = sum(1 for r in results if r)
            print(f"  purged {purged}/{len(all_keys)} orphan storage object(s)")

    print("\n──────── summary ────────")
    print(f"  {'deleted' if commit else 'would delete'} appointments : {len(deletes)}")
    print(f"  kept (has readable document)          : {kept}")
    print(f"  kept (INCONCLUSIVE — probe error)     : {inconclusive}")
    print(f"  skipped (courtesy — always preserved) : {skipped}")
    if inconclusive:
        print("  → some rows could not be probed cleanly (MinIO hiccup?). Re-run when "
              "storage is healthy to reassess them.")
    if not commit:
        print("  mode: DRY-RUN — nothing deleted. Re-run with --yes to execute.")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Delete non-courtesy petitions whose document/image uploads are "
                    "missing or audio-only. Courtesy (greetings/invitation) is always "
                    "preserved. Every storage URL is HEAD-checked (parallel); only a "
                    "real 404 counts as missing — transient errors keep the row."
    )
    p.add_argument("--yes", action="store_true",
                   help="actually delete (default is a dry-run)")
    p.add_argument("--limit", type=int, default=None,
                   help="process at most N candidates (in appointment_id order)")
    p.add_argument("--concurrency", type=int, default=32,
                   help="max concurrent MinIO HEAD requests (default: 32)")
    args = p.parse_args()
    asyncio.run(run(commit=args.yes, limit=args.limit, concurrency=args.concurrency))


if __name__ == "__main__":
    main()
