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
from src.core.timeutil import now_utc
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


# ── Layer-1B dedup helpers ─────────────────────────────────────────────────
import hashlib as _hashlib
import re as _re


def _normalise_for_fingerprint(text: Optional[str]) -> str:
    """Lowercase, strip punctuation/whitespace runs — collapses trivial
    formatting drift ('Please repair!' vs 'please repair.') so an identical
    proposal doesn't slip through the fingerprint check on cosmetic changes."""
    if not text:
        return ""
    s = text.lower()
    # Keep Latin + Tamil letters + digits + spaces. Strip everything else.
    s = _re.sub(r"[^\w\s஀-௿]", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    return s


def _proposal_fingerprint(org_name: Optional[str], title: Optional[str], ask: Optional[str]) -> str:
    """sha1( org|title|normalised_ask ) — the Layer-1B fingerprint we look up
    within the 90-day dedup window. sha1 is enough here (collision resistance
    isn't a security goal; we just need a stable equality key)."""
    parts = "|".join([
        _normalise_for_fingerprint(org_name),
        _normalise_for_fingerprint(title),
        _normalise_for_fingerprint(ask),
    ])
    return _hashlib.sha1(parts.encode("utf-8")).hexdigest()


_DEDUP_WINDOW_DAYS = 90


# ── Layer-2 helpers — trigram similarity for reviewer-triggered Find Similar ─
def _trigram_set(s: str) -> set[str]:
    if len(s) < 3:
        return {s} if s else set()
    return {s[i:i + 3] for i in range(len(s) - 2)}


def _similarity(a: str, b: str) -> float:
    """Trigram Jaccard, mirrors petition_merge_service._similarity."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    A, B = _trigram_set(a), _trigram_set(b)
    if not A or not B:
        return 0.0
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 0.0


async def find_similar_proposals(
    db: AsyncSession,
    proposal_id: int,
    *,
    limit: int = 10,
    min_score: float = 0.50,
) -> Dict[str, Any]:
    """Reviewer-triggered fuzzy dedup — Layer 2.

    Read-only: returns candidate similar proposals for `proposal_id`.
    Blocks by same category (desk), then trigram-Jaccard scores the
    normalised problem_statement + title against each candidate, keeping
    only those at or above `min_score`.

    Mirrors petition_merge_service.find_similar in shape so the drawer UI
    can render the same panel for either surface. Never mutates — the PA
    decides.
    """
    src = await db.get(ProposalSubmission, proposal_id)
    if src is None:
        return {"source": None, "candidates": [], "reason": "Proposal not found."}

    ej = src.extraction_json or {}
    src_title = ej.get("title") or ""
    src_problem = ej.get("problem_statement") or ""
    src_norm = _normalise_for_fingerprint(src_title + " " + src_problem)
    if not src_norm:
        return {
            "source": {"id": src.id, "tracking_ref": src.tracking_ref},
            "candidates": [],
            "reason": "No extracted title/problem yet to compare against.",
        }

    # Block by category (desk). Same-desk proposals compete for the same
    # decision surface, so that's the sensible bucket.
    # PERFORMANCE: pull ONLY scoring + display columns and extract title +
    # problem_statement from JSONB in SQL — loading full extraction_json on
    # every candidate blew request payloads past 2 MB on ~500-row buckets.
    stmt = (
        select(
            ProposalSubmission.id.label("id"),
            ProposalSubmission.tracking_ref.label("tracking_ref"),
            ProposalSubmission.org_name.label("org_name"),
            ProposalSubmission.status.label("status"),
            ProposalSubmission.created_at.label("created_at"),
            ProposalSubmission.extraction_json["title"].astext.label("title"),
            ProposalSubmission.extraction_json["problem_statement"].astext.label("problem"),
        )
        .where(ProposalSubmission.id != src.id)
        .where(ProposalSubmission.extraction_json.isnot(None))
    )
    if src.category:
        stmt = stmt.where(ProposalSubmission.category == src.category)
    # Safety cap — same rationale as the association side: O(n) Python
    # scoring; ~2s at 500 rows. Newest-first so the cap keeps the most
    # actionable candidates if the desk ever holds thousands.
    stmt = stmt.order_by(ProposalSubmission.created_at.desc()).limit(500)
    candidates = list((await db.execute(stmt)).all())

    scored: List[Dict[str, Any]] = []
    for c in candidates:
        cnorm = _normalise_for_fingerprint((c.title or "") + " " + (c.problem or ""))
        score = _similarity(src_norm, cnorm)
        if score >= min_score:
            scored.append({
                "id": c.id,
                "tracking_ref": c.tracking_ref,
                "title": c.title or None,
                "org_name": c.org_name,
                "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "score": round(score, 3),
            })
    scored.sort(key=lambda x: x["score"], reverse=True)
    scored = scored[:limit]
    return {
        "source": {
            "id": src.id, "tracking_ref": src.tracking_ref,
            "title": src_title, "org_name": src.org_name, "category": src.category,
        },
        "candidates": scored,
        "reason": None if scored else "No similar proposals found in this desk.",
    }

# Intake limits — aligned to what Gemini can actually extract inline.
#
# The extraction service sends each proposal document as a single
# Part.from_bytes(...) inline attachment; Google's Gemini inline transport
# caps the total request size at ~20 MB. A larger file passes the server but
# then silently fails at Gemini with an opaque error. Keeping the per-file
# cap at 20 MB means every accepted file is one the extractor can actually
# read. If a future proposal needs larger files, switch to the Files API
# (client.files.upload) — that path supports up to 2 GB per file but
# requires additional lifecycle management.
_ALLOWED_MIMES = {"application/pdf"}
_MAX_FILES = 5
_MAX_BYTES = 20 * 1024 * 1024
_MAX_REQUEST_BYTES = 60 * 1024 * 1024

_EXTRACTION_TIMEOUT = 90        # seconds — one hung Gemini call can't stall the queue
_STALE_PROCESSING_MIN = 10      # re-queue rows stuck PROCESSING longer than this

# Category → tracking-ref prefix (matches the /proposal form desks).
_PREFIX = {"school": "SCH", "tamil": "TAM", "information": "INF", "film": "FLM"}


def _mint_tracking_ref(category: Optional[str]) -> str:
    key = _PREFIX.get((category or "").strip().lower(), "GEN")
    token = secrets.token_hex(3).upper()[:5]
    return f"NK/{key}/{now_utc().year}/{token}"


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
        from src.core.config import settings as _settings
        from sqlalchemy import func as _func

        valid = [f for f in files if f and f.filename]
        if not valid:
            raise HTTPException(status_code=400, detail="At least one proposal document (PDF) is required.")
        if len(valid) > _MAX_FILES:
            raise HTTPException(status_code=400, detail=f"Maximum {_MAX_FILES} documents per submission.")

        # ── Layer-1 ingress guard: one proposal per phone per day ─────────────
        # Mirror of ONE_PETITION_PER_DAY on the citizen QR form. A phone that
        # already submitted a proposal today gets a 409 instead of another
        # row in the reviewer queue. Gated by env flag so QA can iterate.
        # Applied BEFORE any storage write so a duplicate never touches MinIO.
        phone_idx = crypto.blind_index(phone)
        if _settings.ONE_PROPOSAL_PER_DAY and phone_idx:
            from datetime import timedelta as _td
            today_start = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
            existing_today = await db.scalar(
                select(_func.count(ProposalSubmission.id))
                .where(ProposalSubmission.phone_index == phone_idx)
                .where(ProposalSubmission.created_at >= today_start)
            ) or 0
            if existing_today > 0:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "ALREADY_SUBMITTED_TODAY",
                        "en": (
                            "A proposal from this phone number was already submitted today. "
                            "We've received it and it is being reviewed. Please try again "
                            "tomorrow if you have a different proposal to share."
                        ),
                        "ta": (
                            "இந்த தொலைபேசி எண்ணிலிருந்து ஒரு முன்மொழிவு இன்று ஏற்கனவே "
                            "சமர்ப்பிக்கப்பட்டுள்ளது. அது ஏற்கப்பட்டு பரிசீலிக்கப்படுகிறது. "
                            "வேறு முன்மொழிவு இருந்தால் நாளை மறுபடியும் முயற்சிக்கவும்."
                        ),
                    },
                )

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
            # Magic-byte check: browsers can be told to send any Content-Type,
            # so the MIME above is not enough. A real PDF starts with "%PDF-".
            # Reject anything that lies about its shape — cheap defence against
            # renamed .docx / .pptx / arbitrary blobs riding a PDF header.
            if not raw.startswith(b"%PDF-"):
                raise HTTPException(
                    status_code=400,
                    detail=f"'{f.filename}' isn't a valid PDF. Please convert your document to PDF and try again.",
                )
            total += len(raw)
            if total > _MAX_REQUEST_BYTES:
                raise HTTPException(status_code=400, detail="Upload too large — send fewer / smaller documents.")
            safe = appointment_service._sanitize_filename(f.filename)
            rel = f"proposals/{tracking_ref.replace('/', '_')}/{secrets.token_hex(6)}_{safe}"
            storage_url = await asyncio.to_thread(save_file, raw, rel, mime)
            documents.append({"original_filename": f.filename, "storage_url": storage_url, "mime_type": mime})

        submit_time = now_utc()
        row = ProposalSubmission(
            tracking_ref=tracking_ref,
            category=(category or "").strip().lower() or None,
            org_name=(org_name or "").strip()[:300] or None,
            person_name=(person_name or "").strip()[:200] or None,
            designation=(designation or "").strip()[:200] or None,
            email_enc=crypto.encrypt((email or "").strip() or None),
            phone_enc=crypto.encrypt((phone or "").strip() or None),
            phone_index=phone_idx,
            documents=documents,
            status=STATUS_QUEUED,
            created_at=submit_time,
            # Seed document_date to the submit date so a doc-date filter
            # always finds the row even before extraction runs. The async
            # worker at line 244 overwrites this with the printed date if
            # extraction finds one on the uploaded PDF (more accurate for
            # proposals dated earlier than the submit day).
            document_date=submit_time.date().isoformat(),
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
        cutoff = now_utc() - timedelta(minutes=max_minutes)
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
            row.processed_at = now_utc()
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
                # Only overwrite the seeded submit-date if extraction actually
                # read a printed date off the PDF (more accurate). An empty
                # result.document_date must NOT null out the seed we set at
                # form-submit time — the row would drop off any doc-date
                # filter otherwise.
                if result.document_date:
                    row.document_date = result.document_date

                # ── Layer-1B: compute + check fingerprint ──────────────────
                # sha1(org|title|normalised_ask). Look up matches in the
                # 90-day rolling window. On hit, SOFT-flag (never refuse) so
                # the row still lands in review — the drawer surfaces a
                # "Duplicate of TKT-XXX" pill and the reviewer decides.
                fp = _proposal_fingerprint(
                    row.org_name,
                    getattr(result, "title", None) or (result.model_dump(mode="json").get("title")),
                    # `citizen_ask` isn't on ProposalExtraction; use the ask-
                    # analog fields the schema exposes. `problem_statement`
                    # gives the most stable signal — the pitch's core problem
                    # — versus title (marketing) or estimated_cost (varies).
                    getattr(result, "problem_statement", None),
                )
                row.dedup_fingerprint = fp
                window_start = now_utc() - timedelta(days=_DEDUP_WINDOW_DAYS)
                earlier = await db.scalar(
                    select(ProposalSubmission)
                    .where(ProposalSubmission.dedup_fingerprint == fp)
                    .where(ProposalSubmission.id != row.id)
                    .where(ProposalSubmission.created_at >= window_start)
                    .order_by(ProposalSubmission.created_at.asc())
                    .limit(1)
                )
                if earlier is not None:
                    row.is_duplicate = True
                    row.duplicate_of_id = earlier.id
                    logger.info(
                        "proposal id=%s → SOFT-FLAG duplicate_of proposal id=%s (fp=%s)",
                        row.id, earlier.id, fp[:12],
                    )

                row.status = STATUS_AWAITING_REVIEW
                row.error_message = None
                row.processed_at = now_utc()
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
                        row.processed_at = now_utc()
                        await db.commit()
            except Exception:
                logger.exception("proposal id=%s: could not mark FAILED", sub_id)


proposal_service = ProposalService()
