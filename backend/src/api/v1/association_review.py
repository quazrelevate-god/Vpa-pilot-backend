"""
Association / Union Review API — super_admin only.

Lists association submissions (routed from scans by the classifier), shows the
grievance summary + association identity + collective ask, and records a review
decision (reviewed / forwarded to the concerned department). Never a Ticket.

Mounted under /api/v1/admin/associations. Every route requires super_admin.
"""
from __future__ import annotations

from datetime import datetime
from src.core.timeutil import now_utc
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.rbac import require_super_admin
from src.models.login_models import Login
from src.models.association_models import (
    AssociationSubmission, STATUS_REVIEWED, STATUS_FORWARDED, STATUS_AWAITING_REVIEW,
)

router = APIRouter(
    prefix="/api/v1/admin/associations",
    tags=["Association Review (super_admin)"],
    dependencies=[Depends(require_super_admin)],
)

_DECISION_MAP = {"reviewed": STATUS_REVIEWED, "forwarded": STATUS_FORWARDED}


class AssociationListItem(BaseModel):
    id: int
    association_name: Optional[str] = None
    representative_name: Optional[str] = None
    representative_designation: Optional[str] = None
    member_count: Optional[str] = None
    category: Optional[str] = None
    ministry: Optional[str] = None
    urgency: Optional[str] = None
    district: Optional[str] = None              # v2 — filterable by constituency on the list
    document_date: Optional[str] = None
    status: str
    association_ask: Optional[str] = None       # the collective ask (one-liner for the drill list)
    association_ask_ta: Optional[str] = None
    # v2 — surfaced on the list so the row can show a triage badge without a
    # separate detail fetch. Pulled from extraction_json; None on pre-v2 rows.
    ai_recommendation: Optional[str] = None
    created_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    # Layer-1B soft-flag surfacing — drives the drawer/list duplicate pill.
    is_duplicate: bool = False
    duplicate_of_id: Optional[int] = None
    duplicate_of_name: Optional[str] = None   # association_name of the earlier row


class AssociationListResponse(BaseModel):
    items: List[AssociationListItem]
    total: int
    counts: dict


class AssociationDetail(AssociationListItem):
    district: Optional[str] = None
    documents: List[dict] = Field(default_factory=list)
    extraction: Optional[dict] = None
    decision_note: Optional[str] = None
    source: Optional[str] = None


class DecisionBody(BaseModel):
    decision: str = Field(..., description="reviewed | forwarded")
    note: Optional[str] = Field(None, max_length=4000)


class NoteBody(BaseModel):
    note: str = Field(..., max_length=4000,
                      description="New decision-note text. Empty string clears the note.")


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _list_item(r: AssociationSubmission,
               *, dup_name_lookup: Optional[dict] = None) -> AssociationListItem:
    ej = r.extraction_json or {}
    dup_name = None
    if r.is_duplicate and r.duplicate_of_id and dup_name_lookup is not None:
        dup_name = dup_name_lookup.get(int(r.duplicate_of_id))
    return AssociationListItem(
        id=r.id, association_name=r.association_name, representative_name=r.representative_name,
        representative_designation=r.representative_designation, member_count=r.member_count,
        category=r.category, ministry=r.ministry, urgency=r.urgency, district=r.district,
        document_date=r.document_date,
        status=r.status,
        association_ask=ej.get("association_ask") or None,
        association_ask_ta=ej.get("association_ask_ta") or None,
        ai_recommendation=ej.get("ai_recommendation") or None,
        created_at=_iso(r.created_at), reviewed_by=r.reviewed_by, reviewed_at=_iso(r.reviewed_at),
        is_duplicate=bool(r.is_duplicate),
        duplicate_of_id=(int(r.duplicate_of_id) if r.duplicate_of_id else None),
        duplicate_of_name=dup_name,
    )


def _detail(r: AssociationSubmission, dup_name: Optional[str] = None) -> AssociationDetail:
    from src.services.storage_service import get_file_url
    docs = []
    for d in (r.documents or []):
        try:
            url = get_file_url(d.get("storage_url", ""))
        except Exception:
            url = None
        docs.append({"filename": d.get("original_filename"), "url": url, "mime": d.get("mime_type")})
    dup_lookup = {int(r.duplicate_of_id): dup_name} if (r.duplicate_of_id and dup_name) else None
    base = _list_item(r, dup_name_lookup=dup_lookup).model_dump()
    # AssociationDetail already declares `district`; base carries the value now,
    # so drop it from base to avoid the duplicate-keyword TypeError.
    base.pop("district", None)
    return AssociationDetail(**base, district=r.district, documents=docs,
                             extraction=r.extraction_json, decision_note=r.decision_note, source=r.source)


@router.get("/analytics", summary="Minister association dashboard aggregates")
async def association_analytics(
    trend_days: int = Query(90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """KPIs + chart series for the Minister's Association dashboard.

    Declared before /{assoc_id} so the literal path wins unambiguously.
    """
    from src.services.association_analytics import get_association_analytics
    return await get_association_analytics(db, trend_days=trend_days)


@router.get("/grouped", summary="Associations grouped by body (for the review list)")
async def list_associations_grouped(
    q: Optional[str] = Query(None, description="Search association / representative name"),
    status: Optional[str] = Query(None, description="Only groups that have a submission in this status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """One card per association BODY, not per submission.

    The same union files many things over time; the reviewer wants to pick the
    body first, then drill into its stack of submissions. This groups rows by
    (normalised) association_name and returns a per-body summary + the member
    reach, its category spread, latest activity, and a pending count — paginated
    for the 800-in-prod case. The drill-in uses GET "" with ?name=.
    """
    from src.services.association_analytics import parse_members

    rows = (await db.execute(
        select(AssociationSubmission).order_by(AssociationSubmission.created_at.desc())
    )).scalars().all()

    # Per-submission status counts (for the tab badges) — over ALL rows.
    status_counts: dict = {}
    for r in rows:
        status_counts[r.status] = status_counts.get(r.status, 0) + 1

    ql = (q or "").strip().lower()
    groups: dict = {}
    for r in rows:
        name = (r.association_name or "").strip()
        key = name.lower() or f"__unnamed__{r.id}"   # unnamed bodies never merge
        if ql and ql not in name.lower() and ql not in (r.representative_name or "").lower():
            continue
        g = groups.get(key)
        if g is None:
            g = groups[key] = {
                "key": key,
                "association_name": name or "Unnamed body",
                "count": 0, "awaiting": 0, "reviewed": 0, "forwarded": 0,
                "members": 0, "member_count_raw": r.member_count,
                "categories": set(), "districts": set(),
                "latest_created_at": None, "latest_urgency": None,
                "representative_name": r.representative_name,
                "ids": [],
            }
        g["count"] += 1
        g["ids"].append(r.id)
        if r.status == STATUS_AWAITING_REVIEW: g["awaiting"] += 1
        elif r.status == STATUS_REVIEWED:      g["reviewed"] += 1
        elif r.status == STATUS_FORWARDED:     g["forwarded"] += 1
        g["members"] = max(g["members"], parse_members(r.member_count))  # peak stated size
        if r.category: g["categories"].add(r.category)
        if r.district and r.district.lower() != "unknown": g["districts"].add(r.district)
        if g["latest_created_at"] is None:   # rows are date-desc, so first seen = latest
            g["latest_created_at"] = _iso(r.created_at)
            g["latest_urgency"] = r.urgency

    items = list(groups.values())
    if status:
        # keep bodies that have at least one submission in the requested status
        skey = {"AWAITING_REVIEW": "awaiting", "REVIEWED": "reviewed", "FORWARDED": "forwarded"}.get(status)
        if skey:
            items = [g for g in items if g[skey] > 0]

    # Sort: bodies with pending work first, then by most recent, then by reach.
    items.sort(key=lambda g: (g["awaiting"] > 0, g["latest_created_at"] or "", g["members"]), reverse=True)

    total_groups = len(items)
    start = (page - 1) * page_size
    page_items = items[start:start + page_size]
    for g in page_items:
        g["categories"] = sorted(g["categories"])
        g["districts"] = sorted(g["districts"])

    return {
        "groups": page_items,
        "total_groups": total_groups,
        "page": page, "page_size": page_size,
        "has_more": start + page_size < total_groups,
        "counts": status_counts,
    }


def _apply_assoc_filters(
    stmt,
    *,
    status: Optional[str],
    q: Optional[str],
    name: Optional[str],
    category: Optional[str],
    urgency: Optional[str],
    district: Optional[str],
    ministry: Optional[str],
    recommendation: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
    batch_id: Optional[str] = None,
):
    """Shared WHERE builder — the list, total and counts queries all pass
    through here so `total` matches `items` and pill counts stay in sync
    with the currently-visible slice.
    """
    from datetime import datetime as _dt, timedelta as _td
    if status:
        stmt = stmt.where(AssociationSubmission.status == status)
    if batch_id:
        # Deep-link from the AI Uploads batch card: show only the associations
        # the classifier routed from this specific batch. Linkage lives on
        # ai_uploads.routed_ref_id (points at the association id) with
        # status=ROUTED and routed_to='association'.
        from src.models.ai_upload_models import AiUpload, STATUS_ROUTED
        stmt = stmt.where(AssociationSubmission.id.in_(
            select(AiUpload.routed_ref_id)
            .where(AiUpload.batch_id == batch_id)
            .where(AiUpload.routed_to == "association")
            .where(AiUpload.status == STATUS_ROUTED)
            .where(AiUpload.routed_ref_id.isnot(None))
        ))
    if name is not None:
        nm = name.strip()
        if nm:
            stmt = stmt.where(func.lower(func.trim(AssociationSubmission.association_name)) == nm.lower())
        else:
            stmt = stmt.where(
                (AssociationSubmission.association_name.is_(None))
                | (func.trim(AssociationSubmission.association_name) == "")
            )
    if category:
        stmt = stmt.where(AssociationSubmission.category == category)
    if urgency:
        stmt = stmt.where(AssociationSubmission.urgency == urgency)
    if district:
        stmt = stmt.where(AssociationSubmission.district == district)
    if ministry:
        stmt = stmt.where(AssociationSubmission.ministry == ministry)
    if recommendation:
        # ai_recommendation lives inside the JSONB extraction brief.
        stmt = stmt.where(
            AssociationSubmission.extraction_json["ai_recommendation"].astext == recommendation
        )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            AssociationSubmission.association_name.ilike(like)
            | AssociationSubmission.representative_name.ilike(like)
        )
    if date_from:
        try:
            d = _dt.strptime(date_from, "%Y-%m-%d")
            stmt = stmt.where(AssociationSubmission.created_at >= d)
        except ValueError:
            pass
    if date_to:
        try:
            d = _dt.strptime(date_to, "%Y-%m-%d") + _td(days=1)
            stmt = stmt.where(AssociationSubmission.created_at < d)
        except ValueError:
            pass
    return stmt


@router.get("", response_model=AssociationListResponse, summary="List association submissions")
async def list_associations(
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search association / representative name"),
    name: Optional[str] = Query(None, description="Exact association_name — the drill-in for one body"),
    category: Optional[str] = Query(None, description="Grievance category filter"),
    urgency: Optional[str] = Query(None, description="Urgency filter"),
    district: Optional[str] = Query(None, description="District filter"),
    ministry: Optional[str] = Query(None, description="Ministry filter"),
    recommendation: Optional[str] = Query(None, description="AI triage filter"),
    date_from: Optional[str] = Query(None, description="Submitted on-or-after (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Submitted on-or-before (YYYY-MM-DD, inclusive)"),
    batch_id: Optional[str] = Query(None, description="Scope to associations routed from this AI-upload batch"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> AssociationListResponse:
    """Paginated list. Same-pattern as proposal-review:
    - `items` respects every filter + status + limit/offset
    - `total` matches those filters (drives pagination)
    - `counts` is the status marginal excluding `status` itself but INCLUDING
      every refinement (category / urgency / district / ministry / rec /
      search / date) so pills reflect the current slice.
    """
    filter_kwargs = dict(
        q=q, name=name, category=category, urgency=urgency, district=district,
        ministry=ministry, recommendation=recommendation,
        date_from=date_from, date_to=date_to, batch_id=batch_id,
    )
    stmt = _apply_assoc_filters(select(AssociationSubmission), status=status, **filter_kwargs)

    total = (await db.scalar(
        select(func.count()).select_from(stmt.subquery())
    )) or 0

    # id.desc() as final tie-break — bulk uploads share created_at down to
    # the microsecond and non-deterministic order across pages would let a
    # reviewer miss / repeat rows while paginating.
    stmt = (
        stmt.order_by(AssociationSubmission.created_at.desc(), AssociationSubmission.id.desc())
            .limit(limit).offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()

    # One extra query to resolve duplicate_of_id -> association_name for the
    # drawer/list pill. Keeps the frontend clean of an N+1 join.
    dup_ids = [int(r.duplicate_of_id) for r in rows if r.duplicate_of_id]
    dup_name_lookup: dict[int, str] = {}
    if dup_ids:
        for id_, nm in (await db.execute(
            select(AssociationSubmission.id, AssociationSubmission.association_name)
            .where(AssociationSubmission.id.in_(dup_ids))
        )).all():
            dup_name_lookup[int(id_)] = nm

    counts_stmt = _apply_assoc_filters(
        select(AssociationSubmission.status, func.count()).select_from(AssociationSubmission),
        status=None, **filter_kwargs,
    ).group_by(AssociationSubmission.status)
    counts_rows = (await db.execute(counts_stmt)).all()
    counts = {s: n for s, n in counts_rows}
    return AssociationListResponse(
        items=[_list_item(r, dup_name_lookup=dup_name_lookup) for r in rows],
        total=total, counts=counts,
    )


@router.get("/{assoc_id}", response_model=AssociationDetail, summary="Association detail")
async def get_association(assoc_id: int, db: AsyncSession = Depends(get_db)) -> AssociationDetail:
    row = await db.get(AssociationSubmission, assoc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Association submission not found.")
    dup_name = None
    if row.duplicate_of_id:
        dup_name = await db.scalar(
            select(AssociationSubmission.association_name)
            .where(AssociationSubmission.id == int(row.duplicate_of_id))
        )
    return _detail(row, dup_name=dup_name)


@router.get("/{assoc_id}/similar", summary="Reviewer-triggered fuzzy dedup — Layer 2")
async def get_similar_associations(
    assoc_id: int,
    limit: int = Query(10, ge=1, le=25),
    min_score: float = Query(0.50, ge=0.10, le=1.0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Returns candidate similar associations for the reviewer to visually
    confirm. Blocks by category + district; scores by trigram Jaccard on
    the collective ask. Read-only — the PA decides."""
    from src.services.association_service import find_similar_associations
    return await find_similar_associations(db, assoc_id, limit=limit, min_score=min_score)


@router.post("/{assoc_id}/decision", response_model=AssociationDetail, summary="Record a review decision")
async def decide_association(
    assoc_id: int,
    body: DecisionBody,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
) -> AssociationDetail:
    target = _DECISION_MAP.get((body.decision or "").strip().lower())
    if target is None:
        raise HTTPException(status_code=400, detail="decision must be reviewed | forwarded.")
    row = await db.get(AssociationSubmission, assoc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Association submission not found.")
    # Guard the no-op self-transition (REVIEWED → REVIEWED etc.). Without
    # this, a stray click on an already-decided row re-runs the mint
    # (idempotent by source_appointment_id today, but the stale-pointer
    # path in association_service can silently null the pointer and spawn
    # a second ticket) AND overwrites reviewed_by / reviewed_at / note
    # with the current call's values. Cross-decision transitions
    # (REVIEWED ↔ FORWARDED) stay allowed by design.
    if row.status == target:
        raise HTTPException(
            status_code=409,
            detail=f"Association is already '{target}' — nothing to change.",
        )

    reviewer = (
        getattr(current, "full_name", None)
        or getattr(current, "login_name", None)
        or f"login:{current.id}"
    )

    # Mint the shadow Citizen + Appointment + Ticket the first time the
    # association is decided (reviewed OR forwarded) — same downstream
    # pipeline as an approved citizen petition. Idempotent on the association
    # row's `source_appointment_id`, so toggling reviewed ↔ forwarded later
    # never creates duplicate tickets.
    from src.services.association_service import association_service
    try:
        await association_service.mint_ticket_from_association(
            assoc=row, reviewed_by=reviewer, db=db,
        )
    except ValueError as exc:
        # Missing identity fields — surface a 400 the reviewer can act on.
        raise HTTPException(status_code=400, detail=str(exc))

    # Reload after the mint (which commits internally to spawn the ticket).
    row = await db.get(AssociationSubmission, assoc_id)
    row.status = target
    # Preserve the previous decision_note if the caller didn't send one.
    # Only overwrite when the body explicitly carried a `note` field so a
    # re-decision without a note doesn't wipe the reason from the prior
    # decision (partial audit history until we add a proper event log).
    if body.note is not None:
        row.decision_note = body.note.strip() or None
    row.reviewed_by = reviewer
    row.reviewed_at = now_utc()
    await db.commit()
    await db.refresh(row)
    return _detail(row)


@router.patch("/{assoc_id}/note", response_model=AssociationDetail, summary="Update the decision note only")
async def update_association_note(
    assoc_id: int,
    body: NoteBody,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
) -> AssociationDetail:
    """Edit the decision_note on an already-decided association WITHOUT
    flipping status. Mirrors the proposal-side /note endpoint — used by
    the reviewer to amend the note without the drive-by effects of
    /decision (which re-runs the ticket mint and re-stamps reviewed_by).

    Only decided rows are eligible — updating a note on AWAITING_REVIEW
    would be recorded against a decision the reviewer never made.
    reviewed_by stays unchanged; reviewed_at is bumped so the timeline
    can order the note update in-place.
    """
    row = await db.get(AssociationSubmission, assoc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Association submission not found.")
    if row.status not in (STATUS_REVIEWED, STATUS_FORWARDED):
        raise HTTPException(
            status_code=409,
            detail=f"Association is '{row.status}' — a note can only be updated on a decided row.",
        )
    row.decision_note = body.note.strip() or None
    row.reviewed_at = now_utc()
    await db.commit()
    await db.refresh(row)
    return _detail(row)
