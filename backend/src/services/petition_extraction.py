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
        description=(
            "The petitioner's full name, read from the document. Keep it in the "
            "script it is written in (usually Tamil). If no name is legible, use "
            "'Unknown'."
        ),
        max_length=200,
    )
    citizen_name_ta: str = Field(
        description="The petitioner's name in TAMIL (தமிழ்). Same as citizen_name if already Tamil.",
        max_length=200,
    )
    mobile: Optional[str] = Field(
        default=None,
        description=(
            "The petitioner's phone number if clearly written on the petition "
            "(digits only, 10 digits for Indian mobiles). Null if not present."
        ),
        max_length=20,
    )


# ── Extraction prompt — reuse the base classification guidance, add identity ────
EXTRACTION_PROMPT = (
    _BASE_PROMPT
    + "\n\n"
    + """
ADDITIONAL TASK — IDENTITY EXTRACTION (this is a scanned/photographed petition):

Before summarising, read the document carefully and extract the petitioner's
identity from the page itself:

  - citizen_name: the full name of the person submitting the petition, exactly as
    written (usually at the top, in the signature, or after 'From' / 'பெயர்' /
    'தமிழ்நாடு'). Keep the original script. If genuinely no name is legible, set
    it to 'Unknown'.
  - citizen_name_ta: the same name written in Tamil.
  - mobile: the petitioner's phone number ONLY if it is clearly written on the
    page (10-digit Indian mobile, digits only). If absent or illegible, set null.
    Never invent a number.

Then produce the full bilingual summary exactly as specified above. Return ONLY
the JSON object matching the schema.
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
