"""
Re-classify appointments still filed under the DEPRECATED petition categories.

Petitions can no longer live under `proposals` or `associations_unions` —
those two categories are being retired from the petition table (real proposals
and associations already have their own tables + review queues, moved out by
`migrate_proposals_from_petitions.py` and `migrate_associations_from_petitions.py`).
Anything the earlier migrations left behind is a genuine petition that was
mis-filed under the deprecated category. This script gives each such row back
to the SAME classification layer the live intake uses (document_router.route +
petition_extraction) and rewrites its category to whatever the classifier now
picks — usually 'general', 'action_required', 'transfer_requests', etc.

Two tables touched, in one transaction per row:
  • appointment.grievance_category  (id-normalised — set via the hybrid, which
                                     resolves the slug against admin lookup)
  • grievance_summary_records.category (same pattern; the live GSR is updated
                                        so dashboards / analytics agree)
Tickets are NOT touched — Ticket has no category column of its own; every
ticket derives its category through appointment_id, so it inherits the change
for free.

Row outcomes (each is logged individually so the operator sees what happened):
  RECLASSIFIED     — classifier says PETITION, gives us a fresh category, applied.
  RECLASSIFIED*    — same, but the LLM re-picked one of the deprecated categories
                     ({proposals, associations_unions}); coerced to 'general' with
                     a warning. This should be rare — the router only lands in
                     PETITION when its type-classifier disagreed with 'proposal'/
                     'association', so a category self-vote for the same slug is
                     suspect.
  STILL_PROPOSAL / STILL_ASSOCIATION
                   — the router now says this IS a proposal/association at the
                     document-type level. Nothing changed here; run the matching
                     migrate_*_from_petitions.py to move it into its own table
                     first, then re-run this script.
  COURTESY         — router classifies as courtesy (unusual for a petition
                     record). Skipped — safer than silently forcing 'general'.
  NO_DOC           — no readable DOCUMENT/IMAGE attachment (audio-only, all
                     storage keys 404, or no attachments). Nothing to classify;
                     skipped.
  ERROR            — MinIO fetch or classifier raised. Skipped, one bad row
                     does not abort the batch.

Idempotent by construction: a successfully re-classified row no longer holds a
deprecated category, so a second run silently skips it.

    cd backend
    ./env/bin/python scripts/reclassify_deprecated_categories.py                       # dry-run
    ./env/bin/python scripts/reclassify_deprecated_categories.py --commit               # write
    ./env/bin/python scripts/reclassify_deprecated_categories.py --commit --limit 20
    ./env/bin/python scripts/reclassify_deprecated_categories.py --category proposals   # only that slug
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import PurePosixPath
from typing import List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import load_only, selectinload  # noqa: E402

# Import model modules so every mapper is registered before we query.
import src.models.login_models  # noqa: E402,F401
import src.models.ticket_models  # noqa: E402,F401
import src.models.ai_upload_models  # noqa: E402,F401
import src.models.scheduling_models  # noqa: E402,F401
import src.models.activity_models  # noqa: E402,F401
import src.models.referral_models  # noqa: E402,F401
# Appointment.group_id is an FK into petition_groups; without this import the
# mapper isn't registered and SQLAlchemy's flush-time table sort raises
# NoReferencedTableError on commit — even though the script never touches the
# petition_groups table itself.
import src.models.petition_group  # noqa: E402,F401

from src.core.database import AsyncSessionLocal  # noqa: E402
from src.models.appointment_models import Appointment  # noqa: E402
from src.models.grievance_summary_record import GrievanceSummaryRecord  # noqa: E402
from src.services import storage_service  # noqa: E402
from src.services.admin_lookup import admin  # noqa: E402
from src.services.document_router import document_router  # noqa: E402


# Deprecated slugs — the whole point of the script is to move rows OUT of these.
DEPRECATED = {"proposals", "associations_unions"}
# Safe fallback if the classifier's category vote is itself a deprecated slug
# (rare, but possible — see docstring). 'general' is the intake default catch-all.
_FALLBACK_CATEGORY = "general"

# Attachment ordering: PDF first, then anything else that isn't audio. Same rule
# the migration scripts use — the classifier prefers a real document to a photo.
_SKIP_ATTACHMENT_TYPES = {"AUDIO"}


def _basename(key: str) -> str:
    return PurePosixPath(key or "").name or "document.pdf"


def _classifiable(atts) -> list:
    docs = [a for a in atts if (a.attachment_type or "").upper() not in _SKIP_ATTACHMENT_TYPES]
    docs.sort(key=lambda a: 0 if (a.mime_type or "").lower() == "application/pdf" else 1)
    return docs


async def _get_bytes(storage_url: str) -> Optional[bytes]:
    if not storage_url:
        return None
    try:
        return await asyncio.to_thread(storage_service.get_file_bytes, storage_url)
    except Exception:
        return None


async def _reclassify_one(appt: Appointment, sem: asyncio.Semaphore) -> Tuple[str, Optional[str], str]:
    """Return (outcome, new_category_or_None, log_detail).

    The semaphore caps concurrent Gemini calls — each round-trip is expensive,
    so a conservative default (see main) keeps us well inside quota.
    """
    docs = _classifiable(list(appt.attachments or []))
    if not docs:
        return "NO_DOC", None, "no classifiable attachment"

    primary = docs[0]
    raw = await _get_bytes(primary.storage_url)
    if not raw:
        return "NO_DOC", None, f"primary document unreadable: {primary.storage_url}"

    try:
        async with sem:
            routed = await asyncio.to_thread(
                document_router.route,
                file_bytes=raw,
                mime_type=(primary.mime_type or "application/pdf"),
                filename=_basename(primary.storage_url),
            )
    except Exception as exc:  # noqa: BLE001 — one bad doc must not abort the batch
        return "ERROR", None, f"classifier exception: {exc!r}"

    rtype = (routed.type or "").lower()
    if rtype == "proposal":
        return "STILL_PROPOSAL", None, (
            f"router says proposal (classified={routed.classified_type}, "
            f"confidence={routed.confidence}) — run migrate_proposals_from_petitions.py"
        )
    if rtype == "association":
        return "STILL_ASSOCIATION", None, (
            f"router says association (classified={routed.classified_type}, "
            f"confidence={routed.confidence}) — run migrate_associations_from_petitions.py"
        )
    if rtype != "petition":
        # Courtesy / anything else — safer to skip than to force 'general'.
        return "COURTESY", None, f"router says {rtype!r} (not a petition)"

    # Petition path — pull the fresh category off the extraction.
    ex = routed.extraction
    picked = None
    try:
        picked = ex.category.value if ex is not None and ex.category is not None else None
    except AttributeError:
        picked = None
    picked = (picked or "").strip().lower()
    if not picked:
        return "ERROR", None, "petition classified but extraction returned no category"

    if picked in DEPRECATED:
        # The LLM re-voted for a deprecated slug even though the router said
        # PETITION. Coerce to the fallback and flag it in the log so the
        # operator can review — the whole point of this script is to leave
        # zero rows on the deprecated slugs.
        return "RECLASSIFIED*", _FALLBACK_CATEGORY, (
            f"LLM picked deprecated '{picked}'; coerced to '{_FALLBACK_CATEGORY}'"
        )
    return "RECLASSIFIED", picked, f"→ {picked}"


async def _apply(db, appt: Appointment, new_category: str) -> None:
    """Write the new category to the appointment AND its live GSR (if any).

    Both fields are id-resolved hybrids over the admin lookup — assigning the
    slug calls the setter, which resolves it to an admin id via the cache.
    """
    appt.grievance_category = new_category
    # Latest linked GSR — the one that drives analytics + the drawer's category
    # pill. Older GSR revisions (is_latest=False) intentionally aren't touched.
    gsr = (await db.execute(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id == appt.id,
               GrievanceSummaryRecord.is_latest.is_(True))
    )).scalar_one_or_none()
    if gsr is not None:
        gsr.category = new_category


async def run(*, categories: List[str], commit: bool, limit: Optional[int],
              concurrency: int) -> None:
    sem = asyncio.Semaphore(max(1, concurrency))
    counts = {
        "RECLASSIFIED": 0, "RECLASSIFIED*": 0,
        "STILL_PROPOSAL": 0, "STILL_ASSOCIATION": 0,
        "COURTESY": 0, "NO_DOC": 0, "ERROR": 0,
    }

    async with AsyncSessionLocal() as db:
        # The hybrid setter/reader depend on the admin cache being warm. Load
        # it before any category assignment fires.
        await admin.load(db)

        # load_only(id, category_id) so the SELECT lists only those two columns
        # + the PK. Deferred columns (source_kind, document_date, file_hash on
        # other tables, etc.) are never touched by this script, so an older DB
        # missing them stays out of trouble. The grievance_category hybrid
        # resolves purely from category_id via the admin cache (no extra query),
        # and the setter at write time only touches category_id too.
        stmt = (
            select(Appointment)
            .where(Appointment.grievance_category.in_(categories))
            .options(
                load_only(Appointment.id, Appointment.category_id),
                selectinload(Appointment.attachments),
            )
            .order_by(Appointment.id)
        )
        appts = (await db.execute(stmt)).scalars().all()

        target = appts if limit is None else appts[:limit]
        print(f"[scan] {len(appts)} candidate(s) in {sorted(categories)}; "
              f"processing {len(target)}; mode={'COMMIT' if commit else 'DRY-RUN'}; "
              f"concurrency={concurrency}\n")

        # Fan out classifier calls. The router already has its own global
        # concurrency permit, so the semaphore here is a script-level ceiling.
        results = await asyncio.gather(*(_reclassify_one(a, sem) for a in target))

        for appt, (outcome, new_cat, detail) in zip(target, results):
            counts[outcome] = counts.get(outcome, 0) + 1
            src_cat = (appt.grievance_category or "—")
            print(f"  appt {appt.id}: {outcome:<18} src={src_cat:<20} {detail}")

            if commit and outcome in ("RECLASSIFIED", "RECLASSIFIED*") and new_cat:
                await _apply(db, appt, new_cat)

        if commit:
            await db.commit()

    print("\n──────── summary ────────")
    total = sum(counts.values())
    print(f"  processed                : {total}")
    for k in ("RECLASSIFIED", "RECLASSIFIED*", "STILL_PROPOSAL", "STILL_ASSOCIATION",
              "COURTESY", "NO_DOC", "ERROR"):
        print(f"  {k:<20}: {counts[k]}")
    if not commit:
        print("  mode: DRY-RUN — nothing written. Re-run with --commit to apply.")
    if counts["STILL_PROPOSAL"] or counts["STILL_ASSOCIATION"]:
        print("  → some rows re-classify as proposal/association at the router level. "
              "Run the matching migrate_*_from_petitions.py to move them into their "
              "own tables first, then re-run this script to clear the rest.")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Re-classify appointments filed under the deprecated 'proposals' / "
                    "'associations_unions' categories via the live classification layer."
    )
    p.add_argument(
        "--category",
        choices=("proposals", "associations_unions", "both"),
        default="both",
        help="Which deprecated slug to process (default: both).",
    )
    p.add_argument("--commit", action="store_true",
                   help="actually write the new categories (default is a dry-run)")
    p.add_argument("--limit", type=int, default=None,
                   help="process at most N candidates (in appointment_id order)")
    p.add_argument("--concurrency", type=int, default=4,
                   help="max concurrent classifier calls (default: 4 — Gemini is expensive)")
    args = p.parse_args()

    categories = list(DEPRECATED) if args.category == "both" else [args.category]
    asyncio.run(run(
        categories=categories, commit=args.commit,
        limit=args.limit, concurrency=args.concurrency,
    ))


if __name__ == "__main__":
    main()
