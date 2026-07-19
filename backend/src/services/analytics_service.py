"""
Analytics service for the single-page Minister dashboard.

One filter-aware query layer over the case spine (appointments + the latest
grievance_summary_records). Every widget and KPI respects the active filters;
for cross-filtering, each chart excludes its OWN dimension (click a category bar
and the category chart still shows all categories, while everything else rescopes).

Sources: appointments (channel via `source`), grievance_summary_records (priority,
ministry), citizens (decrypted name/mobile for the table).
"""
from __future__ import annotations

from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, func, and_, desc, distinct, case
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.utils import utc_iso
from src.models.appointment_models import Appointment, Citizen
from src.models.grievance_summary_record import GrievanceSummaryRecord as GSR
from src.models.ticket_models import Ticket, TicketStatus
from src.models.school_department import department_label
from src.services.dashboard_service import _decode
from src.models.grievance_summary import CATEGORY_DISPLAY_EN, MINISTRY_DISPLAY, DISTRICT_DISPLAY

CHANNEL_LABELS = {
    "qr_citizen":   "Citizen (QR)",
    "ai_scan":      "AI Scan",
    "manual_staff": "Staff Scan",
}

# A ticket is "resolved" for KPI purposes once the department resolves it or
# the PA closes it. Kept in sync with dashboard_service.get_stats().
_CLOSED_TICKET_STATUSES = [TicketStatus.RESOLVED.value, TicketStatus.CLOSED.value]

# SLA target in days by AI-assigned priority — mirrors get_stats()'s
# sla_targets_days so "on-time %" means the same thing across the app.
_SLA_TARGET_DAYS = {"critical": 3, "high": 7, "medium": 14, "low": 28}

# Display labels for the ticket status mix on the Ticket Insights dashboard.
# Mirrors TICKET_STATUS_DISPLAY on the frontend so both surfaces read the same.
_TICKET_STATUS_LABEL = {
    "open": "Open", "triaged": "Triaged", "assigned": "Assigned",
    "awaiting_department": "Awaiting Department", "in_progress": "In Progress",
    "forwarded_to_dept": "Forwarded to Dept", "pending_citizen": "Pending Citizen",
    "resolved": "Resolved", "closed": "Closed", "reopened": "Reopened",
}


# ── Filter model ────────────────────────────────────────────────────────────────
class Filters:
    def __init__(self, date_from=None, date_to=None, category=None, priority=None,
                 ministry=None, channel=None, status=None, district=None):
        self.date_from = _parse_dt(date_from, end=False)
        self.date_to   = _parse_dt(date_to, end=True)
        self.category = category or None
        self.priority = priority or None
        self.ministry = ministry or None
        self.channel = channel or None
        self.status = status or None
        self.district = district or None


_IST = timedelta(hours=5, minutes=30)


def _parse_dt(s: Optional[str], end: bool):
    if not s:
        return None
    try:
        d = datetime.strptime(s[:10], "%Y-%m-%d")
        # Interpret the date as IST; convert to UTC for DB comparison
        if end:
            return d + timedelta(days=1) - _IST  # IST end-of-day → UTC
        return d - _IST  # IST midnight → UTC
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
    if exclude != "priority" and f.priority: gsr.append(GSR.priority == f.priority)
    if exclude != "ministry" and f.ministry: gsr.append(GSR.ministry == f.ministry)
    if exclude != "district" and f.district: gsr.append(GSR.district == f.district)
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
            _scoped(select(func.count(Appointment.id)), f).where(Appointment.schedule_meeting == True)  # noqa: E712
        ) or 0
        meeting_persons = await db.scalar(
            _scoped(select(func.coalesce(func.sum(Appointment.num_persons), 0)), f)
            .where(Appointment.schedule_meeting == True)  # noqa: E712
        ) or 0
        awaiting = await db.scalar(
            _scoped(select(func.count(Appointment.id)), f).where(Appointment.status == "AWAITING_REVIEW")
        ) or 0

        # Growth vs previous equal-length period (only when a date range is set)
        growth_pct = await self._growth(db, f, received)

        # Case-lifecycle KPIs from the ticket table (resolution rate, avg
        # response, on-time %) — filter-aware over the same scoped appointments.
        case = await self._case_kpis(db, f)

        # Charts — each excludes its own dimension for cross-filtering
        categories = await self._group(db, f, Appointment.grievance_category, exclude="category", labels=CATEGORY_DISPLAY_EN)
        ministries = await self._group(db, f, GSR.ministry, exclude="ministry", labels=MINISTRY_DISPLAY, force_gsr=True, limit=8)
        # v2: source column removed — channels dimension returns empty for now.
        channels: List[Dict[str, Any]] = []
        priority = await self._priority(db, f)
        trend = await self._trend(db, f)

        return {
            "kpis": {
                "received": received, "citizens": citizens, "urgent": urgent,
                "meetings": meetings, "meeting_persons": meeting_persons,
                "awaiting_review": awaiting, "growth_pct": growth_pct,
                "resolution_rate": case["resolution_rate"],
                "avg_response_hours": case["avg_response_hours"],
                "on_time_pct": case["on_time_pct"],
                "resolved": case["resolved"],
            },
            "categories": categories,
            "ministries": ministries,
            "channels": channels,
            "priority": priority,
            "trend": trend,
        }

    async def _case_kpis(self, db, f: Filters) -> Dict[str, Any]:
        """Resolution rate, average response time, and on-time % from tickets.

        Tickets are 1:1 with appointments, so we scope by joining Appointment
        (for the date/category/status filters) and, when needed, GSR (for the
        priority/ministry filters and the SLA priority lookup).
        """
        def _ticket_stmt(select_expr, need_gsr: bool = False):
            stmt = (
                select(select_expr)
                .select_from(Ticket)
                .join(Appointment, Appointment.id == Ticket.appointment_id)
            )
            appt, gsr = _conditions(f)
            if gsr or need_gsr:
                stmt = stmt.join(
                    GSR,
                    and_(GSR.appointment_id == Appointment.id, GSR.is_latest == True),  # noqa: E712
                    isouter=True,
                )
            for c in appt + gsr:
                stmt = stmt.where(c)
            return stmt

        total = await db.scalar(_ticket_stmt(func.count(Ticket.id))) or 0
        resolved = await db.scalar(
            _ticket_stmt(func.count(Ticket.id)).where(Ticket.status.in_(_CLOSED_TICKET_STATUSES))
        ) or 0
        resolution_rate = round(resolved / total * 100, 1) if total else 0.0

        avg_seconds = await db.scalar(
            _ticket_stmt(func.avg(func.extract("epoch", Ticket.updated_at - Ticket.created_at)))
            .where(Ticket.status.in_(_CLOSED_TICKET_STATUSES))
        )
        avg_response_hours = round(float(avg_seconds) / 3600, 1) if avg_seconds else 0.0

        # On-time: resolved tickets whose resolution duration is within the SLA
        # target for the petition's AI priority. Fetched as (seconds, priority)
        # pairs and bucketed in Python — the resolved set is small.
        dur = func.extract(
            "epoch", func.coalesce(Ticket.resolved_at, Ticket.updated_at) - Ticket.created_at
        )
        rows = (await db.execute(
            _ticket_stmt(dur, need_gsr=True)
            .add_columns(GSR.priority)
            .where(Ticket.status.in_(_CLOSED_TICKET_STATUSES))
        )).all()
        on_time = considered = 0
        for secs, prio in rows:
            if secs is None:
                continue
            considered += 1
            target_days = _SLA_TARGET_DAYS.get(prio, 14)
            if float(secs) <= target_days * 86400:
                on_time += 1
        on_time_pct = round(on_time / considered * 100, 1) if considered else 0.0

        return {
            "resolution_rate": resolution_rate,
            "avg_response_hours": avg_response_hours,
            "on_time_pct": on_time_pct,
            "resolved": resolved,
        }

    # ── Operations panels (Phase 2) ──────────────────────────────────────────────
    async def get_operations(self, db: AsyncSession, f: Filters) -> Dict[str, Any]:
        """Department performance and district breakdown for the lower half of
        the overview dashboard. Both filter-aware over the scoped case set."""
        return {
            "departments": await self._department_performance(db, f),
            "districts":   await self._district_breakdown(db, f),
        }

    async def get_ticket_dashboard(self, db: AsyncSession, f: Filters) -> Dict[str, Any]:
        """Ticket-only view for the PA team's Ticket Insights room.

        Everything here is derived from the ticket system: live status mix, SLA
        health, priority split and per-department performance. Deliberately no
        district breakdown — that lives on the petition overview.
        """
        build = self._ticket_base(f)

        # ── Status mix (live queue shape) ────────────────────────────────────
        status_rows = (await db.execute(
            build(Ticket.status, func.count(Ticket.id)).group_by(Ticket.status)
        )).all()
        by_status = [
            {"key": s, "label": _TICKET_STATUS_LABEL.get(s, (s or "").replace("_", " ").title()),
             "count": int(n or 0)}
            for s, n in status_rows if s
        ]
        by_status.sort(key=lambda r: r["count"], reverse=True)
        total = sum(r["count"] for r in by_status)
        resolved = sum(r["count"] for r in by_status if r["key"] in _CLOSED_TICKET_STATUSES)

        # ── Priority split (AI review priority, via GSR) ─────────────────────
        prio_rows = (await db.execute(
            build(GSR.priority, func.count(Ticket.id), need_gsr=True).group_by(GSR.priority)
        )).all()
        prio_counts = {(p or "").lower(): int(n or 0) for p, n in prio_rows if p}
        by_priority = [
            {"key": k, "label": k.title(), "count": prio_counts.get(k, 0)}
            for k in ("critical", "high", "medium", "low")
        ]

        # ── SLA health on the OPEN set ───────────────────────────────────────
        # Breached = still open past its priority's target. Due soon = inside the
        # last 25% of the budget. Same targets the ticket list and drawer use, so
        # the numbers here agree with what a PA sees on a row.
        open_rows = (await db.execute(
            build(Ticket.created_at, GSR.priority, need_gsr=True)
            .where(Ticket.status.notin_(_CLOSED_TICKET_STATUSES))
        )).all()
        now = datetime.utcnow()
        breached = due_soon = on_track = 0
        for created_at, prio in open_rows:
            if not created_at:
                continue
            target_days = _SLA_TARGET_DAYS.get((prio or "").lower(), 14)
            used = (now - created_at).total_seconds() / 86400.0
            if used >= target_days:
                breached += 1
            elif used >= target_days * 0.75:
                due_soon += 1
            else:
                on_track += 1

        case_kpis = await self._case_kpis(db, f)
        open_total = breached + due_soon + on_track
        return {
            "kpis": {
                "total": total,
                "open": open_total,
                "resolved": resolved,
                "breached": breached,
                "due_soon": due_soon,
                "on_track": on_track,
                "resolution_rate": case_kpis["resolution_rate"],
                "avg_response_hours": case_kpis["avg_response_hours"],
                "on_time_pct": case_kpis["on_time_pct"],
            },
            "by_status": by_status,
            "by_priority": by_priority,
            "departments": await self._department_performance(db, f),
            "trend": await self._ticket_trend(db, f),
        }

    async def _ticket_trend(self, db, f: Filters) -> List[Dict[str, Any]]:
        """Per-day tickets raised vs resolved over the scoped window."""
        build = self._ticket_base(f)
        day = func.date(Ticket.created_at)
        raised = dict((await db.execute(
            build(day, func.count(Ticket.id)).group_by(day).order_by(day)
        )).all())
        rday = func.date(func.coalesce(Ticket.resolved_at, Ticket.updated_at))
        closed = dict((await db.execute(
            build(rday, func.count(Ticket.id))
            .where(Ticket.status.in_(_CLOSED_TICKET_STATUSES))
            .group_by(rday).order_by(rday)
        )).all())
        days = sorted({d for d in list(raised) + list(closed) if d})
        return [
            {"date": d.isoformat() if hasattr(d, "isoformat") else str(d),
             "raised": int(raised.get(d, 0) or 0),
             "resolved": int(closed.get(d, 0) or 0)}
            for d in days
        ]

    def _ticket_base(self, f: Filters):
        """A SELECT over tickets joined to their appointment, with the active
        date/category/status filters applied. Returns a builder that also joins
        GSR when a priority/ministry filter is set or `need_gsr` is requested.
        """
        def build(*select_exprs, need_gsr: bool = False):
            stmt = (
                select(*select_exprs)
                .select_from(Ticket)
                .join(Appointment, Appointment.id == Ticket.appointment_id)
            )
            appt, gsr = _conditions(f)
            if gsr or need_gsr:
                stmt = stmt.join(
                    GSR,
                    and_(GSR.appointment_id == Appointment.id, GSR.is_latest == True),  # noqa: E712
                    isouter=True,
                )
            for c in appt + gsr:
                stmt = stmt.where(c)
            return stmt
        return build

    async def _department_performance(self, db, f: Filters) -> List[Dict[str, Any]]:
        build = self._ticket_base(f)
        resolved_flag = case((Ticket.status.in_(_CLOSED_TICKET_STATUSES), 1), else_=0)

        # Per-department counts + average progress.
        counts = (await db.execute(
            build(
                Ticket.department,
                func.count(Ticket.id),
                func.sum(resolved_flag),
                func.avg(Ticket.progress_pct),
            )
            .where(Ticket.department.isnot(None))
            .group_by(Ticket.department)
        )).all()

        # Resolved-ticket durations + priority (for avg resolution time + on-time).
        dur = func.extract("epoch", func.coalesce(Ticket.resolved_at, Ticket.updated_at) - Ticket.created_at)
        resolved_rows = (await db.execute(
            build(Ticket.department, dur, GSR.priority, need_gsr=True)
            .where(Ticket.department.isnot(None))
            .where(Ticket.status.in_(_CLOSED_TICKET_STATUSES))
        )).all()

        # Acceptance responsiveness — creation → department acceptance.
        acc = func.extract("epoch", Ticket.accepted_at - Ticket.created_at)
        accept_rows = (await db.execute(
            build(Ticket.department, acc)
            .where(Ticket.department.isnot(None))
            .where(Ticket.accepted_at.isnot(None))
        )).all()

        # Fold the per-row detail into per-department accumulators.
        res_secs: Dict[str, List[float]] = {}
        on_time: Dict[str, int] = {}
        considered: Dict[str, int] = {}
        for dept, secs, prio in resolved_rows:
            if secs is None:
                continue
            res_secs.setdefault(dept, []).append(float(secs))
            considered[dept] = considered.get(dept, 0) + 1
            if float(secs) <= _SLA_TARGET_DAYS.get(prio, 14) * 86400:
                on_time[dept] = on_time.get(dept, 0) + 1

        acc_secs: Dict[str, List[float]] = {}
        for dept, secs in accept_rows:
            if secs is not None:
                acc_secs.setdefault(dept, []).append(float(secs))

        out = []
        for dept, total, resolved, avg_progress in counts:
            total = total or 0
            resolved = int(resolved or 0)
            open_count = total - resolved
            durs = res_secs.get(dept, [])
            avg_res_days = round(sum(durs) / len(durs) / 86400, 1) if durs else None
            accs = acc_secs.get(dept, [])
            avg_accept_min = round(sum(accs) / len(accs) / 60, 0) if accs else None
            cons = considered.get(dept, 0)
            out.append({
                "key": dept,
                "label": department_label(dept),
                "open": open_count,
                "resolved": resolved,
                "total": total,
                "resolution_rate": round(resolved / total * 100, 1) if total else 0.0,
                "avg_resolution_days": avg_res_days,
                "on_time_pct": round(on_time.get(dept, 0) / cons * 100, 1) if cons else None,
                "avg_accept_minutes": avg_accept_min,
                "active_load": open_count,
                "avg_progress": round(float(avg_progress), 0) if avg_progress is not None else 0,
            })
        out.sort(key=lambda d: d["total"], reverse=True)
        return out

    async def _district_breakdown(self, db, f: Filters) -> List[Dict[str, Any]]:
        stmt = _scoped(
            select(GSR.district, func.count(Appointment.id)),
            f, exclude="district", force_gsr=True,
        ).where(GSR.district.isnot(None)).group_by(GSR.district).order_by(desc(func.count(Appointment.id)))
        rows = (await db.execute(stmt)).all()
        return [
            {"key": k, "label": DISTRICT_DISPLAY.get(k, str(k).title()), "count": n}
            for k, n in rows if k
        ]


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
        """Per-day series: petitions received (by created_at) and resolved
        (tickets closed/resolved, keyed by updated_at). Returned as a single
        merged, date-sorted list so the multi-line chart can plot both.
        """
        d = func.date(Appointment.created_at)
        recv_rows = (await db.execute(
            _scoped(select(d.label("d"), func.count(Appointment.id)), f).group_by("d").order_by("d")
        )).all()
        received_by_day = {str(r[0]): r[1] for r in recv_rows}

        # Resolved-per-day over the same scope, keyed on the ticket's last
        # update (the resolve/close moment). Joins Appointment for the filters.
        rd = func.date(Ticket.updated_at)
        res_stmt = (
            select(rd.label("d"), func.count(Ticket.id))
            .select_from(Ticket)
            .join(Appointment, Appointment.id == Ticket.appointment_id)
            .where(Ticket.status.in_(_CLOSED_TICKET_STATUSES))
        )
        appt_conds, gsr_conds = _conditions(f)
        if gsr_conds:
            res_stmt = res_stmt.join(
                GSR, and_(GSR.appointment_id == Appointment.id, GSR.is_latest == True), isouter=True  # noqa: E712
            )
        for c in appt_conds + gsr_conds:
            res_stmt = res_stmt.where(c)
        res_stmt = res_stmt.group_by("d").order_by("d")
        resolved_by_day = {str(r[0]): r[1] for r in (await db.execute(res_stmt)).all()}

        all_days = sorted(set(received_by_day) | set(resolved_by_day))
        return [
            {
                "date": day,
                "received": received_by_day.get(day, 0),
                "resolved": resolved_by_day.get(day, 0),
                # Back-compat: existing UI reads `count`; keep it = received.
                "count": received_by_day.get(day, 0),
            }
            for day in all_days
        ]

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
                Appointment.schedule_meeting, Appointment.created_at,
                Citizen.encrypted_name.label("c_name"), Citizen.encrypted_mobile.label("c_mobile"),
                GSR.priority, GSR.citizen_ask,
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
                "citizen_ask": r.citizen_ask,
                "schedule_meeting": r.schedule_meeting,
                # utc_iso adds the +00:00 marker; a naive .isoformat() here
                # would be parsed as browser-local by JS Date, shifting the
                # displayed time by IST offset (+5:30) on the client.
                "created_at": utc_iso(r.created_at),
            })
        return {
            "items": items, "total": total, "page": page, "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        }


analytics_service = AnalyticsService()
