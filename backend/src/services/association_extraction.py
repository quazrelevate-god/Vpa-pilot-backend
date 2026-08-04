"""
Association / Union extraction service — Gemini.

Same approach as the petition extractor: it reads the document, produces the full
grievance summary (same GrievanceCategory taxonomy, ministry, urgency, district,
key_details, document_date) and additionally extracts the association's identity
(name, membership, office-bearer) and its collective ask. Identity comes from the
document (association scans have no intake form).

Prompt: src/prompts/association_extraction.py (reuses the petition guidance).
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google import genai
from google.genai import types

from src.models.association_extraction import AssociationExtraction
from src.prompts.association_extraction import ASSOCIATION_EXTRACTION_PROMPT
from src.services.summarisation import (
    PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL2,
    SERVICE_TIER, _TRANSIENT_MARKERS,
    _MAX_RETRIES_PER_MODEL, _BACKOFF_BASE_SECONDS,
)

logger = logging.getLogger(__name__)


class AssociationExtractionService:
    """Stateless: call extract() once per uploaded association document."""

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
    def from_settings(cls) -> "AssociationExtractionService":
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

    def extract(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> AssociationExtraction:
        """One Gemini call: read the association document -> grievance summary + association fields."""
        t0 = time.monotonic()
        contents: list = [
            "ASSOCIATION / UNION DOCUMENT" + (f" (file: {filename})" if filename else "")
            + ". Summarise the collective matter and extract the association details.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=ASSOCIATION_EXTRACTION_PROMPT,
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=AssociationExtraction,
            service_tier=self._service_tier,
        )
        result = self._call_with_fallback(contents=contents, config=config)
        logger.info(
            "Association extraction done in %dms | model=%s | assoc=%r | category=%s",
            int((time.monotonic() - t0) * 1000), self._model_name,
            result.association_name, result.category.value,
        )
        return result

    # ── Resilience ──────────────────────────────────────────────────────────────
    def _generate_once(self, model: str, contents: list, config) -> AssociationExtraction:
        response = self._client.models.generate_content(model=model, contents=contents, config=config)
        parsed = response.parsed
        if isinstance(parsed, AssociationExtraction):
            return parsed
        if response.text:
            return AssociationExtraction.model_validate_json(response.text)
        raise ValueError("Gemini returned an empty response with no parsed object.")

    def _call_with_fallback(self, *, contents: list, config) -> AssociationExtraction:
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
                    logger.warning("Association extraction failed model=%s try=%d transient=%s: %s",
                                   model, retry + 1, transient, exc)
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        raise RuntimeError(f"Association extraction failed on all models {models_to_try}: {last_exc}") from last_exc
