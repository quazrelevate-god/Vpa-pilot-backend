"""
Pydantic schema for the AI-extracted PROPOSAL brief.

This is the structured-output contract between ProposalExtractionService (Gemini)
and the Proposal Review UI. It is deliberately NOTHING like GrievanceSummary —
a proposal is a pitch to be judged, not a grievance to be routed and resolved,
so there is no urgency / district / ministry-root-cause here. Instead it carries
the shape a Minister needs to decide: problem → solution → benefit → cost.

Identity (org, person, contact) is NOT in this schema — the /proposal form owns
that as ground truth; Gemini only reads the document's substance.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ProposalRecommendation(str, Enum):
    """A triage HINT for the human reviewer — never a decision.

    review_closely  — concrete, specific, clear beneficiary + usually a cost.
    standard        — reasonable but routine; no urgency.
    needs_more_info — vague / missing core details (what, who, cost).
    """
    REVIEW_CLOSELY  = "review_closely"
    STANDARD        = "standard"
    NEEDS_MORE_INFO = "needs_more_info"


# English-only labels for the review UI / analytics
RECOMMENDATION_DISPLAY_EN: dict[str, str] = {
    "review_closely":  "Review closely",
    "standard":        "Standard",
    "needs_more_info": "Needs more info",
}
RECOMMENDATION_DISPLAY_TA: dict[str, str] = {
    "review_closely":  "கூர்ந்து பரிசீலிக்க",
    "standard":        "வழக்கமானது",
    "needs_more_info": "கூடுதல் தகவல் தேவை",
}


class ProposalExtraction(BaseModel):
    """One proposal document, distilled into a Minister-ready brief."""

    title: str = Field(
        default="",
        description="A crisp 4–8 word name for the proposal, in English.",
        max_length=140,
    )
    title_ta: str = Field(
        default="",
        description="The title in Tamil (தமிழ்).",
        max_length=200,
    )

    problem_statement: str = Field(
        default="",
        description="The gap, need or issue this proposal addresses. 1–3 sentences, grounded in the document.",
    )
    problem_statement_ta: str = Field(default="", description="problem_statement in Tamil.")

    proposed_solution: str = Field(
        default="",
        description="What the applicant is actually proposing to do. 1–3 sentences.",
    )
    proposed_solution_ta: str = Field(default="", description="proposed_solution in Tamil.")

    expected_benefit: str = Field(
        default="",
        description="The claimed outcome / impact if adopted. 1–3 sentences.",
    )
    expected_benefit_ta: str = Field(default="", description="expected_benefit in Tamil.")

    beneficiary_scope: str = Field(
        default="",
        description="Who and how many this touches (e.g. '≈12,000 students across 40 schools'). 'Not specified' if absent.",
    )
    beneficiary_scope_ta: str = Field(default="", description="beneficiary_scope in Tamil.")

    estimated_cost: str = Field(
        default="Not specified",
        description="The funding ask / cost, VERBATIM as stated in the document, or 'Not specified'. Never invent a figure.",
        max_length=200,
    )
    timeline: str = Field(
        default="Not specified",
        description="The stated duration / rollout period, or 'Not specified'.",
        max_length=200,
    )

    key_highlights: list[str] = Field(
        default_factory=list,
        description="3–5 short scannable phrases (2–6 words each) capturing the essence.",
    )
    key_highlights_ta: list[str] = Field(
        default_factory=list,
        description="key_highlights in Tamil, same order.",
    )

    ai_recommendation: ProposalRecommendation = Field(
        default=ProposalRecommendation.STANDARD,
        description="Triage hint for the reviewer: review_closely | standard | needs_more_info. NOT a decision.",
    )
    ai_rationale: str = Field(
        default="",
        description="One short English sentence justifying the recommendation, pointing at a concrete signal.",
        max_length=300,
    )

    document_date: Optional[str] = Field(
        default=None,
        description=(
            "The date WRITTEN ON the proposal document (its cover/letterhead/"
            "signature date) as ISO 8601 'YYYY-MM-DD'. The document's own date, "
            "NOT today's date or the submission date. Convert any written form to "
            "YYYY-MM-DD. Return NULL if no date is clearly written — never guess."
        ),
    )
