"""
Proposal identity agent — Gemini.

Extracts the submitter's organisation + contact from a SCANNED proposal document
(no intake form). Runs in parallel with the proposal content agent; the router
merges the two. Identity only, strict.

Prompt: src/prompts/proposal_identity.py.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google import genai
from google.genai import types

from src.models.proposal_identity import ProposalIdentity
from src.prompts import PROPOSAL_IDENTITY_PROMPT
from src.services.summarisation import (
    PRIMARY_MODEL, FALLBACK_MODEL, FALLBACK_MODEL2,
    SERVICE_TIER, _TRANSIENT_MARKERS,
    _MAX_RETRIES_PER_MODEL, _BACKOFF_BASE_SECONDS,
)

logger = logging.getLogger(__name__)


class ProposalIdentityExtractionService:
    """Stateless: call extract() once per scanned proposal document."""

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
    def from_settings(cls) -> "ProposalIdentityExtractionService":
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

    def extract(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> ProposalIdentity:
        t0 = time.monotonic()
        contents: list = [
            "SCANNED PROPOSAL DOCUMENT" + (f" (file: {filename})" if filename else "")
            + ". Extract ONLY the submitter's identity + contact.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=PROPOSAL_IDENTITY_PROMPT,
            temperature=0.0,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=ProposalIdentity,
            service_tier=self._service_tier,
        )
        result = self._call_with_fallback(contents=contents, config=config)
        logger.info("Proposal identity done in %dms | org=%r | person=%r",
                    int((time.monotonic() - t0) * 1000), result.org_name, result.person_name)
        return result

    def _generate_once(self, model: str, contents: list, config) -> ProposalIdentity:
        response = self._client.models.generate_content(model=model, contents=contents, config=config)
        parsed = response.parsed
        if isinstance(parsed, ProposalIdentity):
            return parsed
        if response.text:
            return ProposalIdentity.model_validate_json(response.text)
        raise ValueError("Gemini returned an empty response with no parsed object.")

    def _call_with_fallback(self, *, contents: list, config) -> ProposalIdentity:
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
                    logger.warning("Proposal identity failed model=%s try=%d transient=%s: %s",
                                   model, retry + 1, transient, exc)
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        raise RuntimeError(f"Proposal identity failed on all models {models_to_try}: {last_exc}") from last_exc
