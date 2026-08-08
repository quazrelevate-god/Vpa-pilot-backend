"""
Strip everything that leaked into a "petition" surface off a courtesy record.

Rule: a courtesy submission (grievance_category ∈ {greetings, invitation}) lives
ONLY on the appointment table. It must NEVER carry:
  • a ticket                              (courtesy isn't a case to work);
  • a grievance_summary_records row       (courtesy skips the petition AI);
  • an ai_uploads row in the review queue (the review inbox is for petitions);
  • a petition_groups entry as primary    (a group is a signature-petition
                                           campaign; courtesy can't lead one).

If any of these leaked in — through an older code path, a mis-classified intake,
or a manual test — this script removes the link. The courtesy Appointment
itself and its own attachments (the greeting audio / invitation image) are
NEVER touched; only the misplaced linked rows are cleaned.

The four passes, all idempotent:

  A) Ticket                      →  DELETE  (Postgres ON DELETE CASCADE
                                             removes ticket_attachments and
                                             activity; MinIO keys purged best-
                                             effort here).
  B) GSR (appointment-only)      →  DELETE  (only when ai_upload_id IS NULL —
                                             the row has no other reason to
                                             exist).
  C) GSR (also on an ai_upload)  →  UNLINK  (set appointment_id = NULL — the
                                             row survives on the ai_upload
                                             side; the courtesy appointment
                                             is no longer referenced).
  D) ai_uploads (petition-review) → DISMISS (set status = DISMISSED — matches
                                             the app's existing convention for
                                             "courtesy audio, blank scans,
                                             duplicates". The upload identifies
                                             as courtesy iff its latest GSR
                                             category is greetings/invitation).
  E) petition_groups where the
     primary IS a courtesy appt   → UNLINK  (set primary_appointment_id = NULL,
                                             mirroring the schema's own SET
                                             NULL safety when a primary is
                                             deleted — a group with a NULL
                                             primary is a known-safe state and
                                             preserves any signatories the
                                             group is holding).

    cd backend
    ./env/bin/python scripts/cleanup_courtesy_leaks.py            # dry-run
    ./env/bin/python scripts/cleanup_courtesy_leaks.py --yes      # execute
    ./env/bin/python scripts/cleanup_courtesy_leaks.py --yes --limit 25
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import delete, select, update  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

# Import model modules so every mapper is registered before we query.
import src.models.login_models  # noqa: E402,F401
import src.models.ai_upload_models  # noqa: E402,F401
import src.models.scheduling_models  # noqa: E402,F401
import src.models.activity_models  # noqa: E402,F401
import src.models.referral_models  # noqa: E402,F401
import src.models.petition_group  # noqa: E402,F401

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.models.appointment_models import Appointment  # noqa: E402
from src.models.ai_upload_models import AiUpload, STATUS_DISMISSED  # noqa: E402
from src.models.grievance_summary_record import GrievanceSummaryRecord  # noqa: E402
from src.models.petition_group import PetitionGroup  # noqa: E402
from src.models.ticket_models import Ticket  # noqa: E402
from src.services import storage_service  # noqa: E402
from src.services.admin_lookup import admin  # noqa: E402
from src.services.appointment_service import COURTESY_CATEGORIES  # noqa: E402


async def _purge_keys(keys: List[str], concurrency: int) -> int:
    """Best-effort parallel MinIO delete. Never raises — a purge failure just
    leaves an orphan blob; the DB truth is already correct by the time we get
    here."""
    if not keys:
        return 0
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(k: str) -> bool:
        async with sem:
            try:
                return bool(await asyncio.to_thread(storage_service.delete_file, k))
            except Exception as exc:  # noqa: BLE001
                print(f"     · storage purge failed for {k}: {exc!r}")
                return False

    results = await asyncio.gather(*(_one(k) for k in keys))
    return sum(1 for r in results if r)


async def run(*, commit: bool, limit: Optional[int], concurrency: int) -> None:
    async with AsyncSessionLocal() as db:
        # The GSR/ai_upload hybrid setters resolve slugs through admin, so
        # warm the cache before any status/category assignment fires.
        await admin.load(db)

        # 0) Every courtesy appointment id.
        courtesy_ids = (await db.execute(
            select(Appointment.id)
            .where(Appointment.grievance_category.in_(list(COURTESY_CATEGORIES)))
            .order_by(Appointment.id)
        )).scalars().all()

        target = courtesy_ids if limit is None else courtesy_ids[:limit]
        target_set = set(target)
        print(f"[scan] {len(courtesy_ids)} courtesy appointment(s); "
              f"inspecting {len(target)}; mode={'EXECUTE' if commit else 'DRY-RUN'}\n")

        # ── A) Tickets that leaked onto those appointments (+ attachment keys).
        tickets = (await db.execute(
            select(Ticket)
            .where(Ticket.appointment_id.in_(target))
            .options(selectinload(Ticket.attachments))
            .order_by(Ticket.id)
        )).scalars().all() if target else []
        ticket_ids = [t.id for t in tickets]
        ticket_att_keys: List[str] = [
            (a.storage_url or "") for t in tickets for a in (t.attachments or []) if a.storage_url
        ]

        # ── B/C) GSRs linked to courtesy appointments, split by ai_upload_id.
        gsr_rows = (await db.execute(
            select(GrievanceSummaryRecord)
            .where(GrievanceSummaryRecord.appointment_id.in_(target))
            .order_by(GrievanceSummaryRecord.id)
        )).scalars().all() if target else []
        gsr_to_delete = [g.id for g in gsr_rows if g.ai_upload_id is None]
        gsr_to_unlink = [g.id for g in gsr_rows if g.ai_upload_id is not None]

        # ── D) ai_uploads whose LATEST GSR classifies as courtesy. This is the
        #      independent leak: an AI-scan that the classifier called courtesy
        #      shouldn't sit in the petition-review queue. We identify by the
        #      GSR's category (id-resolved via the hybrid) and skip rows that
        #      are already DISMISSED (idempotent).
        courtesy_cat_ids = [
            admin.category(v) for v in COURTESY_CATEGORIES if admin.category(v) is not None
        ]
        ai_upload_rows_to_dismiss = []
        if courtesy_cat_ids:
            ai_upload_rows_to_dismiss = (await db.execute(
                select(AiUpload)
                .join(GrievanceSummaryRecord,
                      (GrievanceSummaryRecord.ai_upload_id == AiUpload.id) &
                      (GrievanceSummaryRecord.is_latest.is_(True)))
                .where(GrievanceSummaryRecord.category_id.in_(courtesy_cat_ids))
                .where(AiUpload.status != STATUS_DISMISSED)
                .order_by(AiUpload.id)
            )).scalars().all()
        ai_upload_ids_to_dismiss = [u.id for u in ai_upload_rows_to_dismiss]

        # ── E) petition_groups whose primary IS a courtesy appointment.
        pg_rows = (await db.execute(
            select(PetitionGroup)
            .where(PetitionGroup.primary_appointment_id.in_(target))
            .order_by(PetitionGroup.id)
        )).scalars().all() if target else []
        pg_ids_to_unlink = [g.id for g in pg_rows]

        # ── Per-appointment log — one line per affected appointment so the
        #    operator sees exactly what the batch will change.
        by_appt_tk: dict = {}
        for t in tickets:
            by_appt_tk.setdefault(t.appointment_id, []).append(t.id)
        by_appt_gs_del: dict = {}
        by_appt_gs_unlink: dict = {}
        for g in gsr_rows:
            if g.ai_upload_id is None:
                by_appt_gs_del.setdefault(g.appointment_id, []).append(g.id)
            else:
                by_appt_gs_unlink.setdefault(g.appointment_id, []).append(
                    (g.id, g.ai_upload_id)
                )
        by_appt_pg: dict = {}
        for g in pg_rows:
            by_appt_pg.setdefault(g.primary_appointment_id, []).append(g.id)

        touched = 0
        for aid in target:
            tk = by_appt_tk.get(aid, [])
            gd = by_appt_gs_del.get(aid, [])
            gu = by_appt_gs_unlink.get(aid, [])
            pg = by_appt_pg.get(aid, [])
            if not (tk or gd or gu or pg):
                continue
            touched += 1
            bits = []
            if tk: bits.append(f"delete ticket×{len(tk)} (ids={tk})")
            if gd: bits.append(f"delete gsr×{len(gd)} (ids={gd})")
            if gu: bits.append(f"unlink gsr×{len(gu)} (ids/ai_upload={gu})")
            if pg: bits.append(f"unlink petition_group×{len(pg)} (ids={pg})")
            print(f"  appt {aid}: " + "; ".join(bits))

        # ── D log (ai_uploads leak) — separate: these AREN'T tied to a
        #    courtesy appointment (they're classifier-verdict courtesy scans).
        if ai_upload_rows_to_dismiss:
            print()
            for u in ai_upload_rows_to_dismiss:
                print(f"  ai_upload {u.id}: DISMISS  (courtesy category on latest GSR; "
                      f"was status={u.status})")

        # ── Apply — one bulk statement per pass, all inside one transaction.
        if commit:
            if ticket_ids:
                await db.execute(delete(Ticket).where(Ticket.id.in_(ticket_ids)))
            if gsr_to_delete:
                await db.execute(delete(GrievanceSummaryRecord)
                                 .where(GrievanceSummaryRecord.id.in_(gsr_to_delete)))
            if gsr_to_unlink:
                await db.execute(
                    update(GrievanceSummaryRecord)
                    .where(GrievanceSummaryRecord.id.in_(gsr_to_unlink))
                    .values(appointment_id=None)
                )
            if ai_upload_ids_to_dismiss:
                # status is a hybrid over status_id — the setter (via .values)
                # is registered on the column so this works with a bulk update.
                await db.execute(
                    update(AiUpload)
                    .where(AiUpload.id.in_(ai_upload_ids_to_dismiss))
                    .values(status=STATUS_DISMISSED)
                )
            if pg_ids_to_unlink:
                await db.execute(
                    update(PetitionGroup)
                    .where(PetitionGroup.id.in_(pg_ids_to_unlink))
                    .values(primary_appointment_id=None)
                )
            await db.commit()

            purged = await _purge_keys(ticket_att_keys, concurrency)
            print(f"\n  applied — DB: ticket-del×{len(ticket_ids)}, gsr-del×{len(gsr_to_delete)}, "
                  f"gsr-unlink×{len(gsr_to_unlink)}, ai_upload-dismiss×{len(ai_upload_ids_to_dismiss)}, "
                  f"petition_group-unlink×{len(pg_ids_to_unlink)}")
            print(f"  purged {purged}/{len(ticket_att_keys)} ticket-attachment object(s)")

    action = "deleted" if commit else "to delete"
    dismis = "dismissed" if commit else "to dismiss"
    unlnk  = "unlinked" if commit else "to unlink"
    print("\n──────── summary ────────")
    print(f"  courtesy appointments scanned              : {len(target)}")
    print(f"  appointments with linked leaks             : {touched}")
    print(f"  Tickets (workflow tracker)      — {action:<8}: {len(ticket_ids)}")
    print(f"  GSR    (petition extraction)    — {action:<8}: {len(gsr_to_delete)}")
    print(f"  GSR    (petition extraction)    — {unlnk:<8}: {len(gsr_to_unlink)}")
    print(f"  ai_uploads (petition-review)    — {dismis:<8}: {len(ai_upload_ids_to_dismiss)}")
    print(f"  petition_groups (signatory)     — {unlnk:<8}: {len(pg_ids_to_unlink)}")
    if not commit:
        print("  mode: DRY-RUN — nothing changed. Re-run with --yes to execute.")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Remove everything that leaked into a 'petition' surface off "
                    "a courtesy (greetings/invitation) record. Cleans tickets, "
                    "grievance_summary_records, ai_uploads (petition-review) and "
                    "petition_groups. The courtesy appointment and its own "
                    "attachments are preserved."
    )
    p.add_argument("--yes", action="store_true",
                   help="actually apply (default is a dry-run)")
    p.add_argument("--limit", type=int, default=None,
                   help="inspect at most N courtesy appointments (appointment_id "
                        "order); does NOT limit the ai_uploads pass — that is "
                        "identified by classifier verdict, not by appointment id.")
    p.add_argument("--concurrency", type=int, default=32,
                   help="max concurrent MinIO deletes when purging ticket "
                        "attachments (default: 32)")
    args = p.parse_args()
    asyncio.run(run(commit=args.yes, limit=args.limit, concurrency=args.concurrency))


if __name__ == "__main__":
    main()
