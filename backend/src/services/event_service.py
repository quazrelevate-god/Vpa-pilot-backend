"""
Event service — business logic for the /events invitation-calendar PWA.

Upload flow: the photo is stored (MinIO) and the row inserted as QUEUED inside
the request, which returns 201 immediately; extraction then runs as a
fire-and-forget asyncio task (one photo at a time — no batch worker needed,
unlike ai_upload_service). The UI polls until READY/FAILED. A startup sweep
re-spawns anything left QUEUED/PROCESSING by a crash.

Extraction NEVER overwrites a field the user already edited: process_event
only fills columns that are still NULL, so a concurrent PATCH always wins.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time as dtime, timedelta
from secrets import token_hex
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.models.event_models import (
    EVENT_TYPES, InvitationEvent,
    STATUS_FAILED, STATUS_PROCESSING, STATUS_QUEUED, STATUS_READY,
)
from src.services import storage_service

logger = logging.getLogger(__name__)

_ALLOWED_MIMES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
}
_EXTRACT_TIMEOUT_S = 120
_STALE_MINUTES = 15

# Lazily-created singleton — building the Gemini client needs GEMINI_API_KEY,
# which shouldn't be required just to import this module (e.g. for alembic).
_extractor = None


def _get_extractor():
    global _extractor
    if _extractor is None:
        from src.services.event_extraction import InvitationExtractionService
        _extractor = InvitationExtractionService.from_settings()
    return _extractor


# ── Parsing helpers (tolerant — a bad AI value becomes NULL, never an error) ────

def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def _parse_time(value: Optional[str]) -> Optional[dtime]:
    if not value:
        return None
    try:
        h, m = value.strip().split(":")
        return dtime(int(h), int(m))
    except (ValueError, AttributeError):
        return None


def serialize(e: InvitationEvent) -> dict:
    """Wire format for the /events frontend."""
    return {
        "id": e.id,
        "display_title": e.note or e.title or "Untitled",
        "title": e.title,
        "note": e.note,
        "venue": e.venue,
        "event_type": e.event_type,
        "date": e.event_date.isoformat() if e.event_date else None,
        "start_time": e.start_time.strftime("%H:%M") if e.start_time else None,
        "end_time": e.end_time.strftime("%H:%M") if e.end_time else None,
        "status": e.status,
        "error_message": e.error_message,
        "image_url": f"/events/api/files/{e.image_path}",
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


# ── Create + background extraction ──────────────────────────────────────────────

async def create_event(
    db: AsyncSession, *, file_bytes: bytes, mime_type: str,
    note: str, created_by: str,
) -> InvitationEvent:
    """Store the photo, insert a QUEUED row, spawn extraction. Returns the row."""
    mime = (mime_type or "").lower().split(";")[0].strip()
    ext = _ALLOWED_MIMES.get(mime)
    if not ext:
        raise HTTPException(422, f"Unsupported image type: {mime or 'unknown'}")
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(413, f"Image exceeds {settings.MAX_FILE_SIZE_MB} MB limit")
    if not file_bytes:
        raise HTTPException(422, "Empty file")

    key = f"events/{token_hex(16)}{ext}"
    await asyncio.to_thread(storage_service.save_file, file_bytes, key, mime)

    event = InvitationEvent(
        image_path=key,
        image_mime=mime,
        note=(note or "").strip() or None,
        status=STATUS_QUEUED,
        created_by=created_by,
        created_at=datetime.utcnow(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    asyncio.create_task(process_event(event.id))
    return event


async def process_event(event_id: int) -> None:
    """Background: run Gemini extraction and fill still-NULL columns."""
    try:
        async with AsyncSessionLocal() as db:
            event = await db.get(InvitationEvent, event_id)
            if event is None or event.status not in (STATUS_QUEUED, STATUS_PROCESSING):
                return
            event.status = STATUS_PROCESSING
            event.processed_at = datetime.utcnow()   # start marker for stale recovery
            image_path, image_mime = event.image_path, event.image_mime
            await db.commit()

        file_bytes = await asyncio.to_thread(storage_service.get_file_bytes, image_path)
        if not file_bytes:
            raise RuntimeError(f"Stored image not readable: {image_path}")

        svc = _get_extractor()
        result = await asyncio.wait_for(
            asyncio.to_thread(
                svc.extract, file_bytes=file_bytes, mime_type=image_mime,
            ),
            timeout=_EXTRACT_TIMEOUT_S,
        )

        async with AsyncSessionLocal() as db:
            event = await db.get(InvitationEvent, event_id)
            if event is None:
                return  # deleted while processing
            # Only fill fields the user hasn't already set (edit wins over AI).
            if event.title is None:
                event.title = (result.title or result.title_ta or "").strip()[:300] or None
            if event.venue is None:
                event.venue = (result.venue or "").strip()[:300] or None
            if event.event_type is None:
                etype = (result.event_type or "").strip()
                event.event_type = etype if etype in EVENT_TYPES else "other"
            if event.event_date is None:
                event.event_date = _parse_date(result.event_date)
            if event.start_time is None:
                event.start_time = _parse_time(result.start_time)
            if event.end_time is None:
                event.end_time = _parse_time(result.end_time)
            event.extraction_json = result.model_dump()
            event.status = STATUS_READY
            event.error_message = None
            event.processed_at = datetime.utcnow()
            await db.commit()
            logger.info("event %d extracted | date=%s type=%s", event_id,
                        event.event_date, event.event_type)

    except Exception as exc:
        logger.error("event %d extraction failed: %s", event_id, exc)
        try:
            async with AsyncSessionLocal() as db:
                event = await db.get(InvitationEvent, event_id)
                if event is not None and event.status != STATUS_READY:
                    event.status = STATUS_FAILED
                    event.error_message = str(exc)[:1000]
                    event.processed_at = datetime.utcnow()
                    await db.commit()
        except Exception:
            logger.exception("event %d: could not record failure", event_id)


async def recover_stale() -> int:
    """Startup: re-spawn extraction for rows left QUEUED/PROCESSING by a crash."""
    cutoff = datetime.utcnow() - timedelta(minutes=_STALE_MINUTES)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(InvitationEvent.id).where(
                InvitationEvent.status.in_([STATUS_QUEUED, STATUS_PROCESSING]),
                InvitationEvent.created_at < cutoff,
            )
        )
        ids = [row[0] for row in result.all()]
        # Flip PROCESSING back to QUEUED so process_event picks them up.
        for eid in ids:
            event = await db.get(InvitationEvent, eid)
            if event and event.status == STATUS_PROCESSING:
                event.status = STATUS_QUEUED
        await db.commit()
    for eid in ids:
        asyncio.create_task(process_event(eid))
    if ids:
        logger.info("events: recovered %d stale row(s)", len(ids))
    return len(ids)


# ── Queries ─────────────────────────────────────────────────────────────────────

async def list_events(db: AsyncSession, start: date, end: date) -> list[InvitationEvent]:
    result = await db.execute(
        select(InvitationEvent)
        .where(InvitationEvent.event_date >= start, InvitationEvent.event_date <= end)
        .order_by(InvitationEvent.event_date,
                  InvitationEvent.start_time.asc().nulls_first(),
                  InvitationEvent.id)
    )
    return list(result.scalars().all())


async def list_needs_review(db: AsyncSession) -> list[InvitationEvent]:
    """FAILED / still-processing / READY-but-undated rows, newest first."""
    result = await db.execute(
        select(InvitationEvent)
        .where(
            (InvitationEvent.event_date.is_(None))
            | (InvitationEvent.status != STATUS_READY)
        )
        .order_by(InvitationEvent.created_at.desc())
    )
    return list(result.scalars().all())


async def get_event(db: AsyncSession, event_id: int) -> InvitationEvent:
    event = await db.get(InvitationEvent, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    return event


# ── Mutations ───────────────────────────────────────────────────────────────────

_EDITABLE_TEXT = {"title": 300, "venue": 300}


async def update_event(db: AsyncSession, event_id: int, payload: dict) -> InvitationEvent:
    """Whitelisted PATCH. Empty string clears a field to NULL."""
    event = await get_event(db, event_id)

    for key, max_len in _EDITABLE_TEXT.items():
        if key in payload:
            value = (payload[key] or "").strip()
            setattr(event, key, value[:max_len] or None)
    if "note" in payload:
        event.note = (payload["note"] or "").strip() or None
    if "event_type" in payload:
        etype = (payload["event_type"] or "").strip()
        if etype and etype not in EVENT_TYPES:
            raise HTTPException(400, f"event_type must be one of {', '.join(EVENT_TYPES)}")
        event.event_type = etype or None
    if "event_date" in payload:
        raw = (payload["event_date"] or "").strip()
        if raw:
            parsed = _parse_date(raw)
            if parsed is None:
                raise HTTPException(400, "event_date must be YYYY-MM-DD")
            event.event_date = parsed
        else:
            event.event_date = None
    for key in ("start_time", "end_time"):
        if key in payload:
            raw = (payload[key] or "").strip()
            if raw:
                parsed = _parse_time(raw)
                if parsed is None:
                    raise HTTPException(400, f"{key} must be HH:MM (24-hour)")
                setattr(event, key, parsed)
            else:
                setattr(event, key, None)

    # A manual date on a FAILED row resolves it — no retry needed.
    if event.status == STATUS_FAILED and event.event_date is not None:
        event.status = STATUS_READY
        event.error_message = None

    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(db: AsyncSession, event_id: int) -> None:
    event = await get_event(db, event_id)
    image_path = event.image_path
    await db.delete(event)
    await db.commit()
    try:
        await asyncio.to_thread(storage_service.delete_file, image_path)
    except Exception as exc:  # best-effort — the row is already gone
        logger.warning("event %d: image cleanup failed for %s: %s",
                       event_id, image_path, exc)


async def retry_event(db: AsyncSession, event_id: int) -> InvitationEvent:
    event = await get_event(db, event_id)
    if event.status != STATUS_FAILED:
        raise HTTPException(409, "Only failed events can be retried")
    event.status = STATUS_QUEUED
    event.error_message = None
    await db.commit()
    await db.refresh(event)
    asyncio.create_task(process_event(event.id))
    return event
