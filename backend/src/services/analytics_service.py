"""
Analytics service for the single-page Minister dashboard.

One filter-aware query layer over the case spine (appointments + the latest
grievance_summary_records). Every widget and KPI respects the active filters;
for cross-filtering, each chart excludes its OWN dimension (click a category bar
and the category chart still shows all categories, while everything else rescopes).

Sources: appointments (channel via `source`), grievance_summary_records (priority,
department), citizens (decrypted name/mobile for the table).
"""
from __future__ import annotations

from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, func, and_, desc, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.appointment_models import Appointment, Citizen
from src.models.grievance_summary_record import GrievanceSummaryRecord as GSR
from src.services.dashboard_service import _decode
from src.models.grievance_summary import CATEGORY_DISPLAY_EN, DEPARTMENT_DISPLAY

CHANNEL_LABELS = {
    "qr_citizen":   "Citizen (QR)",
    "ai_scan":      "AI Scan",
    "manual_staff": "Staff Scan",
}


# ── Filter model ────────────────────────────────────────────────────────────────
class Filters:
    def __init__(self, date_from=None, date_to=None, category=None, priority=None,
                 department=None, channel=None, status=None):
        self.date_from = _parse_dt(date_from, end=False)
        self.date_to   = _parse_dt(date_to, end=True)
        self.category = category or None
        self.priority = priority or None
        self.department = department or None
        self.channel = channel or None
        self.status = status or None


def _parse_dt(s: Optional[str], end: bool):
    if not s:
        return None
    try:
        d = datetime.strptime(s[:10], "%Y-%m-%d")
        return d.replace(hour=23, minute=59, second=59) if end else d
    except ValueError:
        return None


def _conditions(f: Filters, exclude: Optional[str] = None) -> Tuple[list, list]:
    """Return (appointment-level conditions, gsr-level conditions), skipping `exclude`."""
    appt, gsr = [], []
    if exclude != "date":
        if f.date_from: appt.append(Appointment.created_at >= f.date_from)
        if f.date_to:   appt.append(Appointment.created_at <= f.date_to)
    if exclude != "category" and f.category:   appt.append(Appointment.grievance_category == f.category)
    # v2: source column removed — channel filter is a no-op until source
    # is reintroduced (or derived from a different signal).
    if exclude != "status"   and f.status:     appt.append(Appointment.status == f.status)
    if exclude != "priority"    and f.priority:    gsr.append(GSR.priority == f.priority)
    if exclude != "department" and f.department: gsr.append(GSR.department == f.department)
    return appt, gsr


def _scoped(stmt, f: Filters, exclude: Optional[str] = None, force_gsr: bool = False):
    appt, gsr = _conditions(f, exclude)
    if gsr or force_gsr:
        stmt = stmt.join(GSR, and_(GSR.appointment_id == Appointment.id, GSR.is_latest == True), isouter=True)  # noqa: E712
    for c in appt + gsr:
        stmt = stmt.where(c)
    return stmt


class AnalyticsService:

    # ── KPIs + chart datasets ────────────────────────────────────────────────────
    async def get_analytics(self, db: AsyncSession, f: Filters) -> Dict[str, Any]:
        # KPIs (all filters applied)
        received = await db.scalar(_scoped(select(func.count(Appointment.id)), f)) or 0
        citizens = await db.scalar(_scoped(select(func.count(distinct(Appointment.citizen_id))), f)) or 0
        urgent = await db.scalar(
            _scoped(select(func.count(distinct(Appointment.id))), f, force_gsr=True)
            .where(GSR.priority.in_(["critical", "high"]))
        ) or 0
        meetings = await db.scalar(
            _scoped(select(func.count(Appointment.id)), f).where(Appointment.slot_id.isnot(None))  # noqa: E712
        ) or 0
        meeting_persons = await db.scalar(
            _scoped(select(func.coalesce(func.sum(Appointment.num_persons), 0)), f)
            .where(Appointment.slot_id.isnot(None))  # noqa: E712
        ) or 0
        awaiting = await db.scalar(
            _scoped(select(func.count(Appointment.id)), f).where(Appointment.status == "AWAITING_REVIEW")
        ) or 0

        # Growth vs previous equal-length period (only when a date range is set)
        growth_pct = await self._growth(db, f, received)

        # Charts — each excludes its own dimension for cross-filtering
        categories = await self._group(db, f, Appointment.grievance_category, exclude="category", labels=CATEGORY_DISPLAY_EN)
        departments = await self._group(db, f, GSR.department, exclude="department", labels=DEPARTMENT_DISPLAY, force_gsr=True, limit=8)
        # v2: source column removed — channels dimension returns empty for now.
        channels: List[Dict[str, Any]] = []
        priority = await self._priority(db, f)
        trend = await self._trend(db, f)

        return {
            "kpis": {
                "received": received, "citizens": citizens, "urgent": urgent,
                "meetings": meetings, "meeting_persons": meeting_persons,
                "awaiting_review": awaiting, "growth_pct": growth_pct,
            },
            "categories": categories,
            "departments": departments,
            "channels": channels,
            "priority": priority,
            "trend": trend,
        }

    async def _growth(self, db, f: Filters, received: int) -> Optional[float]:
        if not (f.date_from and f.date_to):
            return None
        span = f.date_to - f.date_from
        prev_to = f.date_from - timedelta(seconds=1)
        prev_from = prev_to - span
        pf = Filters()
        pf.__dict__.update(f.__dict__); pf.date_from = prev_from; pf.date_to = prev_to
        prev = await db.scalar(_scoped(select(func.count(Appointment.id)), pf)) or 0
        if prev == 0:
            return None
        return round((received - prev) / prev * 100, 1)

    async def _group(self, db, f: Filters, col, exclude, labels=None, force_gsr=False, limit=12):
        stmt = _scoped(select(col, func.count(Appointment.id)), f, exclude=exclude, force_gsr=force_gsr)
        stmt = stmt.group_by(col).order_by(desc(func.count(Appointment.id))).limit(limit)
        rows = (await db.execute(stmt)).all()
        out = []
        for key, n in rows:
            if key is None:
                continue
            out.append({"key": key, "label": (labels or {}).get(key, str(key).replace("_", " ").title()), "count": n})
        return out

    async def _priority(self, db, f: Filters):
        stmt = _scoped(select(GSR.priority, func.count(Appointment.id)), f, exclude="priority", force_gsr=True).group_by(GSR.priority)
        rows = {k: n for k, n in (await db.execute(stmt)).all() if k}
        return {lvl: rows.get(lvl, 0) for lvl in ("critical", "high", "medium", "low")}

    async def _trend(self, db, f: Filters):
        d = func.date(Appointment.created_at)
        stmt = _scoped(select(d.label("d"), func.count(Appointment.id)), f).group_by("d").order_by("d")
        rows = (await db.execute(stmt)).all()
        return [{"date": str(r[0]), "count": r[1]} for r in rows]

    # ── Full petitions table (paginated) ─────────────────────────────────────────
    async def get_petitions(self, db: AsyncSession, f: Filters, page: int = 1,
                            page_size: int = 50, sort: str = "created_at", direction: str = "desc") -> Dict[str, Any]:
        page = max(1, page); page_size = max(1, min(200, page_size))
        total = await db.scalar(_scoped(select(func.count(Appointment.id)), f)) or 0

        sort_col = {
            "created_at": Appointment.created_at,
            "category": Appointment.grievance_category,
            "status": Appointment.status,
            "token": Appointment.token_assigned,
        }.get(sort, Appointment.created_at)
        order = sort_col.asc() if direction == "asc" else sort_col.desc()

        # v2: encrypted_name, source, schedule_meeting columns removed on Appointment.
        # Name comes from citizen; meeting flag derived from slot_id.
        stmt = _scoped(
            select(
                Appointment.id, Appointment.token_assigned,
                Appointment.grievance_category, Appointment.status,
                Appointment.slot_id, Appointment.created_at,
                Citizen.encrypted_name.label("c_name"), Citizen.encrypted_mobile.label("c_mobile"),
                GSR.priority, GSR.headline,
            ),
            f, force_gsr=True,
        ).join(Citizen, Citizen.id == Appointment.citizen_id, isouter=True)
        stmt = stmt.order_by(order).limit(page_size).offset((page - 1) * page_size)

        rows = (await db.execute(stmt)).all()
        items = []
        for r in rows:
            name = _decode(r.c_name) if r.c_name else "—"
            mobile = _decode(r.c_mobile) if r.c_mobile else "—"
            items.append({
                "id": r.id,
                "token": f"TKN{r.token_assigned}",
                "name": name,
                "mobile": mobile,
                "category": r.grievance_category,
                "category_label": CATEGORY_DISPLAY_EN.get(r.grievance_category, (r.grievance_category or "—").replace("_", " ").title()),
                "priority": r.priority,
                "status": r.status,
                "source": None,          # v2: column removed
                "source_label": "—",     # v2: column removed
                "headline": r.headline,
                "schedule_meeting": r.slot_id is not None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        return {
            "items": items, "total": total, "page": page, "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        }


analytics_service = AnalyticsService()
