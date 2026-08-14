"""
Pydantic schema for the first-level DOCUMENT CLASSIFIER (router).

Its ONLY job is to decide the top-level TYPE of a scanned/uploaded document so
the orchestrator can dispatch it to the right specialist agent. It does NOT
sub-categorise (that is the specialist's job, e.g. the petition agent assigning
a GrievanceCategory). Keeping this to a few sharp classes is what makes it
accurate — the old approach of picking "proposals" out of 13 flat grievance
categories is exactly what produced the false positives.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class DocumentType(str, Enum):
    """Top-level routing type."""
    PETITION    = "petition"     # an individual seeking redress of their own problem
    PROPOSAL    = "proposal"     # an institution/expert offering an idea/scheme/technology
    ASSOCIATION = "association"  # a union/association/body raising a collective matter
    COURTESY    = "courtesy"     # invitation / greeting / felicitation — no ask


class ClassificationConfidence(str, Enum):
    HIGH   = "high"
    MEDIUM = "medium"
    LOW    = "low"


class DocumentClassification(BaseModel):
    """The router's decision for one document."""

    type: DocumentType = Field(
        description="The single best-fit top-level type: petition | proposal | association | courtesy.",
    )
    confidence: ClassificationConfidence = Field(
        default=ClassificationConfidence.MEDIUM,
        description="How certain the classification is. Use 'low' whenever the document is ambiguous.",
    )
    reason: str = Field(
        default="",
        description="One short English sentence naming the concrete signal(s) behind the decision.",
        # was 300 — Gemini sometimes returns a longer explanation and the whole
        # classification failed Pydantic validation, taking the row down with it.
        # This field is log-only (not stored, indexed, or gating any decision),
        # so a defensive 2000-char ceiling is plenty of headroom.
        max_length=2000,
    )
