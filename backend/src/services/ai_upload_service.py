"""
AI Uploads service — bulk petition extraction orchestration.

Flow:
  1. create_batch(): save files, insert QUEUED rows, wake the worker.
  2. background worker processes QUEUED rows ONE BY ONE (sequential, in-process):
     PROCESSING -> Gemini extraction -> AWAITING_REVIEW (or FAILED).
  3. PA edits (update_fields) and approves (approve) → lazily creates the
     Citizen + Appointment + GrievanceSummaryRecord + Ticket via the existing
     review->ticket path, then marks the row REVIEWED.
  4. retry() re-queues FAILED rows.

Isolated from scan-petition; converges into the existing Ticket system only on approve.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.core.utils import utc_iso
from src.models.ai_upload_models import (
    AiUpload,
    STATUS_QUEUED, STATUS_PROCESSING, STATUS_AWAITING_REVIEW,
    STATUS_REVIEWED, STATUS_FAILED, STATUS_DISMISSED,
)

logger = logging.getLogger(__name__)

_ALLOWED_MIMES = {
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/heic", "image/heif", "image/gif", "image/bmp",
}
_MAX_BYTES = 15 * 1024 * 1024        # 15 MB per file
_MAX_FILES = 25                      # per HTTP request (client chunks big folders)
_MAX_REQUEST_BYTES = 60 * 1024 * 1024  # 60 MB total per request (memory guard)
_EXTRACTION_TIMEOUT = 90             # seconds per file before a stuck call is failed
_STALE_PROCESSING_MIN = 15          # PROCESSING older than this is re-queued (crash recovery)


class AiUploadService:

    def __init__(self) -> None:
        self._worker_active = False   # single sequential worker guard
        # Guards _worker_active + the check/spawn / check/exit windows to
        # close the TOCTOU race where a new create_batch runs while a
        # worker is finishing its last row — the client would find
        # _worker_active=True and skip spawning, then the worker would
        # exit, orphaning every row created in that gap. See _worker().
        self._worker_lock: Optional[asyncio.Lock] = None

    def _get_worker_lock(self) -> asyncio.Lock:
        # Lazy so the lock binds to whatever event loop first calls in.
        if self._worker_lock is None:
            self._worker_lock = asyncio.Lock()
        return self._worker_lock

    # ── Batch upload ────────────────────────────────────────────────────────────
    async def create_batch(self, files: List[UploadFile], db: AsyncSession,
                           category: Optional[str] = None,
                           batch_id: Optional[str] = None,
                           source: Optional[str] = None) -> Dict[str, Any]:
        from src.services.appointment_service import appointment_service
        from src.services.storage_service import save_file
        from src.models.grievance_summary import GrievanceCategory

        valid = [f for f in files if f.filename]
        if not valid:
            raise HTTPException(status_code=400, detail="At least one file is required.")
        if len(valid) > _MAX_FILES:
            raise HTTPException(status_code=400, detail=f"Max {_MAX_FILES} files per request — upload in smaller chunks.")

        # PA category override for the whole batch ('auto'/'general'/blank => use AI).
        # Validate against the enum so a bad value can't break approve later.
        forced = (category or "").strip().lower()
        forced_category = forced if forced and forced not in ("auto", "general") else None
        if forced_category and forced_category not in {c.value for c in GrievanceCategory}:
            raise HTTPException(status_code=400, detail=f"Unknown category '{category}'.")

        # Reuse the client-supplied batch id so one folder (sent as several chunks)
        # stays one batch; otherwise mint a new one.
        batch_id = (batch_id or "").strip() or uuid.uuid4().hex
        created: List[Dict[str, Any]] = []
        total_bytes = 0

        for f in valid:
            mime = f.content_type or "application/octet-stream"
            if mime not in _ALLOWED_MIMES:
                raise HTTPException(status_code=400, detail=f"Unsupported file type '{mime}' ({f.filename}).")
            raw = await f.read()
            if len(raw) > _MAX_BYTES:
                raise HTTPException(status_code=400, detail=f"'{f.filename}' exceeds 15 MB limit.")
            total_bytes += len(raw)
            if total_bytes > _MAX_REQUEST_BYTES:
                raise HTTPException(status_code=400, detail="Upload chunk too large — send fewer files per request.")

            safe = appointment_service._sanitize_filename(f.filename)
            rel = f"ai_uploads/{batch_id}/{safe}"
            storage_url = await asyncio.to_thread(save_file, raw, rel, mime)

            row = AiUpload(
                batch_id=batch_id,
                original_filename=f.filename,
                storage_url=storage_url,
                mime_type=mime,
                status=STATUS_QUEUED,
                forced_category=forced_category,
                # NOTE: grievance_category is left blank until Gemini writes
                # it during processing. The PA-forced batch category used to
                # be shown as a QUEUED-state preview, but the override is now
                # ignored (see process_upload) so this preview would be
                # misleading — the row would flip categories after extraction.
                source=(source or "ai_scan").strip() or "ai_scan",
                created_at=datetime.utcnow(),
            )
            db.add(row)
            await db.flush()
            created.append({"id": row.id, "filename": f.filename})

        await db.commit()

        # Kick the sequential worker (no-op if already running).
        await self._ensure_worker()
        return {"batch_id": batch_id, "count": len(created), "items": created}

    # ── Background worker (sequential, one at a time) ───────────────────────────
    async def _ensure_worker(self) -> None:
        async with self._get_worker_lock():
            if self._worker_active:
                return
            self._worker_active = True
        asyncio.create_task(self._worker())

    async def _worker(self) -> None:
        # The classic single-worker TOCTOU: if the worker sees "no more
        # QUEUED" and starts to exit, a caller adding a new batch in that
        # gap finds _worker_active=True and skips spawning, then the
        # worker sets active=False — orphaning the new rows. Fix: on empty
        # queue, take the lock and re-check under it before exiting.
        try:
            await self.recover_stale()   # re-queue anything left PROCESSING by a crash
            while True:
                upload_id = await self._claim_next_queued()
                if upload_id is None:
                    async with self._get_worker_lock():
                        upload_id = await self._claim_next_queued()
                        if upload_id is None:
                            self._worker_active = False
                            return
                await self._process_one(upload_id)
        except Exception:
            # Ensure the guard clears even on unexpected worker crash so a
            # subsequent create_batch can restart the pipeline.
            async with self._get_worker_lock():
                self._worker_active = False
            raise

    async def recover_stale(self, max_minutes: int = _STALE_PROCESSING_MIN) -> int:
        """
        Re-queue rows stuck in PROCESSING (server restarted/crashed mid-extraction,
        or a call hung). Called at worker start and on app startup. max_minutes=0
        re-queues every PROCESSING row (used on startup — nothing is really running).
        """
        cutoff = datetime.utcnow() - timedelta(minutes=max_minutes)
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                update(AiUpload)
                .where(
                    AiUpload.status == STATUS_PROCESSING,
                    (AiUpload.processed_at.is_(None)) | (AiUpload.processed_at < cutoff),
                )
                .values(status=STATUS_QUEUED, error_message=None)
            )
            await db.commit()
            n = res.rowcount or 0
            if n:
                logger.info("ai_upload: recovered %d stale PROCESSING row(s) → QUEUED", n)
            return n

    async def _claim_next_queued(self) -> Optional[int]:
        """Atomically pick the oldest QUEUED row and flip it to PROCESSING."""
        async with AsyncSessionLocal() as db:
            row = await db.scalar(
                select(AiUpload)
                .where(AiUpload.status == STATUS_QUEUED)
                .order_by(AiUpload.created_at, AiUpload.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return None
            row.status = STATUS_PROCESSING
            row.processed_at = datetime.utcnow()   # start marker for stale recovery
            await db.commit()
            return row.id

    async def _process_one(self, upload_id: int) -> None:
        from src.services.petition_extraction import PetitionExtractionService
        from src.services.storage_service import get_file_bytes

        logger.info("ai_upload processing id=%s", upload_id)
        try:
            async with AsyncSessionLocal() as db:
                row = await db.get(AiUpload, upload_id)
                if row is None:
                    return
                storage_url, mime, fname = row.storage_url, row.mime_type, row.original_filename
                forced_category = row.forced_category

            raw = await asyncio.to_thread(get_file_bytes, storage_url)
            if raw is None:
                raise FileNotFoundError(f"File missing in storage: {storage_url}")

            svc = PetitionExtractionService.from_settings()
            loop = asyncio.get_running_loop()
            t0 = time.monotonic()
            # Hard timeout so one hung Gemini call can't stall the whole queue.
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    None, lambda: svc.extract(file_bytes=raw, mime_type=mime, filename=fname)
                ),
                timeout=_EXTRACTION_TIMEOUT,
            )
            latency_ms = int((time.monotonic() - t0) * 1000)

            # Category is always what Gemini classified. The PA-set
            # forced_category on the batch is DEPRECATED — kept on the row
            # only as an audit of what the PA thought the batch was — because
            # PAs were frequently picking the wrong category and stomping the
            # (more accurate) AI value. The PA can still fix an individual
            # row from the drawer if the AI genuinely gets it wrong.
            _ = forced_category  # intentionally unused — see comment above
            final_category = result.category.value

            payload = result.model_dump(mode="json")
            payload["category"] = final_category
            payload["_model_used"] = svc._model_name
            payload["_latency_ms"] = latency_ms

            async with AsyncSessionLocal() as db:
                row = await db.get(AiUpload, upload_id)
                if row is None:
                    return
                # citizen_name / citizen_name_ta are Gemini's strict-confidence
                # extraction (empty when it's unsure). But `citizen_name` is
                # kept in the ORIGINAL script per the schema — for a Tamil
                # petition it lands as Tamil, so it can't feed the English
                # display column. Use the inherited bilingual pair
                # (name_en → Latin, name_ta → Tamil) which Gemini also fills
                # with proper transliteration; gate on the strict field so
                # "empty = wasn't sure" still holds end-to-end.
                row.extracted_name    = result.name_en if result.citizen_name.strip()    else ""
                row.extracted_name_ta = result.name_ta if result.citizen_name_ta.strip() else ""
                row.extracted_mobile  = result.mobile
                row.grievance_category = final_category
                row.priority           = result.urgency.value   # LLM field `urgency` -> `priority` column
                row.summary_json       = payload
                row.error_message      = None
                row.status             = STATUS_AWAITING_REVIEW
                row.processed_at       = datetime.utcnow()
                await db.commit()
            logger.info("ai_upload id=%s → AWAITING_REVIEW (%dms)", upload_id, latency_ms)

        except Exception as exc:
            logger.warning("ai_upload id=%s FAILED: %s", upload_id, exc)
            try:
                async with AsyncSessionLocal() as db:
                    row = await db.get(AiUpload, upload_id)
                    if row:
                        row.status = STATUS_FAILED
                        row.error_message = str(exc)[:500]
                        row.processed_at = datetime.utcnow()
                        await db.commit()
            except Exception as inner:
                logger.warning("ai_upload could not mark FAILED id=%s: %s", upload_id, inner)

    # ── Read ────────────────────────────────────────────────────────────────────
    # Two shapes: `_light` for the list endpoint (no long narrative fields —
    # drops summary/summary_ta/key_details*), `_full` for the detail drawer.
    # The list at 3k+ rows was shipping several MB of JSONB per load because
    # every row carried its full grievance summary; the drawer already
    # re-fetches via GET /{id}, so the narrative belongs there, not in the
    # list card. See _row_to_dict_full for the shape write paths still use.
    @staticmethod
    def _row_to_dict_light(row: AiUpload) -> Dict[str, Any]:
        from src.services.storage_service import get_file_url
        sj = row.summary_json or {}
        try:
            file_url = get_file_url(row.storage_url)
        except Exception:
            file_url = None
        return {
            "id": row.id,
            "batch_id": row.batch_id,
            "filename": row.original_filename,
            "mime_type": row.mime_type,
            "file_url": file_url,
            "status": row.status,
            "name": row.extracted_name,
            "name_ta": row.extracted_name_ta,
            "mobile": row.extracted_mobile,
            "category": row.grievance_category,
            "forced_category": row.forced_category,
            "priority": row.priority,
            # citizen_ask + _ta stay in the light payload: they're the
            # "what the citizen wants" line shown on every list row.
            "citizen_ask": sj.get("citizen_ask"),
            "citizen_ask_ta": sj.get("citizen_ask_ta"),
            "ministry": sj.get("ministry") or sj.get("department"),
            "district": (
                None
                if (sj.get("district") in (None, "", "unknown"))
                else sj.get("district")
            ),
            "error": row.error_message,
            "ticket_number": row.ticket_number,
            "appointment_id": row.appointment_id,
            "source": row.source or "ai_scan",
            "created_at": utc_iso(row.created_at),
        }

    @staticmethod
    def _row_to_dict_full(row: AiUpload) -> Dict[str, Any]:
        """Full detail — used by GET /{id} + returned from update / approve."""
        light = AiUploadService._row_to_dict_light(row)
        sj = row.summary_json or {}
        light.update({
            "summary": sj.get("summary"),
            "summary_ta": sj.get("summary_ta"),
            "key_details": sj.get("key_details") or [],
            "key_details_ta": sj.get("key_details_ta") or [],
        })
        return light

    # Backwards-compat alias — kept for the write paths (update/approve/dismiss)
    # that return a hydrated row to the frontend, which still expects the full
    # payload with summary + key_details.
    _row_to_dict = _row_to_dict_full

    # ── Filter helpers ──────────────────────────────────────────────────────────
    _IST_OFFSET_MIN = 330   # IST = UTC+5:30

    @classmethod
    def _ist_day_to_utc_range(cls, from_date: Optional[str], to_date: Optional[str]):
        """Convert IST calendar-day filter (YYYY-MM-DD) to a UTC (start, end).

        The frontend buckets rows by LOCAL (IST) day; filtering server-side by
        raw UTC created_at would mis-bucket late-evening IST submissions to
        the next day. So we shift the day boundaries by 5h30m: an IST day
        `2026-07-20` maps to UTC `[2026-07-19T18:30, 2026-07-20T18:30)`.
        """
        start_utc = end_utc = None
        offset = timedelta(minutes=cls._IST_OFFSET_MIN)
        if from_date:
            try:
                d = datetime.strptime(from_date, "%Y-%m-%d")
                start_utc = d - offset
            except ValueError:
                pass
        if to_date:
            try:
                d = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
                end_utc = d - offset
            except ValueError:
                pass
        return start_utc, end_utc

    @classmethod
    def _apply_common_filters(cls, stmt, *, status=None, q=None, category=None,
                              priority=None, source=None, batch_id=None,
                              from_date=None, to_date=None):
        """Attach the shared WHERE clauses used by list + aggregates queries."""
        if status:
            stmt = stmt.where(AiUpload.status == status.upper())
        if category:
            stmt = stmt.where(AiUpload.grievance_category == category)
        if priority:
            stmt = stmt.where(AiUpload.priority == priority)
        if source:
            stmt = stmt.where(AiUpload.source == source)
        if batch_id:
            stmt = stmt.where(AiUpload.batch_id == batch_id)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(
                AiUpload.original_filename.ilike(like),
                AiUpload.extracted_name.ilike(like),
                AiUpload.extracted_name_ta.ilike(like),
                AiUpload.extracted_mobile.ilike(like),
                AiUpload.ticket_number.ilike(like),
            ))
        start_utc, end_utc = cls._ist_day_to_utc_range(from_date, to_date)
        if start_utc is not None:
            stmt = stmt.where(AiUpload.created_at >= start_utc)
        if end_utc is not None:
            stmt = stmt.where(AiUpload.created_at < end_utc)
        return stmt

    _PRIORITY_RANK_CASE = case(
        (AiUpload.priority == "critical", 4),
        (AiUpload.priority == "high",     3),
        (AiUpload.priority == "medium",   2),
        (AiUpload.priority == "low",      1),
        else_=0,
    )

    async def list_uploads(
        self,
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = 50,
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
        """Paginated list — returns {items, total, page, page_size, has_more}.

        Filters, sort, and search are all applied server-side so the 3k+ live
        petition set doesn't need to travel to the browser just to be filtered.
        Page rows are `_row_to_dict_light` (no summary / key_details) — the
        drawer refetches full detail via GET /{id}.
        """
        page = max(1, page)
        page_size = max(1, min(page_size, 500))

        stmt = self._apply_common_filters(
            select(AiUpload),
            status=status, q=q, category=category, priority=priority,
            source=source, batch_id=batch_id, from_date=from_date, to_date=to_date,
        )
        # The review UI never wants in-flight rows in the feed — they belong
        # to the upload batches panel. Excluding here rather than post-filtering
        # keeps counts, offsets, and has_more all consistent.
        if not status:
            stmt = stmt.where(AiUpload.status.notin_([STATUS_QUEUED, STATUS_PROCESSING]))

        # Total row count under the current filter (same predicate — cached by
        # PG for the current session usually). At 3k rows this is sub-100ms.
        count_stmt = self._apply_common_filters(
            select(func.count(AiUpload.id)),
            status=status, q=q, category=category, priority=priority,
            source=source, batch_id=batch_id, from_date=from_date, to_date=to_date,
        )
        if not status:
            count_stmt = count_stmt.where(
                AiUpload.status.notin_([STATUS_QUEUED, STATUS_PROCESSING])
            )
        total = int((await db.execute(count_stmt)).scalar() or 0)

        if sort == "submitted_asc":
            stmt = stmt.order_by(AiUpload.created_at.asc(), AiUpload.id.asc())
        elif sort == "priority_desc":
            stmt = stmt.order_by(
                self._PRIORITY_RANK_CASE.desc(),
                AiUpload.created_at.desc(),
                AiUpload.id.desc(),
            )
        else:  # submitted_desc (default)
            stmt = stmt.order_by(AiUpload.created_at.desc(), AiUpload.id.desc())

        offset = (page - 1) * page_size
        stmt = stmt.offset(offset).limit(page_size)
        rows = (await db.execute(stmt)).scalars().all()

        return {
            "items": [self._row_to_dict_light(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": (offset + len(rows)) < total,
        }

    async def list_aggregates(
        self,
        db: AsyncSession,
        *,
        q: Optional[str] = None,
        priority: Optional[str] = None,
        source: Optional[str] = None,
        batch_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Feeds the ai-review page's status tabs, category chart and badges.

        `counts_by_status` and `distribution` are scoped by the same filters
        as the list (except `status` and `category`, which are what we count
        across). `total_awaiting`/`failed_count`/`active_jobs` are global —
        they drive notification badges that must always show the true state,
        not the filtered state.
        """
        # Status-tab counts (excluding QUEUED/PROCESSING — hidden from the UI).
        stmt_status = self._apply_common_filters(
            select(AiUpload.status, func.count(AiUpload.id)),
            q=q, priority=priority, source=source, batch_id=batch_id,
            from_date=from_date, to_date=to_date,
        ).group_by(AiUpload.status)
        rows_status = (await db.execute(stmt_status)).all()
        counts_by_status: Dict[str, int] = {
            STATUS_AWAITING_REVIEW: 0,
            STATUS_REVIEWED: 0,
            STATUS_FAILED: 0,
            STATUS_DISMISSED: 0,
        }
        total_visible = 0
        for status_val, n in rows_status:
            n = int(n)
            if status_val in (STATUS_QUEUED, STATUS_PROCESSING):
                continue
            counts_by_status[status_val] = counts_by_status.get(status_val, 0) + n
            total_visible += n

        # Category distribution — scoped like the list but ignoring status/category
        # (matches how the chart works on the client — "how do the visible rows
        # split across categories" so the PA can click one to filter).
        stmt_cat = self._apply_common_filters(
            select(AiUpload.grievance_category, func.count(AiUpload.id)),
            q=q, priority=priority, source=source, batch_id=batch_id,
            from_date=from_date, to_date=to_date,
        ).where(AiUpload.status.notin_([STATUS_QUEUED, STATUS_PROCESSING])
                ).group_by(AiUpload.grievance_category)
        rows_cat = (await db.execute(stmt_cat)).all()
        distribution = [
            {"key": (cat or "other"), "count": int(n)}
            for cat, n in rows_cat
        ]
        distribution.sort(key=lambda r: r["count"], reverse=True)

        # Global badges — independent of the current filter so users don't
        # miss a FAILED row hiding behind an active filter.
        total_awaiting = int((await db.execute(
            select(func.count(AiUpload.id)).where(AiUpload.status == STATUS_AWAITING_REVIEW)
        )).scalar() or 0)
        failed_count = int((await db.execute(
            select(func.count(AiUpload.id)).where(AiUpload.status == STATUS_FAILED)
        )).scalar() or 0)
        active_jobs = int((await db.execute(
            select(func.count(AiUpload.id)).where(
                AiUpload.status.in_([STATUS_QUEUED, STATUS_PROCESSING])
            )
        )).scalar() or 0)

        return {
            "counts_by_status": {
                "":                     total_visible,
                STATUS_AWAITING_REVIEW: counts_by_status.get(STATUS_AWAITING_REVIEW, 0),
                STATUS_REVIEWED:        counts_by_status.get(STATUS_REVIEWED, 0),
                STATUS_FAILED:          counts_by_status.get(STATUS_FAILED, 0),
                STATUS_DISMISSED:       counts_by_status.get(STATUS_DISMISSED, 0),
            },
            "distribution":  distribution,
            "total_awaiting": total_awaiting,
            "failed_count":   failed_count,
            "active_jobs":    active_jobs,
        }

    async def list_batches(self, db: AsyncSession) -> Dict[str, Any]:
        """Drives the AI Uploads page batch cards + the Review page batch banner.

        One query per batch derives status counts, earliest created_at (used to
        number the batch as "Batch_YYYY_MM_DD_NNN"), and the failed-id list
        used by the per-batch Retry menu. Unfiltered — the batch panel always
        shows every batch, regardless of the review-page filters.
        """
        stmt = (
            select(
                AiUpload.batch_id,
                AiUpload.status,
                func.count(AiUpload.id),
                func.min(AiUpload.created_at),
            )
            .group_by(AiUpload.batch_id, AiUpload.status)
        )
        rows = (await db.execute(stmt)).all()

        # Aggregate rows into { batch_id: { counts: {}, earliest, ... } }.
        per_batch: Dict[str, Dict[str, Any]] = {}
        for batch, status_val, n, earliest in rows:
            b = per_batch.setdefault(batch, {
                "id": batch,
                "counts": {
                    STATUS_QUEUED: 0, STATUS_PROCESSING: 0,
                    STATUS_AWAITING_REVIEW: 0, STATUS_REVIEWED: 0,
                    STATUS_FAILED: 0, STATUS_DISMISSED: 0,
                },
                "earliest_created_at": None,
            })
            b["counts"][status_val] = int(n)
            if b["earliest_created_at"] is None or (earliest and earliest < b["earliest_created_at"]):
                b["earliest_created_at"] = earliest

        # Per-batch failed row ids (for the "Retry N" button). One extra query
        # only over FAILED rows — bounded by the count of failures, cheap.
        failed_stmt = (
            select(AiUpload.batch_id, AiUpload.id)
            .where(AiUpload.status == STATUS_FAILED)
        )
        for batch, upload_id in (await db.execute(failed_stmt)).all():
            per_batch.setdefault(batch, {
                "id": batch,
                "counts": {k: 0 for k in (
                    STATUS_QUEUED, STATUS_PROCESSING, STATUS_AWAITING_REVIEW,
                    STATUS_REVIEWED, STATUS_FAILED, STATUS_DISMISSED,
                )},
                "earliest_created_at": None,
            }).setdefault("failed_ids", []).append(upload_id)
        for b in per_batch.values():
            b.setdefault("failed_ids", [])

        # Assign friendly names ("Batch_YYYY_MM_DD_NNN") by IST calendar day
        # of the earliest-file timestamp — matches the frontend's old client
        # derivation in lib/batches.ts so both surfaces agree.
        ordered = sorted(
            per_batch.values(),
            key=lambda b: b["earliest_created_at"] or datetime.min,
        )
        per_day: Dict[str, int] = {}
        ist_offset = timedelta(minutes=self._IST_OFFSET_MIN)
        for b in ordered:
            ts = b["earliest_created_at"]
            day = ((ts + ist_offset).strftime("%Y_%m_%d") if ts else "batch")
            per_day[day] = per_day.get(day, 0) + 1
            b["name"] = f"Batch_{day}_{per_day[day]:03d}"
            b["earliest_created_at"] = utc_iso(ts) if ts else None

        # Reverse-chron for the panel (newest batch on top, matching the old UX).
        batches = sorted(
            per_batch.values(),
            key=lambda b: b["earliest_created_at"] or "",
            reverse=True,
        )

        totals = {
            "batches":         len(batches),
            "files":           sum(sum(b["counts"].values()) for b in batches),
            # Same rule as the per-batch progress bar: DISMISSED counts as
            # extracted (the file was processed, then the PA discarded it).
            "extracted":       sum(
                b["counts"][STATUS_AWAITING_REVIEW]
                + b["counts"][STATUS_REVIEWED]
                + b["counts"][STATUS_DISMISSED]
                for b in batches
            ),
            "flagged":         sum(b["counts"][STATUS_FAILED] for b in batches),
            "awaiting_review": sum(b["counts"][STATUS_AWAITING_REVIEW] for b in batches),
        }
        return {"batches": batches, "totals": totals}

    async def get_upload(self, db: AsyncSession, upload_id: int) -> Optional[Dict[str, Any]]:
        row = await db.get(AiUpload, upload_id)
        return self._row_to_dict_full(row) if row else None

    # ── PA edits ────────────────────────────────────────────────────────────────
    async def update_fields(self, db: AsyncSession, upload_id: int, fields: Dict[str, Any]) -> Dict[str, Any]:
        row = await db.get(AiUpload, upload_id)
        if row is None:
            raise ValueError("Upload not found.")
        if row.status != STATUS_AWAITING_REVIEW:
            raise ValueError("Only rows awaiting review can be edited.")

        sj = dict(row.summary_json or {})
        # Map editable inputs onto both the columns and the summary_json.
        mapping = {
            "name":        ("extracted_name",    "citizen_name"),
            "name_ta":     ("extracted_name_ta", "citizen_name_ta"),
            "mobile":      ("extracted_mobile",  "mobile"),
            "category":    ("grievance_category", "category"),
            "priority":    ("priority",           "priority"),
        }
        for key, (col, json_key) in mapping.items():
            if key in fields and fields[key] is not None:
                val = str(fields[key]).strip()
                setattr(row, col, val or None)
                sj[json_key] = val
        # Ministry lives only in summary_json, not a column. Editing it here
        # also decides the approve button (Accept vs Forward).
        if "ministry" in fields and fields["ministry"] is not None:
            sj["ministry"] = str(fields["ministry"]).strip() or None
        # District — same story as ministry: summary_json only, no column.
        # PA edits during review reach the GSR record via _build_case, which
        # calls from_gemini_response(summary=extraction) and that factory
        # already normalises "unknown"/empty to NULL on persist.
        if "district" in fields and fields["district"] is not None:
            sj["district"] = str(fields["district"]).strip() or "unknown"
        # Free-text narrative edits (summary, citizen_ask + _ta)
        for k in ("summary", "summary_ta", "citizen_ask", "citizen_ask_ta"):
            if k in fields and fields[k] is not None:
                sj[k] = str(fields[k])
        row.summary_json = sj
        await db.commit()
        return self._row_to_dict(row)

    # ── Dismiss → mark reviewed with NO ticket / citizen / appointment ─────────
    # For petitions the PA does not want to convert into a case: courtesy audio
    # messages, duplicates, blank scans, etc. Row stays on the list under "All"
    # but drops out of Awaiting Review so the queue stays clean.
    async def dismiss(self, db: AsyncSession, upload_id: int, reviewed_by: str) -> Dict[str, Any]:
        # Atomic claim, same shape as approve() — only AWAITING_REVIEW rows may
        # be dismissed, and a double-click / concurrent PA loses the race.
        claim = await db.execute(
            update(AiUpload)
            .where(AiUpload.id == upload_id, AiUpload.status == STATUS_AWAITING_REVIEW)
            .values(
                status=STATUS_DISMISSED,
                reviewed_at=datetime.utcnow(),
                reviewed_by=reviewed_by,
            )
        )
        await db.commit()
        if (claim.rowcount or 0) == 0:
            if await db.get(AiUpload, upload_id) is None:
                raise ValueError("Upload not found.")
            raise ValueError("Already reviewed or not awaiting review.")
        row = await db.get(AiUpload, upload_id)
        return self._row_to_dict(row)

    async def restore(self, db: AsyncSession, upload_id: int) -> Dict[str, Any]:
        """Undo a dismissal — send a DISMISSED upload back to AWAITING_REVIEW.
        Atomic claim like dismiss(); only dismissed rows are eligible, and the
        review stamps are cleared so it re-enters the queue as if untouched.
        """
        claim = await db.execute(
            update(AiUpload)
            .where(AiUpload.id == upload_id, AiUpload.status == STATUS_DISMISSED)
            .values(status=STATUS_AWAITING_REVIEW, reviewed_at=None, reviewed_by=None)
        )
        await db.commit()
        if (claim.rowcount or 0) == 0:
            if await db.get(AiUpload, upload_id) is None:
                raise ValueError("Upload not found.")
            raise ValueError("Only dismissed uploads can be restored to review.")
        row = await db.get(AiUpload, upload_id)
        return self._row_to_dict(row)

    # ── Approve → create the case + ticket ──────────────────────────────────────
    async def approve(self, db: AsyncSession, upload_id: int, reviewed_by: str) -> Dict[str, Any]:
        # Atomically claim the row: flip AWAITING_REVIEW -> REVIEWED in one UPDATE.
        # A double-click or a second PA loses the race (rowcount 0) and cannot
        # create a duplicate Citizen/Appointment/Ticket for the same upload.
        claim = await db.execute(
            update(AiUpload)
            .where(AiUpload.id == upload_id, AiUpload.status == STATUS_AWAITING_REVIEW)
            .values(status=STATUS_REVIEWED)
        )
        await db.commit()
        if (claim.rowcount or 0) == 0:
            if await db.get(AiUpload, upload_id) is None:
                raise ValueError("Upload not found.")
            raise ValueError("Already approved or not awaiting review.")

        try:
            return await self._build_case(db, upload_id, reviewed_by)
        except Exception:
            # Build failed — release the claim so the row can be approved again.
            await db.rollback()
            try:
                async with AsyncSessionLocal() as db2:
                    r = await db2.get(AiUpload, upload_id)
                    if r and r.status == STATUS_REVIEWED and r.ticket_id is None:
                        r.status = STATUS_AWAITING_REVIEW
                        await db2.commit()
            except Exception:
                pass
            raise

    async def _build_case(self, db: AsyncSession, upload_id: int, reviewed_by: str) -> Dict[str, Any]:
        from src.services.appointment_service import appointment_service
        from src.services import dashboard_service
        from src.services.petition_extraction import PetitionExtraction
        from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment
        from src.models.grievance_summary_record import GrievanceSummaryRecord
        from src.models.ticket_models import Ticket

        row = await db.get(AiUpload, upload_id)
        sj = row.summary_json or {}
        extraction = PetitionExtraction.model_validate(sj)   # enums back, edits included
        # Strict extraction: Gemini leaves citizen_name empty when not confident.
        # PA must fill it via update_fields before approving — no "Unknown"
        # placeholders reach the citizen record.
        name   = (row.extracted_name or extraction.citizen_name or "").strip()
        mobile = (row.extracted_mobile or "").strip()
        if not name:
            raise ValueError(
                "Citizen name is empty — the AI extractor was not confident enough "
                "to read the name from this petition. Please fill in the name in "
                "the review drawer before approving."
            )
        now = datetime.utcnow()

        # ── 1) Citizen + Appointment (AWAITING_REVIEW) + summary record ─────────
        enc_name   = appointment_service._encrypt_field(name)
        enc_mobile = appointment_service._encrypt_field(mobile or "")
        token_assigned, legacy_slot_ref = await appointment_service._assign_daily_token(db, now)

        from src.core import crypto
        mobile_idx = crypto.blind_index(mobile) if mobile else None
        citizen = None
        if mobile:
            citizen = await db.scalar(select(Citizen).where(Citizen.mobile_index == mobile_idx))
        if citizen is None:
            citizen = Citizen(
                encrypted_name=enc_name, encrypted_mobile=enc_mobile,
                mobile_index=mobile_idx, created_at=now,
            )
            db.add(citizen)
            await db.flush()
        else:
            citizen.encrypted_name = enc_name

        from src.services.v2_helpers import v2
        ai_ids = v2.new_appointment_ids(
            status="AWAITING_REVIEW",
            category=extraction.category.value,
        )
        appt = Appointment(
            citizen_id=citizen.id,
            # v2: slot_id is a real FK — AI-scan rows never book a slot.
            slot_id=None,
            token_assigned=token_assigned,
            # main's field priority (citizen_ask first); v2 keeps the name on Citizen only.
            encrypted_grievance=appointment_service._encrypt_field(extraction.citizen_ask or extraction.summary or ""),
            grievance_category=extraction.category.value,
            status="AWAITING_REVIEW",
            status_id=ai_ids["status_id"],
            priority_id=ai_ids["priority_id"],
            category_id=ai_ids.get("category_id"),
            schedule_meeting=False,
            summary_status="DONE",  # ai_scan summarises inline below; keep the worker off it
            # Carry the intake channel from the ai_upload row so the ticket
            # source filter reflects how the petition was actually submitted
            # (ai_scan / postal / cm_office) instead of always looking like a
            # citizen QR walk-in.
            source=(row.source or "ai_scan"),
            created_at=now,
        )
        db.add(appt)
        await db.flush()

        # Attach the uploaded document to the appointment
        db.add(AppointmentAttachment(
            appointment_id=appt.id,
            attachment_type="DOCUMENT" if row.mime_type == "application/pdf" else "IMAGE",
            storage_url=row.storage_url,
            file_size_bytes=0,
            mime_type=row.mime_type,
            created_at=now,
        ))

        # Persist the AI summary against the appointment
        record = GrievanceSummaryRecord.from_gemini_response(
            appointment_id=appt.id,
            summary=extraction,
            gemini_model_used=str(sj.get("_model_used") or "gemini"),
            gemini_latency_ms=sj.get("_latency_ms"),
        )
        db.add(record)
        await db.flush()

        # ── 2) Flip to REVIEWED → creates the Ticket via the existing path.
        # update_appointment_status commits, so appt + citizen + summary + ticket
        # all land in one transaction (nothing orphaned if ticket creation fails).
        await dashboard_service.update_appointment_status(db, appt.id, "Reviewed")

        # ── 3) Link ticket back onto the upload row ─────────────────────────────
        ticket = await db.scalar(select(Ticket).where(Ticket.appointment_id == appt.id))
        row = await db.get(AiUpload, upload_id)
        row.status = STATUS_REVIEWED
        row.appointment_id = appt.id
        row.ticket_id = ticket.id if ticket else None
        row.ticket_number = ticket.ticket_number if ticket else None
        row.reviewed_at = now
        row.reviewed_by = reviewed_by
        await db.commit()

        # Non-school ministry → auto-forward out of the school department
        # workflow. School stays OPEN so it can be routed to one of the 10
        # school departments ("Accept"). Shared with the QR/staff petition path.
        from src.services import department_service
        dept_val = extraction.ministry.value if extraction.ministry else None
        forwarded = (
            await department_service.forward_if_non_school(db, ticket.id, dept_val, reviewed_by)
            if ticket else False
        )

        return {
            "id": upload_id,
            "status": STATUS_REVIEWED,
            "appointment_id": appt.id,
            "token": f"TKN{token_assigned}",
            "ticket_number": row.ticket_number,
            "forwarded": forwarded,
        }

    # ── Retry failed (single or bulk) ───────────────────────────────────────────
    async def retry(self, db: AsyncSession, ids: List[int]) -> Dict[str, Any]:
        rows = (await db.execute(
            select(AiUpload).where(AiUpload.id.in_(ids), AiUpload.status == STATUS_FAILED)
        )).scalars().all()
        for r in rows:
            r.status = STATUS_QUEUED
            r.error_message = None
        await db.commit()
        await self._ensure_worker()
        return {"requeued": [r.id for r in rows]}

    # ── Batch delete (purge wrong / noisy uploads) ─────────────────────────────
    async def delete_batch(self, db: AsyncSession, batch_id: str) -> Dict[str, Any]:
        """Delete every AiUpload row in `batch_id` and the underlying storage
        files. Used when a PA uploaded the wrong folder or a batch of noise
        that should never enter the review queue.

        Refuses if any row in the batch is already REVIEWED — those rows have
        an approved Appointment + Ticket whose AppointmentAttachment reuses
        the same storage_url. Deleting the file would 404 the ticket's
        attachment and there's no clean way to un-approve it here.

        Deletion is atomic at the DB level (one commit). Storage deletes are
        best-effort — a MinIO failure is logged but doesn't roll back the DB
        purge; the row is what mattered to the PA, an orphaned object can
        be swept later.
        """
        from src.services.storage_service import delete_file

        rows = (await db.execute(
            select(AiUpload).where(AiUpload.batch_id == batch_id)
        )).scalars().all()

        if not rows:
            return {"batch_id": batch_id, "deleted": 0, "message": "Batch not found."}

        reviewed = [r for r in rows if r.status == STATUS_REVIEWED]
        if reviewed:
            raise ValueError(
                f"Cannot delete batch — {len(reviewed)} row(s) already approved into "
                "tickets. Their attachments are referenced by live appointments; "
                "dismiss or handle those separately first."
            )

        storage_ok = 0
        storage_fail = 0
        for r in rows:
            if r.storage_url and delete_file(r.storage_url):
                storage_ok += 1
            elif r.storage_url:
                storage_fail += 1

        deleted_ids = [r.id for r in rows]
        await db.execute(
            AiUpload.__table__.delete().where(AiUpload.id.in_(deleted_ids))
        )
        await db.commit()

        return {
            "batch_id":     batch_id,
            "deleted":      len(deleted_ids),
            "storage_ok":   storage_ok,
            "storage_fail": storage_fail,
            "message":      f"Deleted {len(deleted_ids)} row(s) from batch {batch_id}.",
        }


ai_upload_service = AiUploadService()
