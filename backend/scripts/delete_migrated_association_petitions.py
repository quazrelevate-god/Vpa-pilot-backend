"""
Hard-delete petitions that have been migrated to association review.

ONLY touches an appointment that has a complete, self-contained association
pointing back at it (association_submissions.source_appointment_id + documents
under associations/ + extraction_json). Any appointment that isn't safely
migrated is REFUSED — never deleted.

Deleting the appointment cascades in Postgres (all FKs are ON DELETE CASCADE):
    appointment  ->  ticket  ->  ticket_attachments, activity
                 ->  grievance_summary_records
                 ->  attachments (petition uploads)
The DB does NOT remove MinIO objects, so the petition's old attachment keys are
deleted here too (the association keeps its OWN copies under associations/).

    cd backend
    ./env/bin/python scripts/delete_migrated_association_petitions.py            # dry-run
    ./env/bin/python scripts/delete_migrated_association_petitions.py --yes      # execute
    ./env/bin/python scripts/delete_migrated_association_petitions.py --yes --limit 5
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import delete, func, select  # noqa: E402

import src.models.login_models  # noqa: E402,F401
import src.models.ticket_models  # noqa: E402,F401
import src.models.grievance_summary_record  # noqa: E402,F401
import src.models.ai_upload_models  # noqa: E402,F401
import src.models.scheduling_models  # noqa: E402,F401  — registers AppointmentSlot for the Appointment mapper
import src.models.activity_models  # noqa: E402,F401
import src.models.referral_models  # noqa: E402,F401

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.models.appointment_models import Appointment, AppointmentAttachment  # noqa: E402
from src.models.grievance_summary_record import GrievanceSummaryRecord  # noqa: E402
from src.models.association_models import AssociationSubmission  # noqa: E402
from src.models.ticket_models import Ticket  # noqa: E402
from src.services import storage_service  # noqa: E402


def _association_ok(a: AssociationSubmission) -> bool:
    """Mirror validate_association_migration: complete + self-contained."""
    if a is None or not a.extraction_json:
        return False
    docs = a.documents or []
    if not docs:
        return False
    return all(str(d.get("storage_url", "")).startswith("associations/") for d in docs)


async def run(*, category: str, commit: bool, limit: int | None) -> None:
    deleted = refused = 0
    async with AsyncSessionLocal() as db:
        # Map appointment_id -> its migrated association.
        migrated = (await db.execute(
            select(AssociationSubmission).where(AssociationSubmission.source_appointment_id.isnot(None))
        )).scalars().all()
        by_appt = {a.source_appointment_id: a for a in migrated}

        # Candidate petitions: still in the category AND claimed by an association.
        appts = (await db.execute(
            select(Appointment)
            .where(Appointment.grievance_category == category,
                   Appointment.id.in_(list(by_appt.keys()) or [-1]))
            .order_by(Appointment.id)
        )).scalars().all()

        print(f"[delete] category={category!r}: {len(appts)} petition(s) claimed by an association; "
              f"mode={'EXECUTE' if commit else 'DRY-RUN'}\n")

        to_delete: list[int] = []
        keys_to_purge: list[str] = []
        processed = 0
        for appt in appts:
            if limit is not None and processed >= limit:
                break
            processed += 1

            assoc = by_appt.get(appt.id)
            if not _association_ok(assoc):
                refused += 1
                print(f"  appt {appt.id}: REFUSE (association {getattr(assoc, 'id', None)} "
                      "incomplete — run validate/migrate first)")
                continue

            ticket_n = (await db.execute(
                select(func.count(Ticket.id)).where(Ticket.appointment_id == appt.id)
            )).scalar() or 0
            gsr_n = (await db.execute(
                select(func.count(GrievanceSummaryRecord.id)).where(GrievanceSummaryRecord.appointment_id == appt.id)
            )).scalar() or 0
            att_keys = (await db.execute(
                select(AppointmentAttachment.storage_url).where(AppointmentAttachment.appointment_id == appt.id)
            )).scalars().all()

            to_delete.append(appt.id)
            # Never purge a key in the association namespace (defensive — petition
            # keys are under attachments/, not associations/).
            keys_to_purge.extend(k for k in att_keys if k and not str(k).startswith("associations/"))
            print(f"  appt {appt.id}: DELETE  -> association {assoc.id} | "
                  f"cascades: ticket×{ticket_n}, gsr×{gsr_n}, attachments×{len(att_keys)}")

        if commit and to_delete:
            await db.execute(delete(Appointment).where(Appointment.id.in_(to_delete)))
            await db.commit()
            deleted = len(to_delete)
            purged = 0
            for k in keys_to_purge:
                try:
                    if await asyncio.to_thread(storage_service.delete_file, k):
                        purged += 1
                except Exception as exc:  # noqa: BLE001 — object cleanup is best-effort
                    print(f"     · storage purge failed for {k}: {exc!r}")
            print(f"\n  purged {purged}/{len(keys_to_purge)} petition storage object(s)")
        else:
            deleted = 0

    print("\n──────── summary ────────")
    print(f"  {'deleted' if commit else 'would delete'} petitions: {len(to_delete) if not commit else deleted}")
    print(f"  refused (not safely migrated): {refused}")
    if not commit:
        print("  mode: DRY-RUN — nothing deleted. Re-run with --yes to execute.")


def main() -> None:
    p = argparse.ArgumentParser(description="Hard-delete petitions that have a validated association.")
    p.add_argument("--category", default="associations_unions", help="grievance category that was migrated")
    p.add_argument("--yes", action="store_true", help="actually delete (default is a dry-run)")
    p.add_argument("--limit", type=int, default=None, help="process at most N candidates")
    args = p.parse_args()
    asyncio.run(run(category=args.category, commit=args.yes, limit=args.limit))


if __name__ == "__main__":
    main()
