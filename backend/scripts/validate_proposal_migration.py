"""
Validate the petition→proposal migration BEFORE anything is deleted.

For every proposal that was migrated (proposal_submissions.source_appointment_id
is set) this checks the copy is complete and self-contained:

  • the source appointment still exists and is in the target category;
  • no two proposals claim the same source appointment;
  • the proposal has >= 1 document AND every document lives under proposals/
    (i.e. copied into the proposal's own MinIO namespace, NOT still pointing at
    the petition's soon-to-be-deleted attachment key);
  • the primary document object actually exists in MinIO;
  • extraction_json and tracking_ref are present.

Exit code 0 = every migrated proposal is safe to delete its petition from.
Exit code 1 = at least one FAIL — delete_migrated_petitions.py must not run.

    cd backend
    ./env/bin/python scripts/validate_proposal_migration.py
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402

import src.models.login_models  # noqa: E402,F401
import src.models.ticket_models  # noqa: E402,F401
import src.models.grievance_summary_record  # noqa: E402,F401
import src.models.ai_upload_models  # noqa: E402,F401
import src.models.scheduling_models  # noqa: E402,F401  — registers AppointmentSlot for the Appointment mapper
import src.models.activity_models  # noqa: E402,F401
import src.models.referral_models  # noqa: E402,F401

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.models.appointment_models import Appointment  # noqa: E402
from src.models.proposal_models import ProposalSubmission  # noqa: E402
from src.services import storage_service  # noqa: E402


async def validate(*, category: str) -> int:
    fails = 0
    ok = 0
    async with AsyncSessionLocal() as db:
        migrated = (await db.execute(
            select(ProposalSubmission).where(ProposalSubmission.source_appointment_id.isnot(None))
        )).scalars().all()

        appt_ids = set((await db.execute(
            select(Appointment.id).where(Appointment.grievance_category == category)
        )).scalars().all())

        dupes = {aid: n for aid, n in Counter(
            p.source_appointment_id for p in migrated
        ).items() if n > 1}

        print(f"[validate] {len(migrated)} migrated proposal(s); "
              f"{len(appt_ids)} petition(s) still in category={category!r}\n")

        for p in migrated:
            problems = []
            src = p.source_appointment_id

            if dupes.get(src):
                problems.append(f"source appointment {src} claimed by {dupes[src]} proposals")
            if src not in appt_ids:
                problems.append(f"source appointment {src} missing from category {category!r} "
                                "(deleted already, or category changed)")
            docs = p.documents or []
            if not docs:
                problems.append("no documents")
            else:
                offenders = [d.get("storage_url", "") for d in docs
                             if not str(d.get("storage_url", "")).startswith("proposals/")]
                if offenders:
                    problems.append(f"document(s) not copied into proposals/ namespace: {offenders}")
                else:
                    # confirm the primary object actually exists in MinIO
                    size = await asyncio.to_thread(storage_service.get_file_size, docs[0]["storage_url"])
                    if size is None:
                        problems.append(f"primary document object missing in storage: {docs[0]['storage_url']}")
            if not p.extraction_json:
                problems.append("empty extraction_json")
            if not p.tracking_ref:
                problems.append("missing tracking_ref")

            if problems:
                fails += 1
                print(f"  FAIL  proposal {p.id} (ref={p.tracking_ref}, src_appt={src}):")
                for pr in problems:
                    print(f"          - {pr}")
            else:
                ok += 1

    print("\n──────── summary ────────")
    print(f"  OK   : {ok}")
    print(f"  FAIL : {fails}")
    if fails:
        print("  → NOT safe to delete. Fix the failing proposals (re-run migrate) first.")
        return 1
    print("  → every migrated petition has a complete, self-contained proposal. Safe to delete.")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Validate the petition→proposal migration before deletion.")
    p.add_argument("--category", default="proposals", help="grievance category that was migrated")
    args = p.parse_args()
    sys.exit(asyncio.run(validate(category=args.category)))


if __name__ == "__main__":
    main()
