"""
Invitation Extraction Service — Gemini, isolated from the petition pipeline.

Used ONLY by the /events invitation-calendar PWA. Reads a *photographed
greeting/invitation card* (wedding, temple festival, opening ceremony, …,
frequently printed in Tamil) and extracts the event's title, type, venue,
date and times as structured JSON.

Separate prompt, separate schema, separate service — the petition summariser
and extractor are left completely untouched. The Gemini model constants and
retry/fallback behaviour are shared via summarisation so model upgrades stay
consistent system-wide.
"""
from __future__ import annotations

import logging
import time
from datetime import date
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from src.services.summarisation import (
    PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL2,
    SERVICE_TIER, _TRANSIENT_MARKERS,
    _MAX_RETRIES_PER_MODEL, _BACKOFF_BASE_SECONDS,
)

logger = logging.getLogger(__name__)


# ── Output schema ───────────────────────────────────────────────────────────────
class InvitationExtraction(BaseModel):
    """Structured event details read off one invitation card."""

    title: str = Field(
        default="",
        description=(
            "Short event title naming the occasion and host, in the script the "
            "card is printed in (e.g. 'Karthik & Priya Wedding', "
            "'குமரன் திருமண விழா', 'New Bus Stand Opening — Madurai'). "
            "EMPTY STRING '' if the card is unreadable. Never 'Unknown'."
        ),
        max_length=300,
    )
    title_ta: str = Field(
        default="",
        description=(
            "The same title in TAMIL (தமிழ்) if the card is Tamil or you can "
            "transliterate confidently; else empty string ''."
        ),
        max_length=300,
    )
    event_type: str = Field(
        default="other",
        description=(
            "Exactly one of: wedding | opening_ceremony | temple_festival | "
            "political_meeting | housewarming | memorial | school_function | "
            "other. Use 'other' whenever unsure."
        ),
        max_length=50,
    )
    venue: str = Field(
        default="",
        description=(
            "The venue/location as printed — hall name, street, town (e.g. "
            "'SRM Mahal, Tambaram' or 'அண்ணா அரங்கம், மதுரை'). EMPTY STRING '' "
            "if no venue is printed or it is illegible. Never guess."
        ),
        max_length=300,
    )
    event_date: str = Field(
        default="",
        description=(
            "The event's date as YYYY-MM-DD. Cards print dates many ways: "
            "'12.09.2026', Tamil month names (சித்திரை, வைகாசி, ஆனி, ஆடி, ஆவணி, "
            "புரட்டாசி, ஐப்பசி, கார்த்திகை, மார்கழி, தை, மாசி, பங்குனி), or a "
            "weekday + day. If the year is missing, choose the year that puts "
            "the date closest in the FUTURE relative to today's date given in "
            "the message. Multi-day functions: return the FIRST day and mention "
            "the range in raw_summary. EMPTY STRING '' if no date is readable. "
            "Never invent a date."
        ),
        max_length=10,
    )
    start_time: str = Field(
        default="",
        description=(
            "Start time as HH:MM in 24-hour clock. Tamil cards often write "
            "'காலை 10 மணி' (morning 10 => 10:00), 'மாலை 6 மணி' (evening 6 => "
            "18:00), 'முற்பகல்' (forenoon), 'இரவு' (night). Muhurtham windows "
            "like '9.00 - 10.30' => start 09:00. EMPTY STRING '' if no time is "
            "printed. Never guess."
        ),
        max_length=5,
    )
    end_time: str = Field(
        default="",
        description=(
            "End time as HH:MM (24-hour) ONLY if the card prints an explicit "
            "end (e.g. muhurtham window end, 'till 9pm'). Else empty string ''."
        ),
        max_length=5,
    )
    raw_summary: str = Field(
        default="",
        description=(
            "1-2 plain sentences of anything else useful on the card: hosts' "
            "names, multi-day schedule, chief guests, reception vs muhurtham "
            "timings, RSVP contact. English preferred, Tamil acceptable."
        ),
        max_length=600,
    )


# ── System prompt ───────────────────────────────────────────────────────────────
EXTRACTION_PROMPT = """
You read PHOTOGRAPHED INVITATION / GREETING CARDS for a Minister's personal
office in Tamil Nadu, India. Staff photograph cards handed to the Minister
(weddings, temple festivals, opening ceremonies, political meetings,
housewarmings, memorials, school functions). Your output fills a team
calendar, so a WRONG date or venue sends the Minister to the wrong place —
ABSOLUTE STRICTNESS: when in doubt, RETURN EMPTY. A missing field is safe;
a guessed field is not.

Cards are printed in Tamil, English, or both. Read both scripts. Ornate
fonts, gold-on-red printing, and photographs of cards at an angle are
normal — do your best, but never let decoration push you into guessing.

DATES: Tamil cards may use Tamil calendar month names alongside or instead
of Gregorian dates. Convert to a single Gregorian YYYY-MM-DD. If only day
and month are printed, resolve the year to the nearest future occurrence
relative to the "Today's date" line provided in the message. If several
dates are printed (multiple functions — reception, muhurtham, valaikaappu),
return the MAIN function's date (muhurtham for weddings) and describe the
rest in raw_summary.

TIMES: convert Tamil daypart words — காலை (morning), முற்பகல் (forenoon),
மதியம்/நண்பகல் (noon), பிற்பகல் (afternoon), மாலை (evening), இரவு (night) —
plus மணி (o'clock) into 24-hour HH:MM.

Return ONLY the JSON object matching the schema — no markdown, no preamble.
""".strip()


class InvitationExtractionService:
    """Stateless: call extract() once per photographed invitation."""

    def __init__(
        self,
        api_key: str,
        model_name: str = PRIMARY_MODEL,
        fallback_model: str = FALLBACK_MODEL,
        fallback_model2: str = FALLBACK_MODEL2,
        service_tier: str = SERVICE_TIER,
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required.")
        self._client = genai.Client(api_key=api_key)
        self._model_name = model_name
        self._fallback_model = fallback_model
        self._fallback_model2 = fallback_model2
        self._service_tier = self._resolve_tier(service_tier)

    @staticmethod
    def _resolve_tier(value: Optional[str]):
        if not value:
            return None
        try:
            return types.ServiceTier(value.lower())
        except ValueError:
            return None

    @classmethod
    def from_settings(cls) -> "InvitationExtractionService":
        from src.core.config import settings
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set in backend/.env")
        return cls(
            api_key=settings.GEMINI_API_KEY,
            model_name=settings.GEMINI_PRIMARY_MODEL,
            fallback_model=settings.GEMINI_FALLBACK_MODEL,
            fallback_model2=settings.GEMINI_FALLBACK_MODEL2,
            service_tier=settings.GEMINI_SERVICE_TIER,
        )

    # ── Main entry point ────────────────────────────────────────────────────────
    def extract(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> InvitationExtraction:
        """One Gemini call: read the invitation card → structured event details."""
        t0 = time.monotonic()
        contents: list = [
            "PHOTOGRAPHED INVITATION CARD"
            + (f" (file: {filename})" if filename else "")
            + f". Today's date is {date.today().isoformat()}. "
            + "Extract the event details.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=EXTRACTION_PROMPT,
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=InvitationExtraction,
            service_tier=self._service_tier,
        )
        result = self._call_with_fallback(contents=contents, config=config)
        logger.info(
            "Invitation extraction done in %dms | model=%s | type=%s | date=%s | time=%s",
            int((time.monotonic() - t0) * 1000), self._model_name,
            result.event_type, result.event_date, result.start_time,
        )
        return result

    # ── Resilience (mirrors summarisation._call_with_fallback) ──────────────────
    def _generate_once(self, model: str, contents: list, config) -> InvitationExtraction:
        response = self._client.models.generate_content(model=model, contents=contents, config=config)
        parsed = response.parsed
        if isinstance(parsed, InvitationExtraction):
            return parsed
        if response.text:
            return InvitationExtraction.model_validate_json(response.text)
        raise ValueError("Gemini returned an empty response with no parsed object.")

    def _call_with_fallback(self, *, contents: list, config) -> InvitationExtraction:
        models_to_try = [self._model_name]
        for m in (self._fallback_model, self._fallback_model2):
            if m and m not in models_to_try:
                models_to_try.append(m)

        last_exc: Optional[Exception] = None
        for model in models_to_try:
            for retry in range(_MAX_RETRIES_PER_MODEL):
                try:
                    out = self._generate_once(model, contents, config)
                    self._model_name = model
                    return out
                except Exception as exc:
                    last_exc = exc
                    transient = any(mk in str(exc) for mk in _TRANSIENT_MARKERS)
                    logger.warning("Invitation extraction failed model=%s try=%d transient=%s: %s",
                                   model, retry + 1, transient, exc)
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        raise RuntimeError(f"Invitation extraction failed on all models {models_to_try}: {last_exc}") from last_exc
