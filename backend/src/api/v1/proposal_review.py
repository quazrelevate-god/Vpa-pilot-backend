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


# ── Serialisers ─────────────────────────────────────────────────────────────────
def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _list_item(row: ProposalSubmission) -> ProposalListItem:
    ej = row.extraction_json or {}
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
    )


def _detail(row: ProposalSubmission) -> ProposalDetail:
    from src.services.storage_service import get_file_url
    base = _list_item(row).model_dump()
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


@router.get("", response_model=ProposalListResponse, summary="List proposals")
async def list_proposals(
    status: Optional[str] = Query(None, description="Filter by a single status"),
    q: Optional[str] = Query(None, description="Search tracking ref / org / person / title"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> ProposalListResponse:
    stmt = select(ProposalSubmission)
    if status:
        stmt = stmt.where(ProposalSubmission.status == status)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            ProposalSubmission.tracking_ref.ilike(like)
            | ProposalSubmission.org_name.ilike(like)
            | ProposalSubmission.person_name.ilike(like)
            | ProposalSubmission.extraction_json["title"].astext.ilike(like)
        )
    stmt = stmt.order_by(ProposalSubmission.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()

    total_stmt = select(func.count()).select_from(ProposalSubmission)
    if status:
        total_stmt = total_stmt.where(ProposalSubmission.status == status)
    total = (await db.scalar(total_stmt)) or 0

    counts_rows = (await db.execute(
        select(ProposalSubmission.status, func.count()).group_by(ProposalSubmission.status)
    )).all()
    counts = {s: n for s, n in counts_rows}

    return ProposalListResponse(items=[_list_item(r) for r in rows], total=total, counts=counts)


@router.get("/{proposal_id}", response_model=ProposalDetail, summary="Proposal detail + brief")
async def get_proposal(proposal_id: int, db: AsyncSession = Depends(get_db)) -> ProposalDetail:
    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    return _detail(row)


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
