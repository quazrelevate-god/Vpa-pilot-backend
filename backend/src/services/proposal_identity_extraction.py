"""
Proposal identity agent — Gemini (Vertex-first via shared client factory).

Extracts the submitter's organisation + contact from a SCANNED proposal document
(no intake form). Runs in parallel with the proposal content agent; the router
merges the two. Identity only, strict.

Prompt: src/prompts/proposal_identity.py.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google.genai import types

from src.models.proposal_identity import ProposalIdentity
from src.prompts.proposal_identity import PROPOSAL_IDENTITY_PROMPT
from src.services.gemini_client_factory import GeminiClientBundle, build_from_settings

logger = logging.getLogger(__name__)


class ProposalIdentityExtractionService:
    """Stateless: call extract() once per scanned proposal document."""

    def __init__(self, bundle: GeminiClientBundle) -> None:
        self._bundle = bundle

    @classmethod
    def from_settings(cls) -> "ProposalIdentityExtractionService":
        return cls(build_from_settings())

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
            service_tier=self._bundle.service_tier,
        )
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=config,
            response_type=ProposalIdentity,
            service_name="proposal_identity",
        )
        logger.info(
            "Proposal identity done in %dms | backend=%s | org=%r | person=%r",
            int((time.monotonic() - t0) * 1000), backend,
            result.org_name, result.person_name,
        )
        return result
