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
import os
from urllib.parse import quote
import logging
from datetime import date, datetime, time as dtime, timedelta, timezone
from src.core.timeutil import now_utc
from secrets import token_hex
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
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
# Audio formats the MediaRecorder API on Chrome / Safari / Firefox actually
# emits by default. Gemini 1.5+ accepts all of these as inline_data parts.
_ALLOWED_AUDIO_MIMES = {
    "audio/webm":  ".webm",
    "audio/ogg":   ".ogg",
    "audio/mp4":   ".m4a",
    "audio/mpeg":  ".mp3",
    "audio/wav":   ".wav",
    "audio/x-wav": ".wav",
    "audio/aac":   ".aac",
}
_EXTRACT_TIMEOUT_S = 120
_STALE_MINUTES = 15

# Bound concurrent Gemini extractions. process_event is fired as an unbounded
# create_task per photo (a 30-card batch = 30 tasks), which would otherwise hit
# the tier's RPS ceiling and rack up cost. Tasks still enqueue immediately; only
# this many run the extraction at once. Sized via EVENT_EXTRACT_MAX_CONCURRENCY.
_EVENT_EXTRACT_GATE = asyncio.Semaphore(max(1, int(os.getenv("EVENT_EXTRACT_MAX_CONCURRENCY", "4"))))

# Strong refs to detached extraction tasks. asyncio holds only a WEAK ref to a
# bare create_task() result, so a fire-and-forget process_event task can be
# garbage-collected mid-run — leaving its row stuck QUEUED/PROCESSING (the UI
# then spins "Extracting…" forever) until a server restart re-runs
# recover_stale. Keep the task referenced until it completes.
_BG_TASKS: set = set()


def _spawn_bg(coro):
    """create_task that survives GC — see _BG_TASKS."""
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return task
# Audio > 60s starts to feel long for a "speak the event" input. 90s is our
# voluntary cap on the frontend recorder — long enough for a rambling PA to
# describe the entire card without hitting Gemini's larger multi-minute limits.
_MAX_AUDIO_SECONDS_SOFT = 90

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

# IST wall-clock time for the today/future gate on approve. The server runs
# UTC; if we compared against UTC's today() an IST evening could land on the
# previous UTC date and let a past-in-IST event still be approvable.
_IST_TZ = timezone(timedelta(hours=5, minutes=30))


def _ist_today() -> date:
    return datetime.now(_IST_TZ).date()


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
        # is_approved doubles as the attendance flag (see model). True = the
        # Minister attended / is committed to attend. False = not attended.
        # The calendar renders every event; this flag is a marker, not a gate.
        "is_approved": bool(e.is_approved),
        "approved_by": e.approved_by,
        "approved_at": e.approved_at.isoformat() if e.approved_at else None,
        "error_message": e.error_message,
        # Voice-created events keep the sentinel image_path; the audio blob
        # replaces the photo. The drawer decides which player to show based
        # on `has_audio` / `has_photo`.
        "has_audio": bool(e.audio_path),
        "audio_url": f"/events/api/files/{quote(e.audio_path, safe='/')}" if e.audio_path else None,
        "transcript_ta": e.transcript_ta or "",
        "transcript_en": e.transcript_en or "",
        "image_url": f"/events/api/files/{quote(e.image_path, safe='/')}" if has_photo else None,
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
    # Start time is required (the WeekView timeline needs a slot to render
    # against). End time is optional — many invitations only announce a
    # start ("6 PM at SRM Mahal"); mandating a made-up end just forced the
    # reviewer to invent one. If missing, the drawer / calendar just render
    # the start-only form.
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
        created_at=now_utc(),
        processed_at=now_utc(),
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
        created_at=now_utc(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    _spawn_bg(process_event(event.id))
    return event


async def create_voice_event(
    db: AsyncSession, *, audio_bytes: bytes, mime_type: str,
    note: str, created_by: str,
) -> InvitationEvent:
    """Voice-capture path: PA speaks the event into the phone.

    Flow:
      1. Validate + persist the audio blob (MinIO under events/<hex>.<ext>).
      2. One Gemini call: audio → transcript_ta + transcript_en + structured
         event fields (title, venue, date, times, type, summary). Same
         InvitationExtraction schema as the photo path.
      3. Insert the row directly as READY (extraction ran synchronously —
         no worker, no polling; the whole thing is a few seconds and the
         user is holding the phone).

    Photo events use image_path + async worker; voice events use audio_path
    and run extraction inline. The `image_path` column stays set to the
    manual sentinel so the NOT-NULL constraint doesn't fail.

    Was previously a two-hop Sarvam-STT-then-Gemini pipeline; Sarvam upstream
    was throttling / 502ing and doubling latency. Gemini 1.5+ handles audio
    natively so one call is enough.
    """
    mime = (mime_type or "").lower().split(";")[0].strip()
    ext = _ALLOWED_AUDIO_MIMES.get(mime)
    if not ext:
        raise HTTPException(422, f"Unsupported audio type: {mime or 'unknown'}")
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(audio_bytes) > max_bytes:
        raise HTTPException(413, f"Audio exceeds {settings.MAX_FILE_SIZE_MB} MB limit")
    if not audio_bytes:
        raise HTTPException(422, "Empty audio")

    # ── 1) persist audio ───────────────────────────────────────────────────
    key = f"events/{token_hex(16)}{ext}"
    await asyncio.to_thread(storage_service.save_file, audio_bytes, key, mime)

    # ── 2) Gemini: transcribe + extract in one call ────────────────────────
    svc = _get_extractor()
    def _do_extract():
        return svc.extract_from_audio(
            audio_bytes=audio_bytes,
            mime_type=mime,
            note=(note or "").strip(),
        )
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_do_extract), timeout=_EXTRACT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Voice extraction timed out")

    transcript_ta = (result.transcript_ta or "").strip()
    transcript_en = (result.transcript_en or "").strip()
    if not (transcript_ta or transcript_en):
        # Gemini couldn't hear anything intelligible — treat as user error so
        # the frontend shows the retry toast instead of a silent success.
        raise HTTPException(422, "Could not hear anything in the audio — try again.")

    # ── 4) insert row (READY — same as manual create) ──────────────────────
    r_title_en = (result.title_en or "").strip()[:300] or None
    r_title_ta = (result.title_ta or "").strip()[:300] or None
    r_venue_en = (result.venue_en or "").strip()[:300] or None
    r_venue_ta = (result.venue_ta or "").strip()[:300] or None
    etype = (result.event_type or "").strip()
    event = InvitationEvent(
        # image_path stays as the sentinel so serialize's has_photo returns
        # false — the drawer will show the audio player instead of a photo.
        image_path=_SENTINEL_IMAGE,
        image_mime="audio/*",
        audio_path=key,
        audio_mime=mime,
        transcript_ta=transcript_ta or None,
        transcript_en=transcript_en or None,
        title=r_title_en or r_title_ta,
        title_en=r_title_en,
        title_ta=r_title_ta,
        venue=r_venue_en or r_venue_ta,
        venue_en=r_venue_en,
        venue_ta=r_venue_ta,
        event_type=(etype if etype in EVENT_TYPES else "other"),
        event_date=_parse_date(result.event_date),
        start_time=_parse_time(result.start_time),
        end_time=_parse_time(result.end_time),
        note=(note or "").strip() or None,
        status=STATUS_READY,
        error_message=None,
        extraction_json=result.model_dump(),
        created_by=created_by,
        created_at=now_utc(),
        processed_at=now_utc(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    logger.info(
        "voice event %d created | date=%s type=%s | en=%r ta=%r",
        event.id, event.event_date, event.event_type,
        (event.title_en or "")[:40], (event.title_ta or "")[:40],
    )
    return event


async def process_event(event_id: int) -> None:
    """Background: run Gemini extraction and fill still-NULL columns."""
    try:
        async with AsyncSessionLocal() as db:
            event = await db.get(InvitationEvent, event_id)
            if event is None or event.status not in (STATUS_QUEUED, STATUS_PROCESSING):
                return
            event.status = STATUS_PROCESSING
            event.processed_at = now_utc()   # start marker for stale recovery
            image_path, image_mime = event.image_path, event.image_mime
            await db.commit()

        file_bytes = await asyncio.to_thread(storage_service.get_file_bytes, image_path)
        if not file_bytes:
            raise RuntimeError(f"Stored image not readable: {image_path}")

        svc = _get_extractor()
        # Hold a global permit only for the expensive Gemini call so a big batch
        # can't fan out unbounded concurrent extractions.
        async with _EVENT_EXTRACT_GATE:
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
            event.processed_at = now_utc()
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
                    event.processed_at = now_utc()
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
    cutoff = now_utc() - timedelta(minutes=_STALE_MINUTES)
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
        _spawn_bg(process_event(eid))
    if ids:
        logger.info(
            "events: recovered %d row(s) (queued=%d, stuck=%d)",
            len(ids), len(queued_ids), len(stuck_ids),
        )
    return len(ids)


# ── Queries ─────────────────────────────────────────────────────────────────────

async def list_events(db: AsyncSession, start: date, end: date) -> list[InvitationEvent]:
    """Calendar feed — approved events only. `is_approved` now doubles as
    both the review-gate and the attendance flag: an unapproved row is
    still awaiting a reviewer's confirmation and shouldn't appear on the
    calendar until then. Anything unapproved lives in Needs Review."""
    result = await db.execute(
        select(InvitationEvent)
        .where(
            InvitationEvent.event_date >= start,
            InvitationEvent.event_date <= end,
            InvitationEvent.is_approved == True,  # noqa: E712
        )
        .order_by(InvitationEvent.event_date,
                  InvitationEvent.start_time.asc().nulls_first(),
                  InvitationEvent.id)
    )
    return list(result.scalars().all())


_NEEDS_REVIEW_DAYS = 30
_NEEDS_REVIEW_HARD_LIMIT = 200


async def list_needs_review(db: AsyncSession) -> list[InvitationEvent]:
    """Everything a reviewer can still act on — the safety net whose whole job
    is that nothing captured is ever silently lost.

    Previously this hid ALL past-dated rows on the theory that a past event
    can't be approved (attendance is forward-looking). But that silently
    swallowed a real case: a FAILED row that a reviewer Retries can re-extract
    to a PAST date — it would then vanish from this list AND stay off the
    calendar (approved-only), leaving the reviewer with "where did it go?".
    So past-dated rows now surface too, as long as they still need attention;
    the frontend tags them "Past — edit the date to approve" so the reviewer
    can fix the date (→ approvable) or delete, instead of losing them.

    A row surfaces if it isn't a finished, on-calendar entry — i.e. any of:
      • FAILED / still-processing (data isn't final)
      • Missing date / start time (data hole to fix)
      • Not yet approved (reviewer's confirm-with-Minister queue), past or not

    Rolling 30-day window (by created_at) plus a hard LIMIT keep the endpoint
    bounded regardless of date.
    """
    cutoff = now_utc() - timedelta(days=_NEEDS_REVIEW_DAYS)
    result = await db.execute(
        select(InvitationEvent)
        # Reason to surface. end_time is intentionally NOT here — many
        # invitations only announce a start ("6 PM at SRM Mahal") and
        # mandating end was just noise. Start time is still required.
        .where(
            (InvitationEvent.event_date.is_(None))
            | (InvitationEvent.start_time.is_(None))
            | (InvitationEvent.status != STATUS_READY)
            | (InvitationEvent.is_approved == False)  # noqa: E712
        )
        .where(InvitationEvent.created_at >= cutoff)
        .order_by(InvitationEvent.created_at.desc())
        .limit(_NEEDS_REVIEW_HARD_LIMIT)
    )
    return list(result.scalars().all())


async def overview_events(db: AsyncSession) -> dict:
    """Event-centric KPIs for the Overview screen — everything the PA needs
    to answer "what's coming, what needs my attention, what happened".

    Six pieces, four round-trips:
      1. Headline counts (today, this_week, awaiting_approval, needs_attention)
         + this_month_total — one SELECT with FILTER clauses.
      2. Next 5 upcoming events (id + serialized shape for a card list).
      3. This-week distribution by event_type (chart).
      4. This-month attendance breakdown (chart).
      5. Last-8-weeks volume series (mini-bar sparkline).

    Under the new semantics `is_approved` is the ATTENDANCE marker, not a
    publish gate — so headline counts (today / this_week / this_month /
    upcoming) count all events regardless of approval. `awaiting_approval`
    counts the reviewer's to-do queue (today+ unapproved, extraction clean);
    `needs_attention` covers data-hole rows.
    """
    # IST, not the server's UTC date — otherwise during 00:00–05:30 IST
    # (18:30–24:00 UTC) every KPI keys off "yesterday": today's events drop
    # out of the Today count, and yesterday's past events get counted as
    # today / as still-approvable. Single source feeds all the bounds below.
    today = _ist_today()
    # Monday-anchored week bounds (matches the calendar's Mon-first grid).
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    month_start = today.replace(day=1)
    # Rolling 8-week window for the volume sparkline (ISO week bucket).
    volume_start = today - timedelta(days=56)

    # ── 1) Headline counts — one round-trip, FILTER per KPI ─────────────────
    not_approved = InvitationEvent.is_approved == False  # noqa: E712
    approved = InvitationEvent.is_approved == True  # noqa: E712
    is_ready = InvitationEvent.status == STATUS_READY
    # Rolling window used for the 30-day attendance rate — the calendar-month
    # chart is noisy mid-month, the rolling window is what the office reads.
    thirty_start = today - timedelta(days=30)
    # Last day of the current month. replace(day=28) + 4d always lands in
    # next month regardless of month length, then snap to day=1 and step
    # back one — handles Feb/Dec without special-cases.
    _next_month_first = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = _next_month_first - timedelta(days=1)
    counts = (await db.execute(select(
        func.count(InvitationEvent.id).filter(
            InvitationEvent.event_date == today
        ).label("today"),
        func.count(InvitationEvent.id).filter(
            (InvitationEvent.event_date >= week_start)
            & (InvitationEvent.event_date <= week_end)
        ).label("this_week"),
        # This week's confirmed subset — how prepared is the office. Divisor
        # is `this_week`, so the frontend can render "N of M confirmed" with
        # no extra math.
        func.count(InvitationEvent.id).filter(
            approved
            & (InvitationEvent.event_date >= week_start)
            & (InvitationEvent.event_date <= week_end)
        ).label("this_week_confirmed"),
        # Split the calendar month into past-so-far vs upcoming to kill the
        # old ambiguous "this_month" number (which double-counted vs
        # `upcoming` since both include future dates in the same month).
        func.count(InvitationEvent.id).filter(
            (InvitationEvent.event_date >= month_start)
            & (InvitationEvent.event_date < today)
        ).label("past_this_month"),
        func.count(InvitationEvent.id).filter(
            (InvitationEvent.event_date >= today)
            & (InvitationEvent.event_date <= month_end)
        ).label("upcoming_this_month"),
        # Awaiting approval — the reviewer's to-do queue: fully-extracted,
        # dated, times set, event date today or later, not yet approved.
        # Past unapproved events are terminally "not attended" and don't
        # count as awaiting anything.
        func.count(InvitationEvent.id).filter(
            not_approved
            & is_ready
            & (InvitationEvent.event_date >= today)
            & (InvitationEvent.start_time.isnot(None))
            & (InvitationEvent.end_time.isnot(None))
        ).label("awaiting_approval"),
        # Needs attention — data-hole queue: failed OCR, undated, missing
        # times. Gated to actionable rows only (event_date IS NULL OR >=
        # today) so this count matches what actually shows up in the Needs
        # Review list — no past-dated rows inflate the badge.
        func.count(InvitationEvent.id).filter(
            (
                (InvitationEvent.event_date.is_(None))
                | (InvitationEvent.event_date >= today)
            )
            & (
                # Kept in lock-step with list_needs_review's reason clause —
                # end_time is not a data hole any more, only start is.
                (InvitationEvent.status != STATUS_READY)
                | (InvitationEvent.event_date.is_(None))
                | (InvitationEvent.start_time.is_(None))
            )
        ).label("needs_attention"),
        # Upcoming — all future events including today, whether approved
        # or not. Powers the "next N events" agenda header.
        func.count(InvitationEvent.id).filter(
            InvitationEvent.event_date >= today
        ).label("upcoming"),
        # Rolling-30d attendance: only PAST events (excluding today) can
        # have a settled attended/not-attended answer, so both attended
        # count and the denominator gate on event_date < today.
        func.count(InvitationEvent.id).filter(
            approved
            & (InvitationEvent.event_date >= thirty_start)
            & (InvitationEvent.event_date < today)
        ).label("attended_30d"),
        func.count(InvitationEvent.id).filter(
            (InvitationEvent.event_date >= thirty_start)
            & (InvitationEvent.event_date < today)
        ).label("total_past_30d"),
    ))).one()

    # ── 2) Next up to 5 upcoming events (all events, approved or not) ──────
    upcoming_rows = (await db.execute(
        select(InvitationEvent)
        .where(InvitationEvent.event_date >= today)
        .order_by(
            InvitationEvent.event_date.asc(),
            InvitationEvent.start_time.asc().nulls_first(),
            InvitationEvent.id,
        )
        .limit(5)
    )).scalars().all()

    # ── 3) This-week distribution by event_type (all events) ────────────────
    type_rows = (await db.execute(
        select(InvitationEvent.event_type, func.count(InvitationEvent.id))
        .where(
            InvitationEvent.event_date >= week_start,
            InvitationEvent.event_date <= week_end,
        )
        .group_by(InvitationEvent.event_type)
    )).all()

    # ── 4) This-month attendance breakdown ──────────────────────────────────
    # Two buckets now: attended (is_approved=true) vs not_attended
    # (is_approved=false). Only past-or-today events count — a future event
    # can't have "not attended" applied yet. The old three-state "not_marked"
    # bucket is gone with the attendance column.
    attendance_rows = (await db.execute(
        select(InvitationEvent.is_approved, func.count(InvitationEvent.id))
        .where(
            InvitationEvent.event_date >= month_start,
            InvitationEvent.event_date <= today,
        )
        .group_by(InvitationEvent.is_approved)
    )).all()
    attendance = {"attended": 0, "not_attended": 0, "not_marked": 0}
    for is_approved_val, n in attendance_rows:
        key = "attended" if is_approved_val else "not_attended"
        attendance[key] += int(n)

    # ── 5) Last-8-weeks volume series (all events) ──────────────────────────
    # `date_trunc('week', ...)` gives ISO Monday-anchored buckets; matches
    # the calendar's week convention above.
    week_rows = (await db.execute(
        select(
            func.date_trunc("week", InvitationEvent.event_date).label("wk"),
            func.count(InvitationEvent.id),
        )
        .where(
            InvitationEvent.event_date >= volume_start,
            InvitationEvent.event_date <= week_end,
        )
        .group_by("wk")
        .order_by("wk")
    )).all()
    # Densify: fill the 8-week grid so the sparkline has no gaps.
    week_grid: dict[str, int] = {}
    for i in range(8):
        wk = week_start - timedelta(weeks=7 - i)
        week_grid[wk.isoformat()] = 0
    for wk_dt, n in week_rows:
        key = (wk_dt.date() if hasattr(wk_dt, "date") else wk_dt).isoformat()
        if key in week_grid:
            week_grid[key] = int(n)
    volume_series = [{"week_start": k, "count": v} for k, v in week_grid.items()]

    total_past_30d = int(counts.total_past_30d)
    attended_30d = int(counts.attended_30d)
    return {
        "today":                int(counts.today),
        "this_week":            int(counts.this_week),
        # `this_week_confirmed` is a subset of `this_week`; frontend renders
        # "N of M confirmed" — no client-side math needed.
        "this_week_confirmed":  int(counts.this_week_confirmed),
        # Retired: `this_month` (ambiguous — double-counted today+ dates with
        # `upcoming`). Split into disjoint past/upcoming for clarity.
        "past_this_month":      int(counts.past_this_month),
        "upcoming_this_month":  int(counts.upcoming_this_month),
        "upcoming":             int(counts.upcoming),
        "awaiting_approval":    int(counts.awaiting_approval),
        "needs_attention":      int(counts.needs_attention),
        "week_range": {
            "start": week_start.isoformat(),
            "end":   week_end.isoformat(),
        },
        "next_events": [serialize(e) for e in upcoming_rows],
        "by_type_this_week": [
            {"type": (t or "other"), "count": int(n)}
            for t, n in sorted(type_rows, key=lambda r: -int(r[1]))
        ],
        "attendance_this_month": attendance,
        # Rolling-30-day attendance stat. `rate` is percent (0-100), None when
        # the denominator is zero so the UI can show "—" instead of dividing.
        "attendance_last_30d": {
            "attended":       attended_30d,
            "total":          total_past_30d,
            "rate":           round(attended_30d / total_past_30d * 100, 1) if total_past_30d else None,
        },
        "volume_last_8_weeks":   volume_series,
    }


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

    # Attendance is no longer editable via PATCH — the reviewer marks it by
    # calling POST /events/{id}/approve, which enforces the today+ rule and
    # stamps the approver's name. A stray "attendance" key in the payload is
    # silently ignored so older clients don't 400 during rollout.

    # A manual date on a FAILED row resolves it — no retry needed.
    if event.status == STATUS_FAILED and event.event_date is not None:
        event.status = STATUS_READY
        event.error_message = None

    event.updated_at = now_utc()
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
    _spawn_bg(process_event(event.id))
    return event


async def approve_event(
    db: AsyncSession, event_id: int, approved_by: str,
) -> InvitationEvent:
    """Reviewer marks an event as attended (is_approved=true).

    Guardrails:
      • Row must be READY (extraction done or manual save committed).
      • Both date AND times must be set — you can't attend something without
        a place in the calendar.
      • event_date must be today or later (IST). Approving a past event is
        rejected: attendance is a forward-looking commitment; if the Minister
        actually attended a past event that wasn't approved in time, the
        reviewer should edit the date to today or contact ops for a manual
        DB fix. Prevents accidental retro-marking of no-shows as attended.

    Idempotent: re-approving is a no-op that doesn't stamp a new approved_at.
    """
    event = await get_event(db, event_id)
    if event.status != STATUS_READY:
        raise HTTPException(409, "Only READY events can be approved — retry / fix first")
    if event.event_date is None:
        raise HTTPException(409, "Set an event date before approving")
    if event.start_time is None:
        raise HTTPException(409, "Set the start time before approving")
    if event.event_date < _ist_today():
        raise HTTPException(409, "Past events cannot be approved — attendance is forward-looking")
    if event.is_approved:
        return event
    event.is_approved = True
    event.approved_by = approved_by
    event.approved_at = now_utc()
    await db.commit()
    await db.refresh(event)
    return event
