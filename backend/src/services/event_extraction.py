"""
Invitation Extraction Service — Gemini (Vertex-first via shared client factory).

Used ONLY by the /events invitation-calendar PWA. Reads a *photographed
greeting/invitation card* (wedding, temple festival, opening ceremony, …,
frequently printed in Tamil) and extracts the event's title, type, venue,
date and times as structured JSON.

Separate prompt, separate schema; delegates client + fallback plumbing to the
shared gemini_client_factory so behaviour matches every other AI service.
"""
from __future__ import annotations

import logging
import time
from datetime import date
from enum import Enum
from typing import Optional

from google.genai import types
from pydantic import BaseModel, Field

from src.models.event_models import EVENT_TYPES as _EVENT_TYPE_VALUES
from src.services.gemini_client_factory import GeminiClientBundle, build_from_settings

logger = logging.getLogger(__name__)


# Structured-output enum for `event_type`. Values MUST match EVENT_TYPES in
# `src/models/event_models` — imported above so the enum can never drift from
# the DB-side allowlist. Constraining the schema (vs the earlier free `str`)
# forces Gemini to pick from this set instead of inventing labels like
# 'reception' or 'kalyanam' — which the downstream `etype if etype in
# EVENT_TYPES else "other"` filter used to silently collapse to 'other',
# losing the fact that the model DID recognise the event.
EventType = Enum(
    "EventType",
    {v.upper(): v for v in _EVENT_TYPE_VALUES},
    type=str,
)


# ── Output schema ───────────────────────────────────────────────────────────────
class InvitationExtraction(BaseModel):
    """Structured event details read off one invitation card.

    The whole PA-portal / Events PWA has an EN / TA language toggle, so every
    displayed string must exist in both scripts. The extractor always returns
    both `title_en` + `title_ta` and both `venue_en` + `venue_ta` — one is
    the source (whatever the card was printed in), the other is a faithful
    translation/transliteration produced by the same Gemini call. Dates are
    kept Gregorian (frontend transliterates month names to Tamil), because
    switching to the actual Tamil calendar (சித்திரை/வைகாசி/…) would break
    every date filter and calendar grid downstream.
    """

    title_en: str = Field(
        default="",
        description=(
            "Short event title in ENGLISH (Latin script). Naming the occasion "
            "and the host if printed (e.g. 'Karthik & Priya Wedding', "
            "'New Bus Stand Opening — Madurai'). If the card is printed only "
            "in Tamil, TRANSLATE the title to natural English (e.g. "
            "'குமரன் திருமண விழா' -> 'Kumaran Wedding'). Personal names stay "
            "in Latin letters (transliterate them). EMPTY STRING '' only when "
            "the card is completely unreadable. Never 'Unknown'."
        ),
        max_length=300,
    )
    title_ta: str = Field(
        default="",
        description=(
            "The same title in TAMIL (தமிழ்). If the card is Tamil, echo it "
            "verbatim; if English, translate to natural Tamil "
            "('Wedding of Karthik & Priya' -> 'கார்த்திக் & பிரியா திருமண "
            "விழா'). Personal names use Tamil script. EMPTY STRING '' only "
            "when the card is completely unreadable."
        ),
        max_length=300,
    )
    event_type: EventType = Field(
        default=EventType("other"),
        description=(
            "Exactly one of: wedding | opening_ceremony | temple_festival | "
            "political_meeting | housewarming | memorial | school_function | "
            "press_meet | public_speaking | other. Constrained to this enum "
            "in the response_schema.\n"
            "\n"
            "PRECEDENCE — real invitations often fit two labels. Use these "
            "tie-breakers (this office is the Minister for School Education, "
            "so the school angle usually wins):\n"
            "  • Any event ON school premises OR organised by a school "
            "    (inauguration of a new school, science fair, sports day, "
            "    prize distribution, alumni meet) => `school_function` — "
            "    NOT `opening_ceremony` even for the school's inauguration.\n"
            "  • A public rally / political gathering, even if held on a "
            "    school ground => `political_meeting`.\n"
            "  • Inauguration of a NON-school facility (bus stand, road, "
            "    office, statue, temple structure) => `opening_ceremony`. "
            "    Reserve this for non-school ribbon-cutting.\n"
            "  • A wedding at a temple => `wedding`, not `temple_festival`. "
            "    Reserve `temple_festival` for the temple's own festival / "
            "    kumbabhishekam / annual utsavam.\n"
            "  • Press conference / journalist meet / media briefing => "
            "    `press_meet`.\n"
            "  • Standalone public address / keynote / lecture / felicitation "
            "    speech / seminar => `public_speaking`. If the speech is the "
            "    centrepiece of a school function, it's still "
            "    `school_function` — precedence above.\n"
            "  • Only fall back to `other` when NONE of the above genuinely "
            "    fits (film festival, book launch, exhibition, sporting event "
            "    with no school angle). Do not use `other` just because the "
            "    card is unusual — pick the closest bucket by primary act.\n"
            "\n"
            "The enum is only for filtering / analytics, not for naming — the "
            "specific event kind (e.g. 'school science exhibition', "
            "'kumbabhishekam', 'book launch') can be captured in the title "
            "fields if needed."
        ),
    )
    venue_en: str = Field(
        default="",
        description=(
            "Venue/location in ENGLISH (Latin script). Hall name + street + "
            "town/city as printed on the card (e.g. 'SRM Mahal, Tambaram, "
            "Chennai'). If the card prints the venue only in Tamil, "
            "transliterate proper nouns and translate the connectives "
            "('அண்ணா அரங்கம், மதுரை' -> 'Anna Arangam, Madurai'). EMPTY "
            "STRING '' if no venue is printed or it is illegible. Never guess."
        ),
        max_length=300,
    )
    venue_ta: str = Field(
        default="",
        description=(
            "Venue/location in TAMIL (தமிழ் script). If the card prints it "
            "in Tamil, echo verbatim; if English, transliterate to Tamil "
            "('SRM Mahal, Tambaram' -> 'எஸ்.ஆர்.எம். மஹால், தாம்பரம்'). EMPTY "
            "STRING '' if no venue is printed or illegible."
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
            "the message. Multi-day functions: return the FIRST day. EMPTY "
            "STRING '' if no date is readable. Never invent a date."
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
    # Note: the earlier `raw_summary_en` / `raw_summary_ta` pair (the AI's
    # "extra context" summary — hosts, chief guests, multi-day schedule) was
    # removed from this schema after the UI stopped surfacing it. Downstream
    # code no longer reads it; the DB's extraction_json blob on pre-removal
    # rows may still carry the field but nothing displays it.

    # ── Populated ONLY for audio (voice-memo) extraction ────────────────────────
    # The photo path leaves these empty — there's nothing to transcribe. For
    # audio inputs the model transcribes the recording verbatim in Tamil AND
    # gives an English translation, so the popup's transcript pane still works
    # after we dropped the separate Sarvam STT round-trip.
    transcript_ta: str = Field(
        default="",
        description=(
            "Verbatim Tamil transcript of the audio (if input was audio). "
            "Preserve every word. Empty for photo inputs or when the audio "
            "was unintelligible."
        ),
        max_length=4000,
    )
    transcript_en: str = Field(
        default="",
        description=(
            "Faithful English translation of `transcript_ta` (if input was "
            "audio). Empty for photo inputs. Personal / place names "
            "transliterated to Latin script."
        ),
        max_length=4000,
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

BILINGUAL OUTPUT — ALWAYS FILL BOTH SCRIPTS
The calendar has an English/Tamil toggle, so every visible text field
must exist in BOTH scripts. For each pair (title_en/title_ta,
venue_en/venue_ta):
  - If the card is printed in Tamil, echo Tamil verbatim into the *_ta
    field AND produce a natural English translation into the *_en field.
  - If the card is printed in English, echo it into *_en AND produce a
    natural Tamil translation into *_ta (personal names → Tamil script,
    place names → transliterated).
  - If the card is bilingual, use the card's own text on each side.
  - The pair is "both filled or both empty" — never leave one side blank
    while the other has content, unless the whole card is unreadable.
Preserve titles, honorifics and personal names; do not summarise them
away in the translation.

DATES: Cards frequently use Tamil calendar month names (சித்திரை,
வைகாசி, ஆனி, ஆடி, ஆவணி, புரட்டாசி, ஐப்பசி, கார்த்திகை, மார்கழி, தை, மாசி,
பங்குனி). ALWAYS convert to a single Gregorian YYYY-MM-DD — the calendar
UI transliterates the Gregorian month name to Tamil for display, so do
NOT return Tamil calendar month names. If only day and month are printed,
resolve the year to the nearest future occurrence relative to the "Today's
date" line provided in the message. If several dates are printed (multiple
functions — reception, muhurtham, valaikaappu), return the MAIN function's
date (muhurtham for weddings).

TIMES: convert Tamil daypart words — காலை (morning), முற்பகல் (forenoon),
மதியம்/நண்பகல் (noon), பிற்பகல் (afternoon), மாலை (evening), இரவு (night) —
plus மணி (o'clock) into 24-hour HH:MM.

Return ONLY the JSON object matching the schema — no markdown, no preamble.
""".strip()


class InvitationExtractionService:
    """Stateless: call extract() (photo) or extract_from_audio() (voice memo)
    once per invitation."""

    def __init__(self, bundle: GeminiClientBundle) -> None:
        self._bundle = bundle

    @classmethod
    def from_settings(cls) -> "InvitationExtractionService":
        return cls(build_from_settings())

    def _config(self) -> types.GenerateContentConfig:
        """Config is identical across photo / audio / transcript paths — only
        `contents` differ, so factor the config to one place."""
        return types.GenerateContentConfig(
            system_instruction=EXTRACTION_PROMPT,
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=InvitationExtraction,
            service_tier=self._bundle.service_tier,
        )

    # ── Photo path ─────────────────────────────────────────────────────────────
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
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=self._config(),
            response_type=InvitationExtraction,
            service_name="invitation_extraction",
        )
        logger.info(
            "Invitation extraction done in %dms | backend=%s | type=%s | date=%s | time=%s | en=%r | ta=%r",
            int((time.monotonic() - t0) * 1000), backend,
            result.event_type, result.event_date, result.start_time,
            (result.title_en or "")[:40], (result.title_ta or "")[:40],
        )
        return result

    # ── Voice / audio-native extraction (Gemini direct, no external STT) ───────
    def extract_from_audio(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        note: str = "",
    ) -> InvitationExtraction:
        """One Gemini call: read a voice memo → transcript + structured event
        details. Replaces the previous two-hop pipeline (Sarvam STT ×2 →
        Gemini extraction), which was the source of the 502s the office was
        seeing when Sarvam timed out or throttled.

        Gemini 1.5+ accepts audio as an inline part, same shape as an image;
        `transcript_ta` / `transcript_en` in the response carry the model's
        transcription so the popup's transcript pane still populates.
        """
        t0 = time.monotonic()
        prompt = (
            "SPOKEN INVITATION — the following is a voice memo recorded by a "
            "PA describing an event the Minister has been invited to. First "
            "TRANSCRIBE the audio verbatim into `transcript_ta` (Tamil script) "
            "AND provide an English translation into `transcript_en`. Then "
            "extract the same structured event details you would from a "
            "photographed card (title_en/ta, venue_en/ta, event_type, "
            "event_date, start_time, end_time). "
            f"Today's date is {date.today().isoformat()}."
        )
        if note:
            prompt += f"\nPA's note (highest-priority context): {note}"
        contents: list = [
            prompt,
            types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=self._config(),
            response_type=InvitationExtraction,
            service_name="invitation_extraction_audio",
        )
        logger.info(
            "Audio extraction done in %dms | backend=%s | type=%s | date=%s | time=%s | en=%r | ta=%r | ta_transcript_len=%d",
            int((time.monotonic() - t0) * 1000), backend,
            result.event_type, result.event_date, result.start_time,
            (result.title_en or "")[:40], (result.title_ta or "")[:40],
            len(result.transcript_ta or ""),
        )
        return result

    # ── Voice / transcript-driven extraction (LEGACY — kept for compat) ────────
    def extract_from_transcript(
        self,
        *,
        transcript_ta: str = "",
        transcript_en: str = "",
        note: str = "",
    ) -> InvitationExtraction:
        """One Gemini call: parse a spoken invitation → structured event details.

        LEGACY — the current voice path is extract_from_audio(). Retained
        because a couple of internal Streamlit testers still call this shape.
        """
        t0 = time.monotonic()
        lines = [
            "SPOKEN INVITATION — the following is a voice memo transcribed by",
            "Sarvam AI. Extract the same fields you would from a photographed card.",
            f"Today's date is {date.today().isoformat()}.",
        ]
        if note:
            lines.append(f"PA's note (highest-priority context): {note}")
        if transcript_ta:
            lines.append(f"Tamil transcript:\n{transcript_ta}")
        if transcript_en:
            lines.append(f"English translation:\n{transcript_en}")
        lines.append("[Return the JSON object now.]")

        contents = ["\n\n".join(lines)]
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=self._config(),
            response_type=InvitationExtraction,
            service_name="invitation_extraction_transcript",
        )
        logger.info(
            "Voice extraction done in %dms | backend=%s | type=%s | date=%s | time=%s | en=%r | ta=%r",
            int((time.monotonic() - t0) * 1000), backend,
            result.event_type, result.event_date, result.start_time,
            (result.title_en or "")[:40], (result.title_ta or "")[:40],
        )
        return result
