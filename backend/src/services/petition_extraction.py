"""
Petition Extraction Service — Gemini, isolated from the summariser.

Used ONLY by the AI Uploads pipeline. Unlike GrievanceSummarisationService (which
summarises an already-identified citizen's grievance), this reads a *scanned
petition document* and additionally EXTRACTS the petitioner's identity — name
(English + Tamil) and phone number — straight from the page, then produces the
same bilingual summary/category/department/urgency.

Separate prompt, separate schema, separate method — the existing summariser is
left completely untouched. The careful category/department guidance is reused
from summarisation.SYSTEM_PROMPT so classification stays consistent system-wide.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google import genai
from google.genai import types
from pydantic import Field

from src.models.grievance_summary import GrievanceSummary
from src.services.summarisation import (
    SYSTEM_PROMPT as _BASE_PROMPT,
    PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL2,
    SERVICE_TIER, _TRANSIENT_MARKERS,
    _MAX_RETRIES_PER_MODEL, _BACKOFF_BASE_SECONDS,
)

logger = logging.getLogger(__name__)


# ── Output schema: identity + the full grievance summary ────────────────────────
class PetitionExtraction(GrievanceSummary):
    """GrievanceSummary + identity fields extracted from the scanned petition."""

    citizen_name: str = Field(
        default="",
        description=(
            "STRICT: the petitioner's full name, ONLY if you are confident it is "
            "actually the petitioner (found in the signature block, after 'From' / "
            "'பெயர்' / 'இயற்பெயர்', or on the 'To … From' header). Keep it in the "
            "script it is written in. Return an EMPTY STRING '' if: the name is "
            "illegible, you are guessing between candidates, only address fragments "
            "are visible, or the name in view belongs to someone else (the addressee, "
            "a witness, an official mentioned in the body). Do NOT invent, do NOT "
            "guess, do NOT write 'Unknown'."
        ),
        max_length=200,
    )
    citizen_name_ta: str = Field(
        default="",
        description=(
            "The same petitioner's name in TAMIL (தமிழ்). Same rules as citizen_name — "
            "empty string '' if not confident, or if citizen_name is empty. If the "
            "petition name is already Tamil, echo it; if Latin, transliterate the "
            "SCRIPT only (do not translate meaning)."
        ),
        max_length=200,
    )
    mobile: Optional[str] = Field(
        default=None,
        description=(
            "STRICT: the petitioner's own 10-digit Indian mobile number, ONLY if it "
            "is clearly written on the petition AS THEIR CONTACT (e.g. beside the "
            "signature, in a 'Mobile:' / 'கைபேசி:' / 'தொ.பே:' label, or in a "
            "phone-number field). Return NULL if: no number is present, the number "
            "is not clearly labelled as the petitioner's, it is fewer than 10 "
            "digits, it is a landline / office / minister's helpline / TASMAC "
            "helpline / any other party's number, or you are uncertain. Never "
            "invent digits, never guess. Digits only, no spaces or symbols."
        ),
        max_length=20,
    )


# ── Extraction prompt — reuse the base classification guidance, add identity ────
EXTRACTION_PROMPT = (
    _BASE_PROMPT
    + "\n\n"
    + """
ADDITIONAL TASK — STRICT IDENTITY EXTRACTION
============================================

This is a scanned / photographed petition. Before summarising, extract the
petitioner's identity from the page. This is a Minister's office — a wrong
name or a wrong phone number causes real harm (SMS updates go to the wrong
person, records get merged into the wrong citizen). ABSOLUTE STRICTNESS:
when in doubt, RETURN EMPTY. A missing field is safe; a guessed field is
not.

citizen_name  (and citizen_name_ta)
-----------------------------------
Fill ONLY if the petitioner's name is clearly and unambiguously identifiable
from ONE of these positions:

  (a) Signature block at the end ("இப்படிக்கு / தங்கள் / அன்புடன் …" followed
      by a legible name).
  (b) 'From' / 'From:' / 'அனுப்புநர்' / 'மனுதாரர்' / 'பெயர்:' / 'இயற்பெயர்:'
      block at the top.
  (c) A clearly-labelled name field on a printed form (e.g. "Name of Applicant:
      _____").

Return EMPTY STRING '' when ANY of these are true:
  - The name is illegible / partly cut off / handwriting you cannot read
    with high confidence.
  - Multiple candidate names appear and you are not sure which is the
    petitioner (address block, witnesses, officials being complained about,
    the addressee/Minister).
  - Only initials / a signature scribble are present.
  - The petition is on behalf of an association / union / group and no
    individual signatory is unambiguous.

Never write "Unknown", "N/A", "Not found" or a placeholder — the string
must be either a real name or empty. Never invent, never guess between
candidates. Downstream code treats '' as "no name extracted" and the PA
will fill it manually — that is the correct fallback.

mobile
------
Fill ONLY if a 10-digit Indian mobile number is written on the page AND is
clearly labelled or positioned AS the petitioner's own contact number.
Accepted positions:

  - Beside / below the signature.
  - After a label: 'Mobile:', 'Mob:', 'Cell:', 'Phone:', 'கைபேசி:',
    'தொ.பே:', 'செல் எண்:'.
  - In a printed form's "Mobile / Phone" field for the applicant.

Return NULL when ANY of these are true:
  - No number is visible.
  - The number is fewer than 10 digits (do not pad or complete).
  - It is a landline (STD code like 044, 04565, etc.).
  - It is somebody else's number (an office they are complaining about, a
    TASMAC helpline, a school office, a minister's helpline, a witness's
    contact).
  - You cannot read a digit with confidence.
  - The petitioner explicitly gives it as an alternate contact for another
    person.

Digits only, no country code, no spaces, no dashes. Never invent digits.

After identity extraction, produce the full bilingual summary exactly as
specified in the CORE RULES above (name_en / name_ta / citizen_ask /
summary / key_details / category / ministry / urgency). Return ONLY the
JSON object matching the schema — no markdown, no preamble.
""".strip()
)


class PetitionExtractionService:
    """Stateless: call extract() once per uploaded petition file."""

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
    def from_settings(cls) -> "PetitionExtractionService":
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
    def extract(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> PetitionExtraction:
        """One Gemini call: read the petition document → identity + summary."""
        t0 = time.monotonic()
        contents: list = [
            "SCANNED PETITION DOCUMENT"
            + (f" (file: {filename})" if filename else "")
            + ". Extract the petitioner's identity, then summarise the grievance.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=EXTRACTION_PROMPT,
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=PetitionExtraction,
            service_tier=self._service_tier,
        )
        result = self._call_with_fallback(contents=contents, config=config)
        logger.info(
            "Petition extraction done in %dms | model=%s | name=%s | category=%s | urgency=%s",
            int((time.monotonic() - t0) * 1000), self._model_name,
            result.citizen_name, result.category.value, result.urgency.value,
        )
        return result

    # ── Resilience (mirrors summarisation._call_with_fallback) ──────────────────
    def _generate_once(self, model: str, contents: list, config) -> PetitionExtraction:
        response = self._client.models.generate_content(model=model, contents=contents, config=config)
        parsed = response.parsed
        if isinstance(parsed, PetitionExtraction):
            return parsed
        if response.text:
            return PetitionExtraction.model_validate_json(response.text)
        raise ValueError("Gemini returned an empty response with no parsed object.")

    def _call_with_fallback(self, *, contents: list, config) -> PetitionExtraction:
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
                    logger.warning("Extraction failed model=%s try=%d transient=%s: %s",
                                   model, retry + 1, transient, exc)
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        raise RuntimeError(f"Petition extraction failed on all models {models_to_try}: {last_exc}") from last_exc
