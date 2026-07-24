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


_SENTINEL_IMAGE = "events/manual"


def serialize(e: InvitationEvent) -> dict:
    """Wire format for the /events frontend.

    Ships both language variants (title_en/title_ta, venue_en/venue_ta,
    raw_summary_en/raw_summary_ta) so the EN/TA toggle can render either
    side without a re-fetch. `note` — PA's manual annotation — takes display
    priority over the extracted title (same rule as before).
    """
    has_photo = e.image_path != _SENTINEL_IMAGE
    ej = e.extraction_json or {}
    title_en = e.title_en or (e.title if _looks_ascii(e.title) else "") or ""
    title_ta = e.title_ta or (e.title if not _looks_ascii(e.title) else "") or ""
    venue_en = e.venue_en or (e.venue if _looks_ascii(e.venue) else "") or ""
    venue_ta = e.venue_ta or (e.venue if not _looks_ascii(e.venue) else "") or ""
    return {
        "id": e.id,
        "display_title": e.note or title_en or title_ta or e.title or "Untitled",
        # Bilingual pairs — frontend picks by active lang, falls back to the
        # non-empty side so a one-sided edit still renders on the other tab.
        "title_en": title_en,
        "title_ta": title_ta,
        "venue_en": venue_en,
        "venue_ta": venue_ta,
        "raw_summary_en": ej.get("raw_summary_en") or ej.get("raw_summary") or "",
        "raw_summary_ta": ej.get("raw_summary_ta") or "",
        # Legacy single-language mirrors — kept so any existing consumer still
        # sees a value. Newer callers should use the _en/_ta pairs above.
        "title": e.title or title_en or title_ta,
        "venue": e.venue or venue_en or venue_ta,
        "note": e.note,
        "event_type": e.event_type,
        "date": e.event_date.isoformat() if e.event_date else None,
        "start_time": e.start_time.strftime("%H:%M") if e.start_time else None,
        "end_time": e.end_time.strftime("%H:%M") if e.end_time else None,
        "status": e.status,
        "attendance": e.attendance,   # "attended" | "not_attended" | null
        "error_message": e.error_message,
        "image_url": f"/events/api/files/{e.image_path}" if has_photo else None,
        "has_photo": has_photo,
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_by": e.updated_by,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _looks_ascii(s: Optional[str]) -> bool:
    """Rough heuristic to sort a legacy `title`/`venue` into the EN or TA slot
    for old rows written before the bilingual columns existed. Empty / None
    counts as ASCII (harmless — resolves to empty)."""
    return not s or all(ord(c) < 128 for c in s)


# ── Create + background extraction ──────────────────────────────────────────────

async def create_manual_event(
    db: AsyncSession,
    *,
    title: str,
    venue: str,
    event_type: str,
    event_date: str,
    start_time: str,
    end_time: str,
    note: str,
    file_bytes: Optional[bytes],
    mime_type: str,
    created_by: str,
    title_en: str = "",
    title_ta: str = "",
    venue_en: str = "",
    venue_ta: str = "",
) -> InvitationEvent:
    """Create an event manually (no OCR). Saved immediately as READY.

    Accepts either the bilingual pairs (title_en/title_ta, venue_en/venue_ta)
    from the newer form or the legacy single `title`/`venue` fields — a legacy
    value populates whichever side matches the script it was typed in, so an
    older client keeps working while the toggle UI catches up.

    Photo is optional — when omitted, image_path is set to a sentinel value
    ("events/manual") so the column stays NOT NULL per the schema constraint,
    and the frontend hides the photo tab for rows with that sentinel.
    """
    # Coalesce legacy `title`/`venue` into whichever bilingual side matches
    # its script, so the form works whether it sends the new or old shape.
    legacy_title = (title or "").strip()
    legacy_venue = (venue or "").strip()
    title_en = (title_en or "").strip()
    title_ta = (title_ta or "").strip()
    venue_en = (venue_en or "").strip()
    venue_ta = (venue_ta or "").strip()
    if legacy_title and not (title_en or title_ta):
        if _looks_ascii(legacy_title): title_en = legacy_title
        else:                          title_ta = legacy_title
    if legacy_venue and not (venue_en or venue_ta):
        if _looks_ascii(legacy_venue): venue_en = legacy_venue
        else:                          venue_ta = legacy_venue
    if not (title_en or title_ta):
        raise HTTPException(422, "title (or title_en / title_ta) is required")
    if not (venue_en or venue_ta):
        raise HTTPException(422, "venue (or venue_en / venue_ta) is required")

    etype = (event_type or "").strip()
    if not etype or etype not in EVENT_TYPES:
        raise HTTPException(422, f"event_type must be one of: {', '.join(EVENT_TYPES)}")
    parsed_date = _parse_date((event_date or "").strip())
    if parsed_date is None:
        raise HTTPException(422, "event_date is required and must be YYYY-MM-DD")
    parsed_start = _parse_time((start_time or "").strip())
    if parsed_start is None:
        raise HTTPException(422, "start_time is required and must be HH:MM")

    parsed_end = _parse_time((end_time or "").strip()) if end_time else None

    # Optional photo
    image_key = "events/manual"
    image_mime_stored = "image/jpeg"
    if file_bytes:
        mime = (mime_type or "").lower().split(";")[0].strip()
        ext = _ALLOWED_MIMES.get(mime)
        if not ext:
            raise HTTPException(422, f"Unsupported image type: {mime or 'unknown'}")
        max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
        if len(file_bytes) > max_bytes:
            raise HTTPException(413, f"Image exceeds {settings.MAX_FILE_SIZE_MB} MB limit")
        image_key = f"events/{token_hex(16)}{ext}"
        image_mime_stored = mime
        await asyncio.to_thread(storage_service.save_file, file_bytes, image_key, mime)

    # Legacy `title`/`venue` mirror — keep EN preferred so old consumers see
    # the same string they saw before the split.
    primary_title = (title_en or title_ta)[:300]
    primary_venue = (venue_en or venue_ta)[:300]

    event = InvitationEvent(
        image_path=image_key,
        image_mime=image_mime_stored,
        title=primary_title,
        title_en=title_en[:300] or None,
        title_ta=title_ta[:300] or None,
        venue=primary_venue,
        venue_en=venue_en[:300] or None,
        venue_ta=venue_ta[:300] or None,
        event_type=etype,
        event_date=parsed_date,
        start_time=parsed_start,
        end_time=parsed_end,
        note=(note or "").strip() or None,
        status=STATUS_READY,
        created_by=created_by,
        created_at=datetime.utcnow(),
        processed_at=datetime.utcnow(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    logger.info("manual event %d created | date=%s type=%s", event.id, event.event_date, event.event_type)
    return event


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
            # Bilingual pair: extraction always produces BOTH sides; fill each
            # side independently so a partial manual edit on one language is
            # preserved.
            r_title_en = (result.title_en or "").strip()[:300] or None
            r_title_ta = (result.title_ta or "").strip()[:300] or None
            r_venue_en = (result.venue_en or "").strip()[:300] or None
            r_venue_ta = (result.venue_ta or "").strip()[:300] or None
            if event.title_en is None: event.title_en = r_title_en
            if event.title_ta is None: event.title_ta = r_title_ta
            if event.venue_en is None: event.venue_en = r_venue_en
            if event.venue_ta is None: event.venue_ta = r_venue_ta
            # Legacy single-language mirror — keep prefer-EN convention so old
            # consumers of `title` don't suddenly see Tamil (that column was
            # always the "primary display" pre-refactor).
            if event.title is None:
                event.title = r_title_en or r_title_ta
            if event.venue is None:
                event.venue = r_venue_en or r_venue_ta
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
            logger.info("event %d extracted | date=%s type=%s | en=%r ta=%r",
                        event_id, event.event_date, event.event_type,
                        (event.title_en or "")[:40], (event.title_ta or "")[:40])

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
    """Startup: re-spawn extraction for rows a previous run never finished.

    Two distinct cases — both need reviving, on different rules:
      * QUEUED   — the row was created but never began processing (the
        server died before its task fired, or crashed in `create_event`
        between the DB commit and `asyncio.create_task`). Pick ALL of them
        regardless of age; a QUEUED row is by definition idle.
      * PROCESSING — extraction started but never finished. Only re-run when
        `processed_at` is older than _STALE_MINUTES so we don't step on a
        legitimate in-flight extraction from another worker (or the current
        process, if a re-run of this sweep happens).
    Before the fix, both statuses shared a `created_at < cutoff` window,
    which meant a QUEUED row uploaded 1 minute before a restart sat idle
    for 15 minutes AND needed a second restart to get picked up.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=_STALE_MINUTES)
    async with AsyncSessionLocal() as db:
        queued = await db.execute(
            select(InvitationEvent.id).where(InvitationEvent.status == STATUS_QUEUED)
        )
        stuck = await db.execute(
            select(InvitationEvent.id).where(
                InvitationEvent.status == STATUS_PROCESSING,
                # processed_at is stamped when PROCESSING starts, so it's the
                # right stale gauge (created_at could be days old on a slow-
                # moving row that got claimed just now).
                (InvitationEvent.processed_at.is_(None))
                | (InvitationEvent.processed_at < cutoff),
            )
        )
        queued_ids = [row[0] for row in queued.all()]
        stuck_ids  = [row[0] for row in stuck.all()]
        # Flip stuck PROCESSING rows back to QUEUED so process_event picks
        # them up cleanly (its own guard requires QUEUED/PROCESSING).
        for eid in stuck_ids:
            event = await db.get(InvitationEvent, eid)
            if event and event.status == STATUS_PROCESSING:
                event.status = STATUS_QUEUED
        await db.commit()
    ids = queued_ids + stuck_ids
    for eid in ids:
        asyncio.create_task(process_event(eid))
    if ids:
        logger.info(
            "events: recovered %d row(s) (queued=%d, stuck=%d)",
            len(ids), len(queued_ids), len(stuck_ids),
        )
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


_NEEDS_REVIEW_DAYS = 30
_NEEDS_REVIEW_HARD_LIMIT = 200


async def list_needs_review(db: AsyncSession) -> list[InvitationEvent]:
    """FAILED / still-processing / READY-but-undated rows, newest first.

    Rolling 30-day window (by created_at) plus a hard LIMIT so a stale pile
    of old undated invitations can never balloon this endpoint into a full-
    table scan. Anything genuinely older can still be found via the calendar
    date navigator; the Needs-Review tab is a to-do queue, not archival.
    """
    cutoff = datetime.utcnow() - timedelta(days=_NEEDS_REVIEW_DAYS)
    result = await db.execute(
        select(InvitationEvent)
        .where(
            (InvitationEvent.event_date.is_(None))
            | (InvitationEvent.status != STATUS_READY)
        )
        .where(InvitationEvent.created_at >= cutoff)
        .order_by(InvitationEvent.created_at.desc())
        .limit(_NEEDS_REVIEW_HARD_LIMIT)
    )
    return list(result.scalars().all())


async def get_event(db: AsyncSession, event_id: int) -> InvitationEvent:
    event = await db.get(InvitationEvent, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    return event


# ── Mutations ───────────────────────────────────────────────────────────────────

_EDITABLE_TEXT = {
    "title":    300, "title_en": 300, "title_ta": 300,
    "venue":    300, "venue_en": 300, "venue_ta": 300,
}


async def update_event(
    db: AsyncSession, event_id: int, payload: dict,
    *, updated_by: Optional[str] = None,
) -> InvitationEvent:
    """Whitelisted PATCH. Empty string clears a field to NULL.

    Accepts bilingual keys (title_en/title_ta, venue_en/venue_ta) as well as
    the legacy `title`/`venue` — a legacy edit is also mirrored into whichever
    bilingual side matches its script, so a single-language client stays
    consistent with the toggle UI.
    """
    event = await get_event(db, event_id)

    for key, max_len in _EDITABLE_TEXT.items():
        if key in payload:
            value = (payload[key] or "").strip()
            setattr(event, key, value[:max_len] or None)
    # Legacy edits: also mirror into the bilingual slot for that script — a
    # PATCH sending only `title` used to be lossy against the new columns.
    if "title" in payload and not ("title_en" in payload or "title_ta" in payload):
        v = (payload["title"] or "").strip()
        if v:
            if _looks_ascii(v): event.title_en = v[:300]
            else:               event.title_ta = v[:300]
    if "venue" in payload and not ("venue_en" in payload or "venue_ta" in payload):
        v = (payload["venue"] or "").strip()
        if v:
            if _looks_ascii(v): event.venue_en = v[:300]
            else:               event.venue_ta = v[:300]
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

    # Attendance — three-state; empty string clears back to NULL.
    if "attendance" in payload:
        raw = (payload["attendance"] or "").strip().lower()
        if raw in ("", "null", "none"):
            event.attendance = None
        elif raw in ("attended", "not_attended"):
            event.attendance = raw
        else:
            raise HTTPException(400, "attendance must be 'attended', 'not_attended' or empty")

    # A manual date on a FAILED row resolves it — no retry needed.
    if event.status == STATUS_FAILED and event.event_date is not None:
        event.status = STATUS_READY
        event.error_message = None

    event.updated_at = datetime.utcnow()
    if updated_by:
        event.updated_by = updated_by[:100]
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
