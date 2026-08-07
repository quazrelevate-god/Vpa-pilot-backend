"""
Migrate mis-filed association/union matters OUT of petition review INTO the
association-review queue.

Petitions filed under the `associations_unions` grievance category may actually
be collective matters from a union/association that belong in the association
queue. This script walks those petitions, runs each one's document through the
SAME classification layer the live intake uses (document_router.route), and:

    classifier says ASSOCIATION  ->  build an association_submissions row from
                                     the router's AssociationExtraction, copy the
                                     document(s) into MinIO under associations/,
                                     and stamp source_appointment_id.
    anything else                ->  LEAVE the petition exactly where it is
                                     (petition review). Fallback: petition /
                                     proposal / courtesy / low confidence / no
                                     readable document all stay.

Idempotent: an appointment that already produced an association (its id appears
in association_submissions.source_appointment_id) is skipped, so re-runs are safe.

NOTHING is deleted here — deletion is a separate, gated script that only runs
after validate_association_migration.py confirms the copy. Run this DRY first:

    cd backend
    ./env/bin/python scripts/migrate_associations_from_petitions.py            # dry-run
    ./env/bin/python scripts/migrate_associations_from_petitions.py --commit   # write
    ./env/bin/python scripts/migrate_associations_from_petitions.py --commit --limit 5
"""
from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
from pathlib import PurePosixPath

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

# Import the model modules so every mapper is registered before we query.
import src.models.login_models  # noqa: E402,F401
import src.models.ticket_models  # noqa: E402,F401
import src.models.grievance_summary_record  # noqa: E402,F401
import src.models.ai_upload_models  # noqa: E402,F401
import src.models.scheduling_models  # noqa: E402,F401  — registers AppointmentSlot for the Appointment mapper
import src.models.activity_models  # noqa: E402,F401
import src.models.referral_models  # noqa: E402,F401

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.core.timeutil import now_utc  # noqa: E402
from src.models.appointment_models import Appointment  # noqa: E402
from src.models.association_models import AssociationSubmission, STATUS_AWAITING_REVIEW  # noqa: E402
from src.services import storage_service  # noqa: E402
from src.services.document_router import document_router  # noqa: E402
from src.services.appointment_service import appointment_service  # noqa: E402

# Attachment types we never try to classify as an association document.
_SKIP_ATTACHMENT_TYPES = {"AUDIO"}


def _basename(key: str) -> str:
    return PurePosixPath(key or "").name or "document.pdf"


def _classifiable(atts) -> list:
    """Document-like attachments, PDF first then anything else, audio dropped."""
    docs = [a for a in atts if (a.attachment_type or "").upper() not in _SKIP_ATTACHMENT_TYPES]
    docs.sort(key=lambda a: 0 if (a.mime_type or "").lower() == "application/pdf" else 1)
    return docs


def _enum_val(ex, name):
    """Association enums (category/ministry/urgency/district) → their string value."""
    v = getattr(ex, name, None)
    return getattr(v, "value", v) if v is not None else None


async def _get_bytes(storage_url: str):
    return await asyncio.to_thread(storage_service.get_file_bytes, storage_url)


async def migrate(*, category: str, commit: bool, limit: int | None) -> None:
    moved = stayed = skipped = failed = 0
    async with AsyncSessionLocal() as db:
        appts = (await db.execute(
            select(Appointment)
            .where(Appointment.grievance_category == category)
            .options(selectinload(Appointment.attachments))
            .order_by(Appointment.id)
        )).scalars().all()

        already = set((await db.execute(
            select(AssociationSubmission.source_appointment_id)
            .where(AssociationSubmission.source_appointment_id.isnot(None))
        )).scalars().all())

        print(f"[migrate] category={category!r}: {len(appts)} candidate petition(s); "
              f"{len(already)} already migrated; commit={commit}\n")

        processed = 0
        for appt in appts:
            if limit is not None and processed >= limit:
                break
            processed += 1

            if appt.id in already:
                skipped += 1
                print(f"  appt {appt.id}: SKIP (already migrated)")
                continue

            docs = _classifiable(list(appt.attachments or []))
            if not docs:
                stayed += 1
                print(f"  appt {appt.id}: STAY (no classifiable document)")
                continue

            primary = docs[0]
            raw = await _get_bytes(primary.storage_url)
            if not raw:
                failed += 1
                print(f"  appt {appt.id}: STAY (primary document unreadable: {primary.storage_url})")
                continue

            # ── The decision: run the live classification layer ──────────────
            try:
                routed = await asyncio.to_thread(
                    document_router.route,
                    file_bytes=raw,
                    mime_type=(primary.mime_type or "application/pdf"),
                    filename=_basename(primary.storage_url),
                )
            except Exception as exc:  # noqa: BLE001 — one bad doc must not abort the batch
                failed += 1
                print(f"  appt {appt.id}: STAY (classification error: {exc!r})")
                continue

            if routed.type != "association":
                stayed += 1
                print(f"  appt {appt.id}: STAY (classified={routed.classified_type}, "
                      f"final={routed.type}, confidence={routed.confidence})")
                continue

            # ── It IS an association → build the submission ──────────────────
            ex = routed.extraction
            ext_json = ex.model_dump(mode="json") if ex is not None else None

            # Copy every document into MinIO under the association's own namespace
            # so the row is self-contained once the petition is deleted. No
            # tracking_ref on associations, so key the folder off the source appt.
            slug = f"appt{appt.id}_{secrets.token_hex(4)}"
            documents: list[dict] = []
            for a in docs:
                data = raw if a is primary else await _get_bytes(a.storage_url)
                if not data:
                    print(f"     · appt {appt.id}: doc unreadable, skipped ({a.storage_url})")
                    continue
                safe = appointment_service._sanitize_filename(_basename(a.storage_url))
                rel = f"associations/{slug}/{secrets.token_hex(6)}_{safe}"
                mime = (a.mime_type or "application/pdf")
                if commit:
                    url = await asyncio.to_thread(storage_service.save_file, data, rel, mime)
                else:
                    url = rel  # dry-run: show the intended key without writing
                documents.append({"original_filename": safe, "storage_url": url, "mime_type": mime})

            row = AssociationSubmission(
                source="migration",
                source_ref=f"appointment:{appt.id}",
                documents=documents or None,
                association_name=(getattr(ex, "association_name", None) or None),
                member_count=(getattr(ex, "member_count", None) or None),
                representative_name=(getattr(ex, "representative_name", None) or None),
                representative_designation=(getattr(ex, "representative_designation", None) or None),
                category=_enum_val(ex, "category"),
                ministry=_enum_val(ex, "ministry"),
                urgency=_enum_val(ex, "urgency"),
                district=_enum_val(ex, "district"),
                document_date=(getattr(ex, "document_date", None) or None),
                extraction_json=ext_json,
                status=STATUS_AWAITING_REVIEW,
                source_appointment_id=appt.id,
                created_at=now_utc(),
            )
            if commit:
                db.add(row)
            moved += 1
            print(f"  appt {appt.id}: MOVE  -> association ({len(documents)} doc, "
                  f"assoc={getattr(ex, 'association_name', None) or '—'})")

        if commit:
            await db.commit()

    print("\n──────── summary ────────")
    print(f"  moved to association review : {moved}")
    print(f"  stayed in petition review   : {stayed}")
    print(f"  skipped (already done)      : {skipped}")
    print(f"  failed (unreadable/error)   : {failed}")
    print(f"  mode: {'COMMITTED' if commit else 'DRY-RUN (nothing written) — pass --commit to write'}")


def main() -> None:
    p = argparse.ArgumentParser(description="Migrate 'associations_unions'-category petitions into association review.")
    p.add_argument("--category", default="associations_unions", help="grievance category to scan")
    p.add_argument("--commit", action="store_true", help="actually write (default is a dry-run)")
    p.add_argument("--limit", type=int, default=None, help="process at most N candidates")
    args = p.parse_args()
    asyncio.run(migrate(category=args.category, commit=args.commit, limit=args.limit))


if __name__ == "__main__":
    main()
