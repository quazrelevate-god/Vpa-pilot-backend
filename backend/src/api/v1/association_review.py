"""
Association / Union Review API — super_admin only.

Lists association submissions (routed from scans by the classifier), shows the
grievance summary + association identity + collective ask, and records a review
decision (reviewed / forwarded to the concerned department). Never a Ticket.

Mounted under /api/v1/admin/associations. Every route requires super_admin.
"""
from __future__ import annotations

from datetime import datetime
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
    document_date: Optional[str] = None
    status: str
    created_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None


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


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _list_item(r: AssociationSubmission) -> AssociationListItem:
    return AssociationListItem(
        id=r.id, association_name=r.association_name, representative_name=r.representative_name,
        representative_designation=r.representative_designation, member_count=r.member_count,
        category=r.category, ministry=r.ministry, urgency=r.urgency, document_date=r.document_date,
        status=r.status, created_at=_iso(r.created_at), reviewed_by=r.reviewed_by, reviewed_at=_iso(r.reviewed_at),
    )


def _detail(r: AssociationSubmission) -> AssociationDetail:
    from src.services.storage_service import get_file_url
    docs = []
    for d in (r.documents or []):
        try:
            url = get_file_url(d.get("storage_url", ""))
        except Exception:
            url = None
        docs.append({"filename": d.get("original_filename"), "url": url, "mime": d.get("mime_type")})
    base = _list_item(r).model_dump()
    return AssociationDetail(**base, district=r.district, documents=docs,
                             extraction=r.extraction_json, decision_note=r.decision_note, source=r.source)


@router.get("", response_model=AssociationListResponse, summary="List association submissions")
async def list_associations(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> AssociationListResponse:
    stmt = select(AssociationSubmission)
    if status:
        stmt = stmt.where(AssociationSubmission.status == status)
    stmt = stmt.order_by(AssociationSubmission.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()

    total_stmt = select(func.count()).select_from(AssociationSubmission)
    if status:
        total_stmt = total_stmt.where(AssociationSubmission.status == status)
    total = (await db.scalar(total_stmt)) or 0

    counts_rows = (await db.execute(
        select(AssociationSubmission.status, func.count()).group_by(AssociationSubmission.status)
    )).all()
    counts = {s: n for s, n in counts_rows}
    return AssociationListResponse(items=[_list_item(r) for r in rows], total=total, counts=counts)


@router.get("/{assoc_id}", response_model=AssociationDetail, summary="Association detail")
async def get_association(assoc_id: int, db: AsyncSession = Depends(get_db)) -> AssociationDetail:
    row = await db.get(AssociationSubmission, assoc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Association submission not found.")
    return _detail(row)


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
    row.status = target
    row.decision_note = (body.note or "").strip() or None
    row.reviewed_by = getattr(current, "full_name", None) or getattr(current, "login_name", None) or f"login:{current.id}"
    row.reviewed_at = datetime.utcnow()
    await db.commit()
    await db.refresh(row)
    return _detail(row)
