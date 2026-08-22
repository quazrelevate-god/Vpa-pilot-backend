"""
Proposal Extraction Service — Gemini (Vertex-first via shared factory).

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

from google.genai import types

from src.models.proposal_extraction import ProposalExtraction
from src.prompts.proposal_extraction import PROPOSAL_EXTRACTION_PROMPT
from src.services.gemini_client_factory import GeminiClientBundle, build_from_settings

logger = logging.getLogger(__name__)


class ProposalExtractionService:
    """Stateless: call extract() once per uploaded proposal document."""

    def __init__(self, bundle: GeminiClientBundle) -> None:
        self._bundle = bundle

    @classmethod
    def from_settings(cls) -> "ProposalExtractionService":
        return cls(build_from_settings())

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
            service_tier=self._bundle.service_tier,
        )
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=config,
            response_type=ProposalExtraction,
            service_name="proposal_extraction",
        )
        logger.info(
            "Proposal extraction done in %dms | backend=%s | title=%r | rec=%s",
            int((time.monotonic() - t0) * 1000), backend,
            result.title, result.ai_recommendation.value,
        )
        return result
