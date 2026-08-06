"""
Proposal Extraction Service — Gemini, isolated from the petition summariser.

Used ONLY by the /proposal intake pipeline. Reads a proposal DOCUMENT (PDF) and
distils it into a Minister-ready brief (ProposalExtraction): problem, proposed
solution, expected benefit, beneficiary, cost, timeline, a triage recommendation.

Deliberately separate from GrievanceSummarisationService / PetitionExtractionService:
a proposal is judged on merit, not routed and resolved. It does NOT extract
identity — the /proposal form already captured org / person / contact as ground
truth, so Gemini reads the document for substance only.

Prompt lives in the prompt-management layer: src/prompts/proposal_extraction.py.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google import genai
from google.genai import types

from src.models.proposal_extraction import ProposalExtraction
from src.prompts.proposal_extraction import PROPOSAL_EXTRACTION_PROMPT
# Reuse the summariser's model chain + retry tuning so behaviour stays consistent.
from src.services.summarisation import (
    PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL2,
    SERVICE_TIER, _TRANSIENT_MARKERS,
    _MAX_RETRIES_PER_MODEL, _BACKOFF_BASE_SECONDS,
)

logger = logging.getLogger(__name__)


class ProposalExtractionService:
    """Stateless: call extract() once per uploaded proposal document."""

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
    def from_settings(cls) -> "ProposalExtractionService":
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
    def extract(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None,
                org_name: Optional[str] = None, category: Optional[str] = None) -> ProposalExtraction:
        """One Gemini call: read the proposal document → structured brief.

        org_name / category are passed only as light CONTEXT for the model (so it
        knows which desk the pitch is aimed at) — they are NOT extracted or echoed
        back; identity stays owned by the form.
        """
        t0 = time.monotonic()
        header = "PROPOSAL DOCUMENT"
        if filename:
            header += f" (file: {filename})"
        if org_name:
            header += f"\nSubmitted by: {org_name} (identity is already known — do not extract it)."
        if category:
            header += f"\nAimed at the '{category}' desk."

        contents: list = [
            header + "\nRead the document and produce the structured brief.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=PROPOSAL_EXTRACTION_PROMPT,
            # Factual, not creative. Matches petition/association/summariser
            # (0.1) so the whole extraction pipeline stays consistent. Especially
            # important for the v2 "return empty when the document is silent"
            # fields — a higher temp would tempt the model to fill risks /
            # readiness / partnership with plausible-sounding fabrication.
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=ProposalExtraction,
            service_tier=self._service_tier,
        )
        result = self._call_with_fallback(contents=contents, config=config)
        logger.info(
            "Proposal extraction done in %dms | model=%s | title=%r | rec=%s",
            int((time.monotonic() - t0) * 1000), self._model_name,
            result.title, result.ai_recommendation.value,
        )
        return result

    # ── Resilience (mirrors petition_extraction._call_with_fallback) ────────────
    def _generate_once(self, model: str, contents: list, config) -> ProposalExtraction:
        response = self._client.models.generate_content(model=model, contents=contents, config=config)
        parsed = response.parsed
        if isinstance(parsed, ProposalExtraction):
            return parsed
        if response.text:
            return ProposalExtraction.model_validate_json(response.text)
        raise ValueError("Gemini returned an empty response with no parsed object.")

    def _call_with_fallback(self, *, contents: list, config) -> ProposalExtraction:
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
                    logger.warning("Proposal extraction failed model=%s try=%d transient=%s: %s",
                                   model, retry + 1, transient, exc)
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        raise RuntimeError(f"Proposal extraction failed on all models {models_to_try}: {last_exc}") from last_exc
