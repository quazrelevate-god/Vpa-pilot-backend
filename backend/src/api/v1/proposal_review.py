"""
Proposal Review API — super_admin only.

The Minister-level surface for the /proposal intake: list submitted proposals,
read the AI-extracted brief, and record a DECISION (approve / reject / request
clarification). A proposal is never a Ticket — this is a decision record, not a
grievance-redress workflow.

Mounted under /api/v1/admin/proposals so it rides the same same-origin proxy as
the rest of the admin surface. Every route requires role == super_admin.
"""
from __future__ import annotations

from datetime import datetime
from src.core.timeutil import now_utc
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core import crypto
from src.core.database import get_db
from src.core.rbac import require_super_admin
from src.models.login_models import Login
from src.models.proposal_models import (
    ProposalSubmission,
    STATUS_AWAITING_REVIEW, STATUS_APPROVED, STATUS_REJECTED, STATUS_NEEDS_CLARIFICATION,
    DECISION_STATUSES,
)

router = APIRouter(
    prefix="/api/v1/admin/proposals",
    tags=["Proposal Review (super_admin)"],
    dependencies=[Depends(require_super_admin)],
)

_DECISION_MAP = {
    "approved": STATUS_APPROVED,
    "rejected": STATUS_REJECTED,
    "needs_clarification": STATUS_NEEDS_CLARIFICATION,
}


# ── Response models ─────────────────────────────────────────────────────────────
class ProposalListItem(BaseModel):
    id: int
    tracking_ref: str
    category: Optional[str] = None
    org_name: Optional[str] = None
    person_name: Optional[str] = None
    designation: Optional[str] = None
    status: str
    title: Optional[str] = None
    ai_recommendation: Optional[str] = None
    estimated_cost: Optional[str] = None
    created_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    # Layer-1B dedup surfacing. `is_duplicate` drives the drawer/list pill;
    # `duplicate_of_id` + `duplicate_of_tracking_ref` power the "Duplicate of
    # NK/SCH/2026/AB12C" link so the reviewer can jump to the original.
    is_duplicate: bool = False
    duplicate_of_id: Optional[int] = None
    duplicate_of_tracking_ref: Optional[str] = None


class ProposalListResponse(BaseModel):
    items: List[ProposalListItem]
    total: int
    counts: dict


class ProposalDetail(ProposalListItem):
    email: Optional[str] = None          # decrypted (super_admin only)
    phone: Optional[str] = None          # decrypted (super_admin only)
    documents: List[dict] = Field(default_factory=list)  # [{filename, url, mime}]
    extraction: Optional[dict] = None    # full ProposalExtraction brief
    decision_note: Optional[str] = None
    error_message: Optional[str] = None


class DecisionBody(BaseModel):
    decision: str = Field(..., description="approved | rejected | needs_clarification")
    note: Optional[str] = Field(None, max_length=4000, description="Reviewer's reason / note")


class CategoryBody(BaseModel):
    category: str = Field(..., description="school | tamil | information | film")


# The four desks a proposal can sit with — mirrors _VALID_CATEGORIES on the
# public /proposal intake so the form and the review surface never disagree.
_VALID_CATEGORIES = {"school", "tamil", "information", "film"}


# ── Serialisers ─────────────────────────────────────────────────────────────────
def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _list_item(row: ProposalSubmission,
               *, dup_ref_lookup: Optional[dict] = None) -> ProposalListItem:
    ej = row.extraction_json or {}
    dup_ref = None
    if row.is_duplicate and row.duplicate_of_id and dup_ref_lookup is not None:
        dup_ref = dup_ref_lookup.get(int(row.duplicate_of_id))
    return ProposalListItem(
        id=row.id,
        tracking_ref=row.tracking_ref,
        category=row.category,
        org_name=row.org_name,
        person_name=row.person_name,
        designation=row.designation,
        status=row.status,
        title=ej.get("title") or None,
        ai_recommendation=ej.get("ai_recommendation"),
        estimated_cost=ej.get("estimated_cost"),
        created_at=_iso(row.created_at),
        reviewed_by=row.reviewed_by,
        reviewed_at=_iso(row.reviewed_at),
        is_duplicate=bool(row.is_duplicate),
        duplicate_of_id=(int(row.duplicate_of_id) if row.duplicate_of_id else None),
        duplicate_of_tracking_ref=dup_ref,
    )


async def _resolve_dup_ref(db: AsyncSession, dup_id: Optional[int]) -> Optional[str]:
    if not dup_id:
        return None
    return await db.scalar(
        select(ProposalSubmission.tracking_ref).where(ProposalSubmission.id == int(dup_id))
    )


def _detail(row: ProposalSubmission, dup_ref: Optional[str] = None) -> ProposalDetail:
    from src.services.storage_service import get_file_url
    base = _list_item(
        row,
        dup_ref_lookup=({int(row.duplicate_of_id): dup_ref} if row.duplicate_of_id and dup_ref else None),
    ).model_dump()
    docs = []
    for d in (row.documents or []):
        url = None
        try:
            url = get_file_url(d.get("storage_url", ""))
        except Exception:
            url = None
        docs.append({"filename": d.get("original_filename"), "url": url, "mime": d.get("mime_type")})
    return ProposalDetail(
        **base,
        email=crypto.decrypt(row.email_enc),
        phone=crypto.decrypt(row.phone_enc),
        documents=docs,
        extraction=row.extraction_json,
        decision_note=row.decision_note,
        error_message=row.error_message,
    )


# ── Routes ──────────────────────────────────────────────────────────────────────
@router.get("/analytics", summary="Minister proposal dashboard aggregates")
async def proposal_analytics(
    trend_days: int = Query(90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """KPIs + chart series for the Minister's Proposal dashboard.

    Declared before /{proposal_id} so the literal path wins unambiguously.
    """
    from src.services.proposal_analytics import get_proposal_analytics
    return await get_proposal_analytics(db, trend_days=trend_days)


def _apply_list_filters(
    stmt,
    *,
    status: Optional[str],
    q: Optional[str],
    category: Optional[str],
    recommendation: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
):
    """Compose the WHERE clauses that both the list query and the total
    query must share. Keeping this in one function guarantees `total`
    matches `items` — a common source of pagination bugs.
    """
    from datetime import datetime as _dt, timedelta as _td
    if status:
        stmt = stmt.where(ProposalSubmission.status == status)
    if category:
        stmt = stmt.where(ProposalSubmission.category == category)
    if recommendation:
        # ai_recommendation lives inside the JSONB brief.
        stmt = stmt.where(
            ProposalSubmission.extraction_json["ai_recommendation"].astext == recommendation
        )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            ProposalSubmission.tracking_ref.ilike(like)
            | ProposalSubmission.org_name.ilike(like)
            | ProposalSubmission.person_name.ilike(like)
            | ProposalSubmission.extraction_json["title"].astext.ilike(like)
        )
    if date_from:
        try:
            d = _dt.strptime(date_from, "%Y-%m-%d")
            stmt = stmt.where(ProposalSubmission.created_at >= d)
        except ValueError:
            pass
    if date_to:
        try:
            d = _dt.strptime(date_to, "%Y-%m-%d") + _td(days=1)
            stmt = stmt.where(ProposalSubmission.created_at < d)
        except ValueError:
            pass
    return stmt


@router.get("", response_model=ProposalListResponse, summary="List proposals")
async def list_proposals(
    status: Optional[str] = Query(None, description="Filter by a single status"),
    q: Optional[str] = Query(None, description="Search tracking ref / org / person / title"),
    category: Optional[str] = Query(None, description="Desk filter: school | tamil | information | film"),
    recommendation: Optional[str] = Query(None, description="AI triage filter: review_closely | standard | needs_more_info"),
    date_from: Optional[str] = Query(None, description="Submitted on-or-after (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Submitted on-or-before (YYYY-MM-DD, inclusive)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> ProposalListResponse:
    """Paginated list. `items` respects every filter + status + limit/offset;
    `total` is the count under those same filters (drives pagination);
    `counts` is the status marginal excluding `status` itself but INCLUDING
    every refinement filter (category / recommendation / search / date) so
    the tab pills reflect the current slice — same pattern as tickets."""
    stmt = _apply_list_filters(
        select(ProposalSubmission),
        status=status, q=q, category=category, recommendation=recommendation,
        date_from=date_from, date_to=date_to,
    )
    stmt = stmt.order_by(ProposalSubmission.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()

    # Resolve the tracking_ref of any duplicate_of_id referenced by this page,
    # in ONE query. Keeps the drawer / list free of an N+1 join.
    dup_ids = [int(r.duplicate_of_id) for r in rows if r.duplicate_of_id]
    dup_ref_lookup: dict[int, str] = {}
    if dup_ids:
        for id_, tref in (await db.execute(
            select(ProposalSubmission.id, ProposalSubmission.tracking_ref)
            .where(ProposalSubmission.id.in_(dup_ids))
        )).all():
            dup_ref_lookup[int(id_)] = tref

    total_stmt = _apply_list_filters(
        select(func.count()).select_from(ProposalSubmission),
        status=status, q=q, category=category, recommendation=recommendation,
        date_from=date_from, date_to=date_to,
    )
    total = (await db.scalar(total_stmt)) or 0

    # Tab-pill counts: same scope as total but WITHOUT the status axis
    # (that's the axis being counted across). Refinement filters (category
    # / recommendation / search / date) DO scope the counts so the pills
    # reflect "what the user would see if they clicked that tab under the
    # current refinements" — matches the ai-review distribution behaviour.
    counts_stmt = _apply_list_filters(
        select(ProposalSubmission.status, func.count()).select_from(ProposalSubmission),
        status=None,  # exclude the axis being counted across
        q=q, category=category, recommendation=recommendation,
        date_from=date_from, date_to=date_to,
    ).group_by(ProposalSubmission.status)
    counts_rows = (await db.execute(counts_stmt)).all()
    counts = {s: n for s, n in counts_rows}

    return ProposalListResponse(
        items=[_list_item(r, dup_ref_lookup=dup_ref_lookup) for r in rows],
        total=total, counts=counts,
    )


@router.get("/{proposal_id}", response_model=ProposalDetail, summary="Proposal detail + brief")
async def get_proposal(proposal_id: int, db: AsyncSession = Depends(get_db)) -> ProposalDetail:
    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    dup_ref = await _resolve_dup_ref(db, row.duplicate_of_id)
    return _detail(row, dup_ref=dup_ref)


@router.post("/{proposal_id}/decision", response_model=ProposalDetail, summary="Record a decision")
async def decide_proposal(
    proposal_id: int,
    body: DecisionBody,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
) -> ProposalDetail:
    target = _DECISION_MAP.get((body.decision or "").strip().lower())
    if target is None:
        raise HTTPException(status_code=400, detail="decision must be approved | rejected | needs_clarification.")

    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    # A decision is only meaningful once the AI brief is ready; allow re-deciding
    # between decision states, but not on a row still QUEUED/PROCESSING/FAILED.
    if row.status not in (STATUS_AWAITING_REVIEW, *DECISION_STATUSES):
        raise HTTPException(
            status_code=409,
            detail=f"Proposal is '{row.status}' — it can only be decided once its brief is ready (AWAITING_REVIEW).",
        )

    row.status = target
    row.decision_note = (body.note or "").strip() or None
    row.reviewed_by = getattr(current, "full_name", None) or getattr(current, "login_name", None) or f"login:{current.id}"
    row.reviewed_at = now_utc()
    await db.commit()
    await db.refresh(row)
    return _detail(row)


@router.patch("/{proposal_id}/category", response_model=ProposalDetail, summary="Reassign the desk (category)")
async def update_proposal_category(
    proposal_id: int,
    body: CategoryBody,
    db: AsyncSession = Depends(get_db),
    current: Login = Depends(require_super_admin),
) -> ProposalDetail:
    """Move a proposal to a different desk.

    The AI picks the desk at intake from the form; this is the human override
    for when it lands on the wrong one.

    `tracking_ref` is deliberately NOT re-minted. Its prefix encodes the desk at
    submission time (NK/SCH/…), but the citizen was given that reference — it is
    their handle on the proposal, so it stays stable for the life of the record
    even when the desk changes.
    """
    category = (body.category or "").strip().lower()
    if category not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of: {', '.join(sorted(_VALID_CATEGORIES))}.",
        )

    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")

    if row.category != category:
        row.category = category
        await db.commit()
        await db.refresh(row)
    return _detail(row)
