"""
Document classifier (router) — decides the top-level TYPE of a scanned/uploaded
document (petition | proposal | association | courtesy) so the orchestrator can
dispatch it to the right specialist agent.

One cheap, deterministic Gemini call. It does NOT summarise or sub-categorise —
that is the specialist's job. Prompt lives in src/prompts/document_classification.py.
Routes via the shared gemini_client_factory (Vertex-first with direct API fallback).
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google.genai import types

from src.models.document_classification import DocumentClassification, DocumentType, ClassificationConfidence
from src.prompts.document_classification import DOCUMENT_CLASSIFICATION_PROMPT
from src.services.gemini_client_factory import GeminiClientBundle, build_from_settings

logger = logging.getLogger(__name__)


class ClassificationService:
    """Stateless: call classify() once per document."""

    def __init__(self, bundle: GeminiClientBundle) -> None:
        self._bundle = bundle

    @classmethod
    def from_settings(cls) -> "ClassificationService":
        return cls(build_from_settings())

    def classify(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> DocumentClassification:
        """One Gemini call: decide the document's top-level type."""
        t0 = time.monotonic()
        contents: list = [
            "DOCUMENT TO CLASSIFY" + (f" (file: {filename})" if filename else "")
            + ". Decide its single top-level type.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=DOCUMENT_CLASSIFICATION_PROMPT,
            temperature=0.0,            # deterministic routing
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=DocumentClassification,
            service_tier=self._bundle.service_tier,
        )
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=config,
            response_type=DocumentClassification,
            service_name="classification",
        )
        logger.info(
            "Classification done in %dms | backend=%s | type=%s | confidence=%s",
            int((time.monotonic() - t0) * 1000), backend,
            result.type.value, result.confidence.value,
        )
        return result
