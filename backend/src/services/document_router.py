"""
Document router — the orchestration "workflow" that ties the classifier to the
specialist agents.

    document  ->  ClassificationService (type)  ->  the matching extractor
                    petition    -> PetitionExtractionService
                    proposal    -> ProposalExtractionService
                    association -> AssociationExtractionService
                    courtesy    -> no extraction (skip)

It returns the decided type + the specialist's extraction; the CALLER (AI Uploads
/ scan-petition) persists the result to the right table. Keeping routing separate
from persistence keeps each entry point thin.

Safety: a proposal/association verdict at LOW confidence is downgraded to petition
— a real grievance must never be misrouted out of the petition queue.
"""
from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Optional

from src.models.document_classification import DocumentType, ClassificationConfidence
from src.services.classification_service import ClassificationService
from src.services.petition_extraction import PetitionExtractionService
from src.services.proposal_extraction import ProposalExtractionService
from src.services.proposal_identity_extraction import ProposalIdentityExtractionService
from src.services.association_extraction import AssociationExtractionService

logger = logging.getLogger(__name__)

# Concurrency governance for the (blocking) Gemini extraction calls this router
# makes. Previously route() built a fresh ThreadPoolExecutor per call, so N
# concurrent bulk-upload requests spawned N×2 threads each blocking a Gemini
# call — no global cap, no back-pressure, uncontrolled spend. Now:
#   • one shared pool runs the proposal content+identity pair in parallel;
#   • one process-wide bounded semaphore caps TOTAL in-flight extractions,
#     sized to the paid Gemini tier via DOC_ROUTER_MAX_CONCURRENCY.
_MAX_CONCURRENT_EXTRACTIONS = max(1, int(os.getenv("DOC_ROUTER_MAX_CONCURRENCY", "4")))
_PARALLEL_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="docrouter")
_GEMINI_GATE = threading.BoundedSemaphore(_MAX_CONCURRENT_EXTRACTIONS)


def _gated(fn: Callable, /, **kwargs):
    """Run a blocking extraction call while holding a global concurrency permit."""
    with _GEMINI_GATE:
        return fn(**kwargs)


@dataclass
class RoutedResult:
    type: str                       # final DocumentType value (after the safety downgrade)
    classified_type: str            # what the classifier actually said
    confidence: str
    reason: str
    extraction: Optional[Any]       # PetitionExtraction | ProposalExtraction | AssociationExtraction | None
    identity: Optional[Any] = None  # ProposalIdentity — only for scanned proposals


class DocumentRouter:
    """Stateless orchestrator: classify once, then run the matching agent."""

    def route(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> RoutedResult:
        cls = ClassificationService.from_settings().classify(
            file_bytes=file_bytes, mime_type=mime_type, filename=filename
        )
        final = cls.type
        # Never route OUT of the petition queue on a shaky call.
        if cls.confidence == ClassificationConfidence.LOW and final in (DocumentType.PROPOSAL, DocumentType.ASSOCIATION):
            logger.info("router: downgrading low-confidence %s -> petition", final.value)
            final = DocumentType.PETITION

        extraction: Optional[Any] = None
        identity: Optional[Any] = None
        if final == DocumentType.PETITION:
            extraction = _gated(
                PetitionExtractionService.from_settings().extract,
                file_bytes=file_bytes, mime_type=mime_type, filename=filename,
            )
        elif final == DocumentType.PROPOSAL:
            # Scanned proposal has no intake form — run the CONTENT agent and the
            # IDENTITY agent IN PARALLEL and merge (pitch + org/contact off the page).
            # Shared pool + per-call semaphore (see _gated) instead of a fresh
            # ThreadPoolExecutor per request.
            content_svc = ProposalExtractionService.from_settings()
            identity_svc = ProposalIdentityExtractionService.from_settings()
            f_content = _PARALLEL_POOL.submit(
                _gated, content_svc.extract, file_bytes=file_bytes, mime_type=mime_type, filename=filename
            )
            f_identity = _PARALLEL_POOL.submit(
                _gated, identity_svc.extract, file_bytes=file_bytes, mime_type=mime_type, filename=filename
            )
            extraction = f_content.result()
            identity = f_identity.result()
        elif final == DocumentType.ASSOCIATION:
            extraction = _gated(
                AssociationExtractionService.from_settings().extract,
                file_bytes=file_bytes, mime_type=mime_type, filename=filename,
            )
        # COURTESY -> no extraction

        logger.info("router: %s (classified=%s, confidence=%s)", final.value, cls.type.value, cls.confidence.value)
        return RoutedResult(
            type=final.value,
            classified_type=cls.type.value,
            confidence=cls.confidence.value,
            reason=cls.reason,
            extraction=extraction,
            identity=identity,
        )


document_router = DocumentRouter()
