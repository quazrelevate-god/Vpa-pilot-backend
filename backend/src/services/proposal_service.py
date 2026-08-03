"""
Proposal intake service — persist a /proposal submission and run Gemini
extraction over its document(s), isolated from the petition/ticket pipeline.

Mirrors the AI Uploads staging pattern (restart-safe single worker, SELECT ...
FOR UPDATE SKIP LOCKED claim, stale-recovery), but the destination is a
ProposalSubmission brief for the super-admin Proposal Review surface — never a
Ticket. Identity comes from the form and is stored encrypted; Gemini reads only
the document for problem / solution / cost / benefit.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core import crypto
from src.core.database import AsyncSessionLocal
from src.models.proposal_models import (
    ProposalSubmission,
    STATUS_QUEUED, STATUS_PROCESSING, STATUS_AWAITING_REVIEW, STATUS_FAILED,
)

logger = logging.getLogger(__name__)

# Intake limits — mirror the /proposal form (PDF only, up to 5 files, 25 MB each).
_ALLOWED_MIMES = {"application/pdf"}
_MAX_FILES = 5
_MAX_BYTES = 25 * 1024 * 1024
_MAX_REQUEST_BYTES = 60 * 1024 * 1024

_EXTRACTION_TIMEOUT = 90        # seconds — one hung Gemini call can't stall the queue
_STALE_PROCESSING_MIN = 10      # re-queue rows stuck PROCESSING longer than this

# Category → tracking-ref prefix (matches the /proposal form desks).
_PREFIX = {"school": "SCH", "tamil": "TAM", "information": "INF", "film": "FLM"}


def _mint_tracking_ref(category: Optional[str]) -> str:
    key = _PREFIX.get((category or "").strip().lower(), "GEN")
    token = secrets.token_hex(3).upper()[:5]
    return f"NK/{key}/{datetime.utcnow().year}/{token}"


class ProposalService:
    def __init__(self) -> None:
        self._worker_active = False
        self._worker_lock: Optional[asyncio.Lock] = None

    def _get_worker_lock(self) -> asyncio.Lock:
        if self._worker_lock is None:
            self._worker_lock = asyncio.Lock()
        return self._worker_lock

    # ── Create ──────────────────────────────────────────────────────────────────
    async def create_submission(
        self,
        *,
        category: Optional[str],
        org_name: str,
        person_name: str,
        designation: Optional[str],
        email: str,
        phone: str,
        files: List[UploadFile],
        db: AsyncSession,
    ) -> Dict[str, Any]:
        from src.services.appointment_service import appointment_service
        from src.services.storage_service import save_file

        valid = [f for f in files if f and f.filename]
        if not valid:
            raise HTTPException(status_code=400, detail="At least one proposal document (PDF) is required.")
        if len(valid) > _MAX_FILES:
            raise HTTPException(status_code=400, detail=f"Maximum {_MAX_FILES} documents per submission.")

        tracking_ref = _mint_tracking_ref(category)
        documents: List[Dict[str, str]] = []
        total = 0
        for f in valid:
            mime = (f.content_type or "").lower()
            if mime not in _ALLOWED_MIMES:
                raise HTTPException(status_code=400, detail=f"Only PDF documents are accepted ({f.filename}).")
            raw = await f.read()
            if len(raw) > _MAX_BYTES:
                raise HTTPException(status_code=400, detail=f"'{f.filename}' exceeds the 25 MB limit.")
            total += len(raw)
            if total > _MAX_REQUEST_BYTES:
                raise HTTPException(status_code=400, detail="Upload too large — send fewer / smaller documents.")
            safe = appointment_service._sanitize_filename(f.filename)
            rel = f"proposals/{tracking_ref.replace('/', '_')}/{secrets.token_hex(6)}_{safe}"
            storage_url = await asyncio.to_thread(save_file, raw, rel, mime)
            documents.append({"original_filename": f.filename, "storage_url": storage_url, "mime_type": mime})

        row = ProposalSubmission(
            tracking_ref=tracking_ref,
            category=(category or "").strip().lower() or None,
            org_name=(org_name or "").strip()[:300] or None,
            person_name=(person_name or "").strip()[:200] or None,
            designation=(designation or "").strip()[:200] or None,
            email_enc=crypto.encrypt((email or "").strip() or None),
            phone_enc=crypto.encrypt((phone or "").strip() or None),
            phone_index=crypto.blind_index(phone),
            documents=documents,
            status=STATUS_QUEUED,
            created_at=datetime.utcnow(),
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)

        # Kick the sequential worker (no-op if already running).
        await self._ensure_worker()
        return {"id": row.id, "tracking_ref": tracking_ref, "documents": len(documents)}

    # ── Background worker (sequential, one at a time) ───────────────────────────
    async def _ensure_worker(self) -> None:
        async with self._get_worker_lock():
            if self._worker_active:
                return
            self._worker_active = True
        asyncio.create_task(self._worker())

    async def _worker(self) -> None:
        try:
            await self.recover_stale()
            while True:
                sub_id = await self._claim_next_queued()
                if sub_id is None:
                    async with self._get_worker_lock():
                        sub_id = await self._claim_next_queued()
                        if sub_id is None:
                            self._worker_active = False
                            return
                await self._process_one(sub_id)
        except Exception:
            async with self._get_worker_lock():
                self._worker_active = False
            raise

    async def recover_stale(self, max_minutes: int = _STALE_PROCESSING_MIN) -> int:
        """Re-queue rows left PROCESSING by a crash/restart. max_minutes=0 re-queues all."""
        cutoff = datetime.utcnow() - timedelta(minutes=max_minutes)
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                update(ProposalSubmission)
                .where(
                    ProposalSubmission.status == STATUS_PROCESSING,
                    (ProposalSubmission.processed_at.is_(None)) | (ProposalSubmission.processed_at < cutoff),
                )
                .values(status=STATUS_QUEUED, error_message=None)
            )
            await db.commit()
            n = res.rowcount or 0
            if n:
                logger.info("proposal: recovered %d stale PROCESSING row(s) → QUEUED", n)
            return n

    async def _claim_next_queued(self) -> Optional[int]:
        async with AsyncSessionLocal() as db:
            row = await db.scalar(
                select(ProposalSubmission)
                .where(ProposalSubmission.status == STATUS_QUEUED)
                .order_by(ProposalSubmission.created_at, ProposalSubmission.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return None
            row.status = STATUS_PROCESSING
            row.processed_at = datetime.utcnow()
            await db.commit()
            return row.id

    async def _process_one(self, sub_id: int) -> None:
        from src.services.proposal_extraction import ProposalExtractionService
        from src.services.storage_service import get_file_bytes

        logger.info("proposal processing id=%s", sub_id)
        try:
            async with AsyncSessionLocal() as db:
                row = await db.get(ProposalSubmission, sub_id)
                if row is None:
                    return
                docs = row.documents or []
                org_name, category = row.org_name, row.category

            if not docs:
                raise ValueError("No documents attached to proposal.")
            # v1: extract from the primary (first) document. Multi-doc merge is a
            # later enhancement.
            primary = docs[0]
            raw = await asyncio.to_thread(get_file_bytes, primary["storage_url"])
            if raw is None:
                raise FileNotFoundError(f"File missing in storage: {primary['storage_url']}")

            svc = ProposalExtractionService.from_settings()
            loop = asyncio.get_running_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: svc.extract(
                        file_bytes=raw,
                        mime_type=primary["mime_type"],
                        filename=primary["original_filename"],
                        org_name=org_name,
                        category=category,
                    ),
                ),
                timeout=_EXTRACTION_TIMEOUT,
            )

            async with AsyncSessionLocal() as db:
                row = await db.get(ProposalSubmission, sub_id)
                if row is None:
                    return
                row.extraction_json = result.model_dump(mode="json")
                row.document_date = result.document_date
                row.status = STATUS_AWAITING_REVIEW
                row.error_message = None
                row.processed_at = datetime.utcnow()
                await db.commit()
            logger.info("proposal id=%s extracted → AWAITING_REVIEW", sub_id)

        except Exception as exc:
            logger.warning("proposal id=%s extraction FAILED: %s", sub_id, exc)
            try:
                async with AsyncSessionLocal() as db:
                    row = await db.get(ProposalSubmission, sub_id)
                    if row is not None:
                        row.status = STATUS_FAILED
                        row.error_message = str(exc)[:1000]
                        row.processed_at = datetime.utcnow()
                        await db.commit()
            except Exception:
                logger.exception("proposal id=%s: could not mark FAILED", sub_id)


proposal_service = ProposalService()
