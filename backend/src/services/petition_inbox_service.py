"""
Unified petition-review inbox — combines AI-scan uploads and citizen-submitted
petitions (appointments) into a single server-paginated list + tab counts.

Why this exists
---------------
The AI Review page's tab count and pagination total came from two DIFFERENT
sources:
  - Tab count = server-side full COUNT of matching rows.
  - Pagination total = client-side length of the merged in-memory list, but the
    uploads feed was capped at 500 rows before merging. Past 500 uploads the
    two numbers diverged (e.g. tab said 2901, pagination said 1285).

Fixing this in the browser is impossible: the client can't know the true total
without asking the server for it. The correct answer is a single server query
that walks both tables (`ai_uploads` + `appointments`), sorts, counts, and
pages — everything the frontend used to try to do itself, done once against
the database.

Design
------
- Two SELECTs (one per table) fetch matching (id, created_at, priority_rank)
  triples. Both filter sets already exist elsewhere; the upload side reuses
  `AiUploadService._apply_common_filters`, the petition side inlines the
  appointment predicates (they're small and already scattered across
  `get_appointments` — duplicating the handful used here keeps the two
  services decoupled and avoids pulling in `dashboard_service`'s much larger
  filter surface for scheduling / meeting-date etc. that don't apply here).
- Combine in Python, sort by the requested key, slice for pagination, then
  hydrate ONLY the paginated slice — two IN queries, one per table.
- Petitions with `source == 'ai_scan'` are excluded: they're the appointment
  row that a converted AI upload produces, and would double-count otherwise.
- Petition status maps to the upload-native StatusKey enum via a SQL CASE
  (REVIEWED → REVIEWED, DISMISSED → DISMISSED, everything else → AWAITING_REVIEW).

Search on encrypted petition name/mobile follows the established
`ticket_service.get_ticket_counts` pattern: SQL prefilters the un-searchable
predicates, then decrypt-and-bucket in Python. Bounded because petitions are
the smaller feed and only search-bearing requests pay this cost.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.ai_upload_models import (
    AiUpload,
    STATUS_DISMISSED,
    STATUS_FAILED,
    STATUS_PROCESSING,
    STATUS_QUEUED,
    STATUS_REVIEWED,
)
from src.models.appointment_models import Appointment, Citizen
from src.models.grievance_summary_record import GrievanceSummaryRecord
from src.models.scheduling_models import AppointmentSlot
from src.services import dashboard_service
from src.services.ai_upload_service import ai_upload_service


# ── StatusKey constants (mirror the frontend StatusKey union) ─────────────
# Kept as literals so the CASE expressions below read as data, not names.
_SK_AWAITING = "AWAITING_REVIEW"
_SK_REVIEWED = "REVIEWED"
_SK_FAILED   = "FAILED"
_SK_DISMISSED = "DISMISSED"

# The four tab keys the review page shows. QUEUED / PROCESSING are deliberately
# excluded — they're in-flight and belong to the upload-batches panel.
_VISIBLE_STATUS_KEYS = (_SK_AWAITING, _SK_REVIEWED, _SK_FAILED, _SK_DISMISSED)

# Petition-side mapping. Appointment.status is a richer enum, but from the
# review page's POV a petition is either explicitly dismissed, explicitly
# reviewed, or awaiting review. FAILED is upload-only (extraction failure) —
# petitions can never be FAILED, so counts_by_status for petitions always has
# FAILED=0.
_PETITION_STATUS_CASE = case(
    (Appointment.status == "REVIEWED",  _SK_REVIEWED),
    (Appointment.status == "DISMISSED", _SK_DISMISSED),
    else_=_SK_AWAITING,
)

# Priority rank identical to the upload-side one, so cross-table sort matches.
# Wrapped in a *scalar subquery* below (`_pet_priority_rank_subq`), not applied
# via a JOIN, so a petition with (a bug-produced) duplicate is_latest GSR row
# can't multiply into two match rows and inflate the pagination total.
def _pet_priority_rank_subq():
    inner_case = case(
        (GrievanceSummaryRecord.priority == "critical", 4),
        (GrievanceSummaryRecord.priority == "high",     3),
        (GrievanceSummaryRecord.priority == "medium",   2),
        (GrievanceSummaryRecord.priority == "low",      1),
        else_=0,
    )
    return (
        select(inner_case)
        .where(GrievanceSummaryRecord.appointment_id == Appointment.id)
        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
        .correlate(Appointment)
        .limit(1)
        .scalar_subquery()
        .label("priority_rank")
    )


class PetitionInboxService:

    # ─── PUBLIC API ───────────────────────────────────────────────────────

    async def list_inbox(
        self,
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = 25,
        status: Optional[str] = None,
        q: Optional[str] = None,
        category: Optional[str] = None,
        priority: Optional[str] = None,
        source: Optional[str] = None,
        batch_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        sort: str = "submitted_desc",
    ) -> Dict[str, Any]:
        """Return one merged page of inbox rows plus a *true* total.

        `items` is a list of dicts each tagged with `_kind` = "upload" or
        "petition"; upload rows carry the same fields as the existing
        `_row_to_dict_light` payload, petition rows carry the same fields as
        `build_appointment_row`. The frontend keeps its dual-shape handling
        and just no longer has to merge or slice.
        """
        page = max(1, page)
        page_size = max(1, min(page_size, 200))

        # Fetch match-triples (id, created_at, priority_rank) from each table.
        upload_matches = await self._upload_matches(
            db, status=status, q=q, category=category, priority=priority,
            source=source, batch_id=batch_id, from_date=from_date, to_date=to_date,
        )
        petition_matches = await self._petition_matches(
            db, status=status, q=q, category=category, priority=priority,
            source=source, batch_id=batch_id, from_date=from_date, to_date=to_date,
        )

        combined: List[Tuple[str, int, Any, int]] = [
            ("upload",   uid, ts, pr) for (uid, ts, pr) in upload_matches
        ] + [
            ("petition", pid, ts, pr) for (pid, ts, pr) in petition_matches
        ]
        # Belt-and-braces: dedupe by (kind, id). The petition side is already
        # JOIN-free (scalar subquery for priority rank; IN-subqueries for GSR
        # filters), so duplicates shouldn't reach here — but if a future edit
        # ever reintroduces a many-side join, the pagination total and page
        # order stay honest instead of silently inflating.
        _seen: set = set()
        _uniq: List[Tuple[str, int, Any, int]] = []
        for row in combined:
            key = (row[0], row[1])
            if key not in _seen:
                _seen.add(key)
                _uniq.append(row)
        combined = _uniq
        total = len(combined)

        combined.sort(key=self._sort_key(sort))

        offset = (page - 1) * page_size
        window = combined[offset:offset + page_size]

        # Hydrate ONLY the sliced window — two IN queries, one per kind.
        upload_ids   = [r[1] for r in window if r[0] == "upload"]
        petition_ids = [r[1] for r in window if r[0] == "petition"]
        upload_rows   = await self._hydrate_uploads(db, upload_ids)   if upload_ids   else {}
        petition_rows = await self._hydrate_petitions(db, petition_ids) if petition_ids else {}

        items: List[Dict[str, Any]] = []
        for kind, rid, _ts, _pr in window:
            if kind == "upload" and rid in upload_rows:
                items.append({"_kind": "upload",   **upload_rows[rid]})
            elif kind == "petition" and rid in petition_rows:
                items.append({"_kind": "petition", **petition_rows[rid]})
            # A row deleted between the match query and the hydrate is silently
            # dropped from the page — not worth retrying; the next page load
            # will reflect reality.

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": (offset + len(items)) < total,
        }

    async def facets(
        self,
        db: AsyncSession,
        *,
        status: Optional[str] = None,
        q: Optional[str] = None,
        category: Optional[str] = None,
        priority: Optional[str] = None,
        source: Optional[str] = None,
        batch_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Tab counts + category distribution across BOTH tables.

        The two axes have deliberately different filter scopes:
          - `counts_by_status`: ALL filters EXCEPT status. Each tab shows the
            count the user would see if they clicked it — a "would-be" count.
          - `distribution`: ALL filters INCLUDING status. The chart reflects
            the currently-visible tab, so its total equals that tab's count.
            When status is unset (All tab) every row contributes.

        Both marginals come from a single GROUP BY (status_key, category)
        query per table, so this is 2 SQL round-trips total — a big win over
        the client bulk-fetching every petition and aggregating in JS.
        """
        counts: Dict[str, int] = {"": 0}
        for k in _VISIBLE_STATUS_KEYS:
            counts[k] = 0
        dist: Dict[str, int] = {}
        status_focus = (status or "").upper() or None

        cat_focus = (category or "").lower() or None

        def _absorb(sk: Optional[str], cat: Optional[str], n: int) -> None:
            cat_key = (cat or "other").lower()
            if sk in counts:
                if cat_focus is None or cat_key == cat_focus:
                    counts[sk] += n
                    counts[""] += n
            if status_focus is None or sk == status_focus:
                dist[cat_key] = dist.get(cat_key, 0) + n

        # ── UPLOADS ────────────────────────────────────────────────────────
        upload_case = case(
            (AiUpload.status == STATUS_REVIEWED,  _SK_REVIEWED),
            (AiUpload.status == STATUS_DISMISSED, _SK_DISMISSED),
            (AiUpload.status == STATUS_FAILED,    _SK_FAILED),
            else_=_SK_AWAITING,
        )
        u_stmt = select(
            upload_case.label("sk"),
            AiUpload.grievance_category.label("cat"),
            func.count(AiUpload.id).label("n"),
        )
        u_stmt = ai_upload_service._apply_common_filters(
            u_stmt, status=None, q=q, category=None, priority=priority,
            source=source, batch_id=batch_id, from_date=from_date, to_date=to_date,
        )
        u_stmt = u_stmt.where(AiUpload.status.notin_([STATUS_QUEUED, STATUS_PROCESSING]))
        u_stmt = u_stmt.group_by("sk", "cat")
        for sk, cat, n in (await db.execute(u_stmt)).all():
            _absorb(sk, cat, int(n))

        # ── PETITIONS ──────────────────────────────────────────────────────
        # Batch filter is upload-only; petitions carry no batch_id.
        if not batch_id:
            needs_search = bool(q and q.strip())
            if not needs_search:
                p_stmt = (
                    select(
                        _PETITION_STATUS_CASE.label("sk"),
                        Appointment.grievance_category.label("cat"),
                        func.count(Appointment.id).label("n"),
                    )
                    .select_from(Appointment)
                    # Mirror the list-branch filters so counts/pagination agree.
                    .where(Appointment.schedule_meeting == False)  # noqa: E712
                    .where(Appointment.source != "ai_scan")
                )
                if source:
                    p_stmt = p_stmt.where(Appointment.source == source)
                if from_date:
                    p_stmt = p_stmt.where(Appointment.created_at >= dashboard_service._ist_start(from_date))
                if to_date:
                    p_stmt = p_stmt.where(Appointment.created_at < dashboard_service._ist_end(to_date))
                if priority:
                    gsr_sub = (
                        select(GrievanceSummaryRecord.appointment_id)
                        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
                        .where(GrievanceSummaryRecord.priority == priority)
                    )
                    p_stmt = p_stmt.where(Appointment.id.in_(gsr_sub))
                p_stmt = p_stmt.group_by("sk", "cat")
                for sk, cat, n in (await db.execute(p_stmt)).all():
                    _absorb(sk, cat, int(n))
            else:
                # Search branch: decrypt-and-bucket, then group in Python. Costs
                # more but matches the list branch's search semantics exactly
                # so counts and the paginated slice stay in sync under search.
                needle = q.strip().lower()
                s_stmt = (
                    select(
                        _PETITION_STATUS_CASE.label("sk"),
                        Appointment.grievance_category.label("cat"),
                        Citizen.encrypted_name, Citizen.encrypted_mobile,
                        Appointment.token_assigned, Appointment.encrypted_grievance,
                    )
                    .select_from(Appointment)
                    .outerjoin(Citizen, Citizen.id == Appointment.citizen_id)
                    .where(Appointment.schedule_meeting == False)  # noqa: E712
                    .where(Appointment.source != "ai_scan")
                )
                if source:
                    s_stmt = s_stmt.where(Appointment.source == source)
                if from_date:
                    s_stmt = s_stmt.where(Appointment.created_at >= dashboard_service._ist_start(from_date))
                if to_date:
                    s_stmt = s_stmt.where(Appointment.created_at < dashboard_service._ist_end(to_date))
                if priority:
                    gsr_sub = (
                        select(GrievanceSummaryRecord.appointment_id)
                        .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
                        .where(GrievanceSummaryRecord.priority == priority)
                    )
                    s_stmt = s_stmt.where(Appointment.id.in_(gsr_sub))
                for r in (await db.execute(s_stmt)).all():
                    name  = dashboard_service._decode(r.encrypted_name)      if r.encrypted_name else ""
                    mob   = dashboard_service._decode(r.encrypted_mobile)    if r.encrypted_mobile else ""
                    grv   = dashboard_service._decode(r.encrypted_grievance) if r.encrypted_grievance else ""
                    token = f"TKN{r.token_assigned}" if r.token_assigned else ""
                    hay = " ".join((name, mob, grv, token)).lower()
                    if needle in hay:
                        _absorb(r.sk, r.cat, 1)

        distribution = sorted(
            [{"key": k, "count": v} for k, v in dist.items() if v > 0],
            key=lambda r: r["count"], reverse=True,
        )
        return {"counts_by_status": counts, "distribution": distribution}

    # ─── UPLOADS SIDE ─────────────────────────────────────────────────────

    async def _upload_matches(
        self, db: AsyncSession, *,
        status, q, category, priority, source, batch_id, from_date, to_date,
        include_status_col: bool = False,
    ):
        """Return match triples/quads from `ai_uploads` under the current
        filters. Excludes QUEUED / PROCESSING (in-flight rows are not part of
        the review inbox — same rule as `list_uploads`).
        """
        status_key_case = case(
            (AiUpload.status == STATUS_REVIEWED, _SK_REVIEWED),
            (AiUpload.status == STATUS_DISMISSED, _SK_DISMISSED),
            (AiUpload.status == STATUS_FAILED, _SK_FAILED),
            else_=_SK_AWAITING,
        )
        cols = [AiUpload.id, AiUpload.created_at, self._upload_priority_rank()]
        if include_status_col:
            cols.append(status_key_case)
        stmt = select(*cols)
        stmt = ai_upload_service._apply_common_filters(
            stmt, status=status, q=q, category=category, priority=priority,
            source=source, batch_id=batch_id, from_date=from_date, to_date=to_date,
        )
        if not status:
            stmt = stmt.where(AiUpload.status.notin_([STATUS_QUEUED, STATUS_PROCESSING]))
        rows = (await db.execute(stmt)).all()
        return [tuple(r) for r in rows]

    @staticmethod
    def _upload_priority_rank():
        # Reuse the private classvar from AiUploadService so the ranking stays
        # in one place — if that ordering ever changes there, this side follows.
        return ai_upload_service._PRIORITY_RANK_CASE

    async def _hydrate_uploads(self, db: AsyncSession, ids: List[int]) -> Dict[int, Dict[str, Any]]:
        stmt = select(AiUpload).where(AiUpload.id.in_(ids))
        rows = (await db.execute(stmt)).scalars().all()
        return {r.id: ai_upload_service._row_to_dict_light(r) for r in rows}

    # ─── PETITIONS SIDE ───────────────────────────────────────────────────

    async def _petition_matches(
        self, db: AsyncSession, *,
        status, q, category, priority, source, batch_id, from_date, to_date,
        include_status_col: bool = False,
    ):
        """Return match triples/quads from `appointments` under the current
        filters. Batch filter is upload-only — if it's set, no petitions match.
        Search touches encrypted citizen columns and needs decrypt-and-bucket.
        """
        # A batch filter is inherently upload-only; petitions have no batch_id.
        if batch_id:
            return []

        needs_search = bool(q and q.strip())

        # Build the query WITHOUT a JOIN. Priority rank comes from a scalar
        # subquery; priority / category filters use IN-subqueries. Guarantees
        # exactly one row per appointment even if the is_latest invariant is
        # broken — an OUTER JOIN here previously double-counted such petitions
        # and made the pagination total overshoot the tab count.
        cols: List[Any] = [Appointment.id, Appointment.created_at, _pet_priority_rank_subq()]
        if include_status_col:
            cols.append(_PETITION_STATUS_CASE)
        stmt = select(*cols).select_from(Appointment)

        # Two must-match filters that mirror the frontend's bulk petition fetch
        # (`fetchAppointments({kind:"petition", …})` + a post-fetch source
        # filter). Without them the server counts meeting-request appointments
        # and ai_scan-derived rows that the tab-count/chart never include, and
        # the pagination total balloons past the tab number (e.g. 300 vs 133).
        # kind="petition" -> schedule_meeting=False.
        stmt = stmt.where(Appointment.schedule_meeting == False)  # noqa: E712
        stmt = stmt.where(Appointment.source != "ai_scan")

        if status:
            key = status.upper()
            if key == _SK_FAILED:
                # Petitions have no FAILED status — the filter matches nothing
                # rather than returning everything. Short-circuit.
                return []
            elif key == _SK_REVIEWED:
                stmt = stmt.where(Appointment.status == "REVIEWED")
            elif key == _SK_DISMISSED:
                stmt = stmt.where(Appointment.status == "DISMISSED")
            elif key == _SK_AWAITING:
                stmt = stmt.where(Appointment.status.notin_(["REVIEWED", "DISMISSED"]))
            else:
                # Unknown key: match nothing rather than silently returning all.
                return []

        if source:
            stmt = stmt.where(Appointment.source == source)
        if from_date:
            stmt = stmt.where(Appointment.created_at >= dashboard_service._ist_start(from_date))
        if to_date:
            stmt = stmt.where(Appointment.created_at < dashboard_service._ist_end(to_date))
        if priority:
            gsr_priority_sub = (
                select(GrievanceSummaryRecord.appointment_id)
                .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
                .where(GrievanceSummaryRecord.priority == priority)
            )
            stmt = stmt.where(Appointment.id.in_(gsr_priority_sub))
        if category:
            # Match either the AI-classified category (GSR) or the citizen's
            # form-selected one on the appointment itself — same behavior as
            # `dashboard_service.get_appointments`.
            gsr_category_sub = (
                select(GrievanceSummaryRecord.appointment_id)
                .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
                .where(GrievanceSummaryRecord.category == category)
            )
            stmt = stmt.where(or_(
                Appointment.id.in_(gsr_category_sub),
                Appointment.grievance_category == category,
            ))

        if not needs_search:
            rows = (await db.execute(stmt)).all()
            return [tuple(r) for r in rows]

        # Search branch: decrypt-and-bucket. Same no-JOIN construction as
        # above (scalar subquery for priority rank, IN-subquery for priority /
        # category filters) so one appointment can only appear once here too.
        # Only Citizen is joined — it's a strict 1:1 relation, no dup risk.
        needle = q.strip().lower()
        stmt2 = (
            select(
                Appointment.id, Appointment.created_at,
                _pet_priority_rank_subq(),
                *([_PETITION_STATUS_CASE] if include_status_col else []),
                Citizen.encrypted_name, Citizen.encrypted_mobile,
                Appointment.token_assigned, Appointment.encrypted_grievance,
            )
            .select_from(Appointment)
            .outerjoin(Citizen, Citizen.id == Appointment.citizen_id)
            # Must mirror the non-search branch — see comment above.
            .where(Appointment.schedule_meeting == False)  # noqa: E712
            .where(Appointment.source != "ai_scan")
        )
        if status:
            key = status.upper()
            if key == _SK_REVIEWED:   stmt2 = stmt2.where(Appointment.status == "REVIEWED")
            elif key == _SK_DISMISSED: stmt2 = stmt2.where(Appointment.status == "DISMISSED")
            elif key == _SK_AWAITING:  stmt2 = stmt2.where(Appointment.status.notin_(["REVIEWED", "DISMISSED"]))
        if source:   stmt2 = stmt2.where(Appointment.source == source)
        if from_date: stmt2 = stmt2.where(Appointment.created_at >= dashboard_service._ist_start(from_date))
        if to_date:   stmt2 = stmt2.where(Appointment.created_at < dashboard_service._ist_end(to_date))
        if priority:
            gsr_priority_sub = (
                select(GrievanceSummaryRecord.appointment_id)
                .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
                .where(GrievanceSummaryRecord.priority == priority)
            )
            stmt2 = stmt2.where(Appointment.id.in_(gsr_priority_sub))
        if category:
            gsr_category_sub = (
                select(GrievanceSummaryRecord.appointment_id)
                .where(GrievanceSummaryRecord.is_latest == True)  # noqa: E712
                .where(GrievanceSummaryRecord.category == category)
            )
            stmt2 = stmt2.where(or_(
                Appointment.id.in_(gsr_category_sub),
                Appointment.grievance_category == category,
            ))
        rows = (await db.execute(stmt2)).all()

        out = []
        for r in rows:
            name  = dashboard_service._decode(r.encrypted_name)     if r.encrypted_name else ""
            mob   = dashboard_service._decode(r.encrypted_mobile)   if r.encrypted_mobile else ""
            grv   = dashboard_service._decode(r.encrypted_grievance) if r.encrypted_grievance else ""
            token = f"TKN{r.token_assigned}" if r.token_assigned else ""
            hay = " ".join((name, mob, grv, token)).lower()
            if needle in hay:
                base = (r.id, r.created_at, r[2])
                out.append(base + ((r[3],) if include_status_col else ()))
        return out

    async def _hydrate_petitions(self, db: AsyncSession, ids: List[int]) -> Dict[int, Dict[str, Any]]:
        """Load the full appointment rows and run them through the shared
        serializer so petition items match what `/api/appointments` returns.
        """
        stmt = (
            select(Appointment)
            .where(Appointment.id.in_(ids))
            .options(
                selectinload(Appointment.citizen),
                selectinload(Appointment.attachments),
                selectinload(Appointment.grievance_summary),
                selectinload(Appointment.scheduled_slot).selectinload(AppointmentSlot.availability),
            )
        )
        rows = (await db.execute(stmt)).scalars().all()
        return {r.id: dashboard_service.build_appointment_row(r) for r in rows}

    # ─── SORT KEYS ────────────────────────────────────────────────────────

    @staticmethod
    def _sort_key(sort: str):
        """Return a key function for `list.sort`. Ties break by descending id
        so pagination is stable across pages even when many rows share a
        timestamp (e.g. a bulk upload).
        """
        if sort == "submitted_asc":
            # (created_at asc, id asc) — earliest first, stable.
            return lambda r: (r[2], r[1])
        if sort == "priority_desc":
            # (priority desc → negate, created_at desc → negate ts, id desc).
            return lambda r: (-int(r[3] or 0), _neg_ts(r[2]), -r[1])
        # default: submitted_desc — newest first, stable by descending id.
        return lambda r: (_neg_ts(r[2]), -r[1])


def _neg_ts(ts) -> float:
    """Negate a datetime for a "descending" sort key. `None` sorts last."""
    if ts is None:
        return float("inf")
    return -ts.timestamp()


petition_inbox_service = PetitionInboxService()
