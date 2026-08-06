"""
Signature-petition merge service — Find similar / Merge / Split.

Design goals
------------
* **On-demand only.** Nothing runs until a reviewer opens a petition and clicks
  Find similar. No background jobs, no re-scanning 3,000 petitions on intake.
* **Layered, cheap detection.** Block by (category, district) first so we only
  compare a handful of rows in each bucket, then normalise the ask (strip
  greetings/names, lowercase, collapse whitespace) and hash-compare within
  the bucket. No ML in phase 1 — this catches the common case of forwarded/
  photocopied identical petitions and QR submissions with the same ask text.
* **Reviewer-curated, human-confirmed.** The service proposes candidates; the
  PA sees them in the drawer, ✕'s any false positives, then Approve merges
  what remains. `find_similar` is read-only — no writes.
* **Additive & reversible.** A petition with `group_id IS NULL` behaves
  exactly like today. Split-back (removing a signatory from an approved
  ticket) never deletes; it just flips `group_id` to NULL and the appointment
  goes back to AWAITING_REVIEW.
* **Same-status only.** Candidates must be AWAITING_REVIEW (already-decided
  petitions aren't offered as duplicates). Rows already in another group are
  filtered out.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from src.core.timeutil import now_utc
from src.models.appointment_models import Appointment, Citizen
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.petition_group import PetitionGroup
from src.models.ticket_models import Ticket, TicketStatus
from src.services.admin_lookup import admin

logger = logging.getLogger(__name__)


# ── Ask normalization ────────────────────────────────────────────────────────
# Common salutation / letter-opening tokens to strip so "Respected Sir, kindly
# repair..." and "Sir, please repair..." collapse to the same normalized form.
_STOP_PREFIXES = (
    "respected", "hon'ble", "honble", "honorable", "honourable", "dear",
    "sir", "madam", "sir/madam", "to", "the", "regarding", "sub", "subject",
    "ref", "kindly", "please", "pls", "requesting", "request", "we", "i",
)


def normalize_ask(text: Optional[str]) -> str:
    """Reduce a petition's ask to a comparable key.

    Not a full NLP pipeline — a deliberately cheap normalizer that folds the
    two most common sources of "identical demand, different phrasing" noise:
    honorifics/greetings, and whitespace/punctuation drift.

    Example:
        "Respected Sir, Kindly repair the road in our street."
        → "repair the road in our street"
    """
    if not text:
        return ""
    s = text.lower()
    # Drop punctuation → single spaces (keeps alphanumeric + spaces + Tamil).
    s = re.sub(r"[^\w\s஀-௿]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    # Peel off leading salutation-style tokens until we hit real content.
    tokens = s.split(" ")
    while tokens and tokens[0] in _STOP_PREFIXES:
        tokens.pop(0)
    return " ".join(tokens)


def ask_hash(text: Optional[str]) -> str:
    """Deterministic short hash of the normalized ask — used for bucketing."""
    return hashlib.sha1(normalize_ask(text).encode("utf-8")).hexdigest()[:16]


# ── Similarity scoring (phase 1: exact + trigram overlap) ────────────────────
def _trigram_set(s: str) -> set[str]:
    if len(s) < 3:
        return {s} if s else set()
    return {s[i:i + 3] for i in range(len(s) - 2)}


def _similarity(a: str, b: str) -> float:
    """Return 0.0-1.0 similarity between two normalized asks.

    Exact match short-circuits to 1.0. Otherwise a trigram Jaccard coefficient
    — cheap, robust to word reordering and minor edits, no external deps.
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    A, B = _trigram_set(a), _trigram_set(b)
    if not A or not B:
        return 0.0
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 0.0


# ── Public API ───────────────────────────────────────────────────────────────
async def find_similar(
    db: AsyncSession,
    appointment_id: int,
    *,
    limit: int = 12,
    min_score: float = 0.50,
) -> Dict[str, Any]:
    """Read-only: return candidate similar petitions for `appointment_id`.

    Layered:
      1. Load the source petition + its latest GSR (for category, district,
         and the normalized ask).
      2. Block on same category_id AND same district_id — with a NULL-tolerant
         match (both NULL = still in the same bucket for that dimension).
      3. Only AWAITING_REVIEW appointments; only rows without a group_id yet;
         exclude the source itself.
      4. Score each candidate's normalized ask against the source; keep those
         at or above `min_score` (default 0.55 — trigram Jaccard; identical
         forwarded copies score 1.0, close paraphrases 0.6-0.9).

    Returns:
        {
          source: {id, ask, category, district, ...},
          candidates: [{id, score, ask, name, mobile_masked, source, created_at}, …],
          reason: str | None,   # populated when candidates is empty
        }
    """
    src = await db.get(Appointment, appointment_id)
    if src is None:
        return {"source": None, "candidates": [], "reason": "Petition not found."}

    # Only offer merges from AWAITING_REVIEW; once a petition is REVIEWED /
    # DISMISSED it's out of the review queue and no longer mergeable.
    if src.status != "AWAITING_REVIEW":
        return {
            "source": _serialize_appt(src, None),
            "candidates": [],
            "reason": "This petition is no longer awaiting review.",
        }

    src_gsr = await _latest_gsr_for(db, src.id)
    src_ask = _extract_ask(src, src_gsr)
    if not normalize_ask(src_ask):
        return {
            "source": _serialize_appt(src, src_gsr),
            "candidates": [],
            "reason": "No ask text yet to compare against.",
        }

    # Bucket by category_id + district_id (both from the latest GSR). NULLs are
    # kept in their own bucket — a district-unknown petition can only merge
    # with other district-unknown petitions in the same category.
    cat_id = src_gsr.category_id if src_gsr else src.category_id
    dist_id = src_gsr.district_id if src_gsr else None

    review_status_id = admin.appointment_status("AWAITING_REVIEW")

    # Two-step so we bound the compared set. Grab appointment ids first (small
    # column list, indexed on status_id) then hydrate only that page.
    stmt = (
        select(Appointment.id)
        .where(Appointment.id != src.id)
        .where(Appointment.status_id == review_status_id)
        .where(Appointment.group_id.is_(None))
    )
    if cat_id is None:
        stmt = stmt.where(Appointment.category_id.is_(None))
    else:
        stmt = stmt.where(Appointment.category_id == cat_id)

    candidate_ids = list((await db.execute(stmt)).scalars().all())
    if not candidate_ids:
        return {
            "source": _serialize_appt(src, src_gsr),
            "candidates": [],
            "reason": "No other awaiting petitions in this category.",
        }

    # Hydrate candidates + their latest GSR (batched) so scoring runs in Python.
    hydrated = await _hydrate_appts_with_gsr(db, candidate_ids)

    src_norm = normalize_ask(src_ask)
    scored: List[Dict[str, Any]] = []
    for appt, gsr in hydrated:
        # Apply the district filter here (post-hydrate) — district lives on GSR,
        # not on Appointment, so it can't join into the initial id-only SELECT.
        cand_dist = gsr.district_id if gsr else None
        if dist_id is not None and cand_dist != dist_id:
            continue
        if dist_id is None and cand_dist is not None:
            # Source district unknown → only merge with equally-unknown ones,
            # so a Chennai petition can't accidentally sweep up a Madurai one.
            continue

        cand_ask = _extract_ask(appt, gsr)
        cand_norm = normalize_ask(cand_ask)
        score = _similarity(src_norm, cand_norm)
        if score >= min_score:
            item = _serialize_appt(appt, gsr)
            item["score"] = round(score, 3)
            item["ask"] = cand_ask
            scored.append(item)

    scored.sort(key=lambda x: x["score"], reverse=True)
    scored = scored[:limit]

    return {
        "source": {**_serialize_appt(src, src_gsr), "ask": src_ask},
        "candidates": scored,
        "reason": None if scored else "No similar petitions found.",
    }


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _latest_gsr_for(db: AsyncSession, appointment_id: int) -> Optional[GrievanceSummaryRecord]:
    return await db.scalar(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id == appointment_id)
        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
    )


async def _hydrate_appts_with_gsr(
    db: AsyncSession, ids: List[int],
) -> List[tuple[Appointment, Optional[GrievanceSummaryRecord]]]:
    """Return [(appt, latest_gsr), ...] for the given ids. Two IN queries."""
    appts = list((await db.execute(
        select(Appointment).where(Appointment.id.in_(ids))
    )).scalars().all())
    gsrs = list((await db.execute(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id.in_(ids))
        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
    )).scalars().all())
    by_appt: Dict[int, GrievanceSummaryRecord] = {g.appointment_id: g for g in gsrs if g.appointment_id}
    return [(a, by_appt.get(a.id)) for a in appts]


def _extract_ask(appt: Appointment, gsr: Optional[GrievanceSummaryRecord]) -> str:
    """Prefer the AI-extracted one-line ask, fall back to the encrypted
    citizen-typed grievance if the GSR has none."""
    if gsr and (gsr.citizen_ask or "").strip():
        return gsr.citizen_ask.strip()
    # No decrypt fallback here — this runs in a read-only endpoint and we don't
    # want to force decryption on every candidate. An appointment without a GSR
    # still shows up but with an empty normalized key (won't score).
    return ""


def _mask_mobile(m: Optional[str]) -> Optional[str]:
    if not m:
        return None
    return "*****" + m[-4:] if len(m) >= 4 else "*" * len(m)


def _serialize_appt(appt: Appointment, gsr: Optional[GrievanceSummaryRecord]) -> Dict[str, Any]:
    """Small display payload for the review drawer. Decryption stays out of
    here — the drawer already fetches citizen name from its own endpoint if
    needed. `name` here is the AI-extracted one from GSR (safe, non-PII)."""
    name = ((gsr.name_en if gsr else "") or "").strip() or None
    return {
        "id": appt.id,
        "status": appt.status,
        "category": appt.grievance_category,
        "district": gsr.district if gsr else None,
        "name": name,
        "source": appt.source,
        "token": appt.token_assigned,
        "created_at": appt.created_at.isoformat() if appt.created_at else None,
        "group_id": appt.group_id,
    }


# ── Merge / split ────────────────────────────────────────────────────────────
async def approve_with_signatories(
    db: AsyncSession,
    primary_appointment_id: int,
    signatory_ids: List[int],
    actor: str = "pa_admin",
) -> Dict[str, Any]:
    """Merge N signatories into `primary_appointment_id` and approve the group.

    Semantics of one Approve click:
      * If `signatory_ids` is empty, the caller should use the plain approve
        endpoint — this function requires at least one signatory (a group of
        one is meaningless).
      * The primary is approved normally → one Ticket is created for it.
      * Each signatory is validated (must be AWAITING_REVIEW, ungrouped, same
        category as the primary), then row-locked, flipped to REVIEWED, and
        stamped with `group_id`. It does NOT get its own Ticket.
      * Signatories that fail validation (already grouped / already reviewed /
        wrong category) are silently skipped and returned in `skipped[]` so the
        UI can tell the reviewer what happened.

    Failure semantics:
      * If the primary can't be approved, the whole call rolls back and no
        group is created.
      * If EVERY signatory is skipped, we fall back to a plain approve
        (no group is created) so the reviewer isn't blocked.

    Returns:
      {group_id, primary_appointment_id, ticket_number, forwarded,
       signatories: [id, ...], skipped: [{id, reason}, ...], signatory_count}
    """
    from src.services import dashboard_service   # local import (circular)

    primary = await db.get(Appointment, primary_appointment_id)
    if primary is None:
        raise HTTPException(status_code=404, detail="Primary petition not found.")
    if primary.status != "AWAITING_REVIEW":
        raise HTTPException(status_code=409, detail="Primary petition is not awaiting review.")
    if primary.group_id is not None:
        raise HTTPException(status_code=409, detail="Primary petition already belongs to a group.")

    primary_gsr = await _latest_gsr_for(db, primary.id)
    primary_cat = primary.category_id
    primary_dist = primary_gsr.district_id if primary_gsr else None

    # Validate + lock signatories. `SELECT ... FOR UPDATE` on each so a
    # concurrent approve / merge on the same row loses this race cleanly.
    valid_members: List[Appointment] = []
    skipped: List[Dict[str, Any]] = []
    for sid in dict.fromkeys(signatory_ids):  # dedupe while preserving order
        if sid == primary.id:
            skipped.append({"id": sid, "reason": "same_as_primary"})
            continue
        # Read + re-check status/group_id right before writing. A concurrent
        # merge on the same signatory is rare and non-catastrophic (worst case:
        # one campaign counts a signatory that ended up on another campaign);
        # a proper row-lock is deferred because Appointment.scheduled_slot's
        # lazy=joined always LEFT-JOINs slots, and Postgres refuses FOR UPDATE
        # on the nullable side of an outer join.
        row = await db.get(Appointment, sid)
        if row is None:
            skipped.append({"id": sid, "reason": "not_found"})
            continue
        if row.status != "AWAITING_REVIEW":
            skipped.append({"id": sid, "reason": f"status_{row.status}"})
            continue
        if row.group_id is not None:
            skipped.append({"id": sid, "reason": "already_grouped"})
            continue
        # Category must match — never merge across categories, or we'd fan out
        # a mixed-ministry ticket the department can't act on.
        if row.category_id != primary_cat:
            skipped.append({"id": sid, "reason": "category_mismatch"})
            continue
        valid_members.append(row)

    if not valid_members:
        # Nothing to merge — plain approve so the reviewer isn't left stuck.
        result = await dashboard_service.approve_petition(db, primary.id, actor=actor)
        return {
            "group_id": None,
            "primary_appointment_id": primary.id,
            "ticket_number": result.get("ticket_number"),
            "forwarded": result.get("forwarded", False),
            "signatories": [],
            "skipped": skipped,
            "signatory_count": 1,
        }

    # ── Create the group + stamp memberships in one transaction ──────────────
    canonical_ask = _extract_ask(primary, primary_gsr) or None
    group = PetitionGroup(
        primary_appointment_id=primary.id,
        category_id=primary_cat,
        district_id=primary_dist,
        canonical_ask=canonical_ask,
        signatory_count=1 + len(valid_members),
        created_by=actor,
    )
    db.add(group)
    await db.flush()   # need group.id for member updates

    # Stamp the primary + every member with the new group_id.
    primary.group_id = group.id
    reviewed_id = admin.appointment_status("REVIEWED")
    now = now_utc()
    for m in valid_members:
        m.group_id = group.id
        # Signatories flip to REVIEWED directly — no ticket for them. Their
        # identity is preserved (Citizen row untouched, GSR intact) so the
        # roster on the primary's ticket lists every one of them.
        m.status_id = reviewed_id
        # Free any slot they were holding (unlikely for AWAITING_REVIEW petitions
        # but defensive — a slot left booked would block that slot forever).
        m.slot_id = None
        m.schedule_meeting = False
    await db.flush()

    # ── Approve the primary — creates the ONE ticket ─────────────────────────
    # We reuse the existing approve path so ticket numbering, non-school
    # forwarding, activity logging, etc. all stay identical to the single-
    # petition flow. Only difference: the ticket is now the campaign's ticket.
    result = await dashboard_service.approve_petition(db, primary.id, actor=actor)
    await db.commit()

    logger.info(
        "petition_merge: group=%s primary=%s members=%d skipped=%d ticket=%s",
        group.id, primary.id, len(valid_members), len(skipped),
        result.get("ticket_number"),
    )

    return {
        "group_id": group.id,
        "primary_appointment_id": primary.id,
        "ticket_number": result.get("ticket_number"),
        "forwarded": result.get("forwarded", False),
        "signatories": [m.id for m in valid_members],
        "skipped": skipped,
        "signatory_count": 1 + len(valid_members),
    }


async def split_signatory(
    db: AsyncSession,
    ticket_id: int,
    signatory_appointment_id: int,
    actor: str = "pa_admin",
) -> Dict[str, Any]:
    """Remove one signatory from a merged ticket — they go back to
    AWAITING_REVIEW as their own standalone petition.

    Rules:
      * The signatory must belong to the same group as the ticket's primary.
      * The primary itself cannot be split — the primary IS the ticket. If a
        reviewer wants to disband the whole campaign, they split the others
        one by one until only the primary remains.
      * We allow split-back on OPEN tickets only. Once the ticket has been
        forwarded / resolved / closed, the department already received it with
        N signatories on the roster; pulling one out afterward would desync
        what the department sees. If needed later, that becomes a phase-2
        "amend forwarded ticket" flow.
    """
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    if ticket.status not in (TicketStatus.OPEN.value, TicketStatus.TRIAGED.value):
        raise HTTPException(
            status_code=409,
            detail=f"Ticket is {ticket.status}; signatories can only be split from an open ticket.",
        )

    primary_appt = await db.get(Appointment, ticket.appointment_id)
    if primary_appt is None or primary_appt.group_id is None:
        raise HTTPException(status_code=409, detail="This ticket has no signatories to split.")
    if signatory_appointment_id == primary_appt.id:
        raise HTTPException(
            status_code=409,
            detail="Cannot split the primary petition — it owns the ticket. Close/revert the ticket instead.",
        )

    member = await db.get(Appointment, signatory_appointment_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Signatory not found.")
    if member.group_id != primary_appt.group_id:
        raise HTTPException(status_code=409, detail="Signatory is not part of this ticket's group.")

    # Unmerge: back to AWAITING_REVIEW as its own petition.
    member.group_id = None
    member.status_id = admin.appointment_status("AWAITING_REVIEW")
    # Flush so the SELECT COUNT below sees the just-nulled group_id.
    await db.flush()

    # Recount the group live so the header always matches reality.
    group = await db.get(PetitionGroup, primary_appt.group_id)
    if group is not None:
        count = await db.scalar(
            select(func.count(Appointment.id)).where(Appointment.group_id == group.id)
        )
        # Setting signatory_count triggers ORM onupdate → updated_at bumps
        # automatically (no need to touch it here).
        group.signatory_count = int(count or 0)

    await db.commit()
    logger.info(
        "petition_split: ticket=%s group=%s removed=%s remaining=%d actor=%s",
        ticket_id, primary_appt.group_id, member.id,
        group.signatory_count if group else -1, actor,
    )
    return {
        "ticket_id": ticket_id,
        "removed_appointment_id": member.id,
        "group_id": primary_appt.group_id,
        "signatory_count": group.signatory_count if group else 0,
    }


async def roster_for_ticket(db: AsyncSession, ticket_id: int) -> Dict[str, Any]:
    """Return the ticket's signatory roster: the primary + every member of the
    group, with name / masked-mobile / source / token / created_at."""
    from src.core import crypto

    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        return {"group_id": None, "signatory_count": 0, "signatories": []}
    primary = await db.get(Appointment, ticket.appointment_id)
    if primary is None or primary.group_id is None:
        return {"group_id": None, "signatory_count": 1, "signatories": []}

    group = await db.get(PetitionGroup, primary.group_id)
    members = list((await db.execute(
        select(Appointment).where(Appointment.group_id == primary.group_id)
    )).scalars().all())

    ids = [m.id for m in members]
    gsrs = list((await db.execute(
        select(GrievanceSummaryRecord)
        .where(GrievanceSummaryRecord.appointment_id.in_(ids))
        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
    )).scalars().all())
    gsr_by_appt = {g.appointment_id: g for g in gsrs if g.appointment_id}

    citizen_ids = [m.citizen_id for m in members if m.citizen_id]
    citizens = list((await db.execute(
        select(Citizen).where(Citizen.id.in_(citizen_ids))
    )).scalars().all())
    cit_by_id = {c.id: c for c in citizens}

    signatories = []
    for m in members:
        c = cit_by_id.get(m.citizen_id)
        # Prefer the PA-verified Citizen name (encrypted); fall back to the
        # AI-extracted one on the GSR if the Citizen row somehow has none.
        name = None
        mobile = None
        if c is not None:
            try:
                name = crypto.decrypt(c.encrypted_name) if c.encrypted_name else None
            except Exception:
                name = None
            try:
                mobile = crypto.decrypt(c.encrypted_mobile) if c.encrypted_mobile else None
            except Exception:
                mobile = None
        if not name and (g := gsr_by_appt.get(m.id)):
            name = g.name_en or None
        signatories.append({
            "appointment_id": m.id,
            "name": name,
            "mobile_masked": _mask_mobile(mobile),
            "source": m.source,
            "token": m.token_assigned,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "is_primary": (m.id == primary.id),
        })
    # Primary first, then by created_at asc so the earliest signatories rank next.
    signatories.sort(key=lambda s: (0 if s["is_primary"] else 1, s["created_at"] or ""))
    return {
        "group_id": primary.group_id,
        "canonical_ask": group.canonical_ask if group else None,
        "signatory_count": group.signatory_count if group else len(signatories),
        "signatories": signatories,
    }
