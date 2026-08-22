"""
Association / Union extraction service — Gemini (Vertex-first via shared factory).

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

from google.genai import types

from src.models.association_extraction import AssociationExtraction
from src.prompts.association_extraction import ASSOCIATION_EXTRACTION_PROMPT
from src.services.gemini_client_factory import GeminiClientBundle, build_from_settings

logger = logging.getLogger(__name__)


class AssociationExtractionService:
    """Stateless: call extract() once per uploaded association document."""

    def __init__(self, bundle: GeminiClientBundle) -> None:
        self._bundle = bundle

    @classmethod
    def from_settings(cls) -> "AssociationExtractionService":
        return cls(build_from_settings())

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
            service_tier=self._bundle.service_tier,
        )
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=config,
            response_type=AssociationExtraction,
            service_name="association_extraction",
        )
        logger.info(
            "Association extraction done in %dms | backend=%s | assoc=%r | category=%s",
            int((time.monotonic() - t0) * 1000), backend,
            result.association_name, result.category.value,
        )
        return result
