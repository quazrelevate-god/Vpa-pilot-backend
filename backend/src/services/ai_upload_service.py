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
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.models.ai_upload_models import (
    AiUpload,
    STATUS_QUEUED, STATUS_PROCESSING, STATUS_AWAITING_REVIEW,
    STATUS_REVIEWED, STATUS_FAILED,
)

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

    # ── Batch upload ────────────────────────────────────────────────────────────
    async def create_batch(self, files: List[UploadFile], db: AsyncSession,
                           category: Optional[str] = None,
                           batch_id: Optional[str] = None) -> Dict[str, Any]:
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
                grievance_category=forced_category,   # show the chosen category up-front
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
        if self._worker_active:
            return
        self._worker_active = True
        asyncio.create_task(self._worker())

    async def _worker(self) -> None:
        try:
            await self.recover_stale()   # re-queue anything left PROCESSING by a crash
            while True:
                upload_id = await self._claim_next_queued()
                if upload_id is None:
                    break
                await self._process_one(upload_id)
        finally:
            self._worker_active = False

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
                print(f"[AI UPLOAD] recovered {n} stale PROCESSING row(s) -> QUEUED")
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

        print(f"[AI UPLOAD] processing id={upload_id}")
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

            # PA's batch category overrides the AI one (unless none was chosen)
            final_category = forced_category or result.category.value

            payload = result.model_dump(mode="json")
            payload["category"] = final_category
            payload["_model_used"] = svc._model_name
            payload["_latency_ms"] = latency_ms

            async with AsyncSessionLocal() as db:
                row = await db.get(AiUpload, upload_id)
                if row is None:
                    return
                row.extracted_name    = result.citizen_name
                row.extracted_name_ta = result.citizen_name_ta
                row.extracted_mobile  = result.mobile
                row.grievance_category = final_category
                row.urgency            = result.urgency.value
                row.summary_json       = payload
                row.error_message      = None
                row.status             = STATUS_AWAITING_REVIEW
                row.processed_at       = datetime.utcnow()
                await db.commit()
            print(f"[AI UPLOAD] id={upload_id} -> AWAITING_REVIEW ({latency_ms}ms)")

        except Exception as exc:
            print(f"[AI UPLOAD] id={upload_id} FAILED: {exc}")
            try:
                async with AsyncSessionLocal() as db:
                    row = await db.get(AiUpload, upload_id)
                    if row:
                        row.status = STATUS_FAILED
                        row.error_message = str(exc)[:500]
                        row.processed_at = datetime.utcnow()
                        await db.commit()
            except Exception as inner:
                print(f"[AI UPLOAD] could not mark FAILED id={upload_id}: {inner}")

    # ── Read ────────────────────────────────────────────────────────────────────
    @staticmethod
    def _row_to_dict(row: AiUpload) -> Dict[str, Any]:
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
            "urgency": row.urgency,
            "headline": sj.get("headline"),
            "headline_ta": sj.get("headline_ta"),
            "summary": sj.get("summary"),
            "summary_ta": sj.get("summary_ta"),
            "citizen_ask": sj.get("citizen_ask"),
            "citizen_ask_ta": sj.get("citizen_ask_ta"),
            "key_details": sj.get("key_details") or [],
            "key_details_ta": sj.get("key_details_ta") or [],
            "department": sj.get("department"),
            "error": row.error_message,
            "ticket_number": row.ticket_number,
            "appointment_id": row.appointment_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }

    async def list_uploads(self, db: AsyncSession, status: Optional[str] = None) -> List[Dict[str, Any]]:
        stmt = select(AiUpload).order_by(AiUpload.created_at.desc(), AiUpload.id.desc())
        if status:
            stmt = stmt.where(AiUpload.status == status.upper())
        rows = (await db.execute(stmt)).scalars().all()
        return [self._row_to_dict(r) for r in rows]

    async def get_upload(self, db: AsyncSession, upload_id: int) -> Optional[Dict[str, Any]]:
        row = await db.get(AiUpload, upload_id)
        return self._row_to_dict(row) if row else None

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
            "urgency":     ("urgency",            "urgency"),
        }
        for key, (col, json_key) in mapping.items():
            if key in fields and fields[key] is not None:
                val = str(fields[key]).strip()
                setattr(row, col, val or None)
                sj[json_key] = val
        # Free-text narrative edits (summary, headline, citizen_ask + _ta)
        for k in ("summary", "summary_ta", "headline", "headline_ta", "citizen_ask", "citizen_ask_ta"):
            if k in fields and fields[k] is not None:
                sj[k] = str(fields[k])
        row.summary_json = sj
        await db.commit()
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
        name   = (row.extracted_name or extraction.citizen_name or "Unknown").strip()
        mobile = (row.extracted_mobile or "").strip()
        now = datetime.utcnow()

        # ── 1) Citizen + Appointment (AWAITING_REVIEW) + summary record ─────────
        enc_name   = appointment_service._encrypt_field(name)
        enc_mobile = appointment_service._encrypt_field(mobile or "")
        token_assigned, legacy_slot_ref = await appointment_service._assign_daily_token(db, now)

        citizen = None
        if mobile:
            citizen = await db.scalar(select(Citizen).where(Citizen.encrypted_mobile == enc_mobile))
        if citizen is None:
            citizen = Citizen(
                encrypted_name=enc_name, encrypted_mobile=enc_mobile,
                ward_or_region="Tamil Nadu", created_at=now,
            )
            db.add(citizen)
            await db.flush()
        else:
            citizen.encrypted_name = enc_name

        appt = Appointment(
            citizen_id=citizen.id,
            slot_id=legacy_slot_ref,
            token_assigned=token_assigned,
            encrypted_grievance=appointment_service._encrypt_field(extraction.summary or extraction.headline or ""),
            encrypted_name=enc_name,
            grievance_category=extraction.category.value,
            status="AWAITING_REVIEW",
            schedule_meeting=False,
            priority_score=0,
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

        return {
            "id": upload_id,
            "status": STATUS_REVIEWED,
            "appointment_id": appt.id,
            "token": f"TKN{token_assigned}",
            "ticket_number": row.ticket_number,
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


ai_upload_service = AiUploadService()
