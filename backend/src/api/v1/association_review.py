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
    document_date: Optional[str] = None
    status: str
    association_ask: Optional[str] = None       # the collective ask (one-liner for the drill list)
    association_ask_ta: Optional[str] = None
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
    ej = r.extraction_json or {}
    return AssociationListItem(
        id=r.id, association_name=r.association_name, representative_name=r.representative_name,
        representative_designation=r.representative_designation, member_count=r.member_count,
        category=r.category, ministry=r.ministry, urgency=r.urgency, document_date=r.document_date,
        status=r.status,
        association_ask=ej.get("association_ask") or None,
        association_ask_ta=ej.get("association_ask_ta") or None,
        created_at=_iso(r.created_at), reviewed_by=r.reviewed_by, reviewed_at=_iso(r.reviewed_at),
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


@router.get("", response_model=AssociationListResponse, summary="List association submissions")
async def list_associations(
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search association / representative name"),
    name: Optional[str] = Query(None, description="Exact association_name — the drill-in for one body"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> AssociationListResponse:
    stmt = select(AssociationSubmission)
    if status:
        stmt = stmt.where(AssociationSubmission.status == status)
    if name is not None:
        # Drill-in from a grouped card: all submissions of one body. Case- and
        # whitespace-insensitive so it matches the group key. "" = unnamed bodies.
        nm = name.strip()
        if nm:
            stmt = stmt.where(func.lower(func.trim(AssociationSubmission.association_name)) == nm.lower())
        else:
            stmt = stmt.where(
                (AssociationSubmission.association_name.is_(None))
                | (func.trim(AssociationSubmission.association_name) == "")
            )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            AssociationSubmission.association_name.ilike(like)
            | AssociationSubmission.representative_name.ilike(like)
        )

    # Total over the SAME filters (status + name + q), BEFORE pagination, so it
    # matches what a drill-in / search actually returns — not the whole table.
    total = (await db.scalar(
        select(func.count()).select_from(stmt.subquery())
    )) or 0

    # Then page the rows.
    stmt = stmt.order_by(AssociationSubmission.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()

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
    row.reviewed_at = now_utc()
    await db.commit()
    await db.refresh(row)
    return _detail(row)
