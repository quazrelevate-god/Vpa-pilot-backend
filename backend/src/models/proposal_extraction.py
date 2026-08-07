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


class ProposalCategory(str, Enum):
    """The four desks a proposal can sit with — mirrors _VALID_CATEGORIES on the
    public /proposal intake so the AI's guess and the form's picker share one
    vocabulary. Used ONLY when the AI must guess (scanned uploads with no form
    input); on the form path the applicant's choice always wins.
    """
    SCHOOL = "school"          # School Education
    TAMIL = "tamil"            # Tamil & Heritage
    INFORMATION = "information"  # Information & Publicity
    FILM = "film"              # Film


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

    # Desk (category) guess — only used when the AI must decide, i.e. scanned
    # uploads with no form to source it from. On the /proposal form path the
    # applicant's picked category is authoritative and this field is ignored.
    suggested_category: Optional[ProposalCategory] = Field(
        default=None,
        description=(
            "Which of the four desks the proposal belongs with: school | tamil | "
            "information | film. Null if the document doesn't clearly fit any."
        ),
    )
    suggested_category_rationale: str = Field(
        default="",
        description="One short English sentence naming the concrete signal used to pick the desk.",
        max_length=240,
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

    # ── v2 additions — Minister-facing decision context ─────────────────────────
    # Every field below defaults to empty / "Not specified" so proposals extracted
    # before this schema was extended still parse.

    key_risks: list[str] = Field(
        default_factory=list,
        description=(
            "Up to 4 short risk points the Minister should weigh before deciding "
            "(execution risk, funding risk, political risk, dependency, timeline "
            "risk, technology risk, etc.). Extracted ONLY from what the document "
            "acknowledges OR from concrete red flags in what it proposes — never "
            "generic risk language. If the document is silent and shows no red "
            "flags, return an EMPTY LIST — never invent risks."
        ),
    )
    key_risks_ta: list[str] = Field(
        default_factory=list,
        description="key_risks in Tamil, same order and length.",
    )

    implementation_readiness: str = Field(
        default="",
        description=(
            "One tight sentence on whether the applicant can execute this now: "
            "prior pilot, partners already lined up, team/infra in place, or "
            "regulatory clearances secured. If the document doesn't speak to "
            "readiness, return empty string — do not speculate."
        ),
        max_length=400,
    )
    implementation_readiness_ta: str = Field(default="", description="implementation_readiness in Tamil.")

    applicant_contribution: str = Field(
        default="Not specified",
        description=(
            "How much the applicant is putting in themselves (₹, %, in-kind, or "
            "the words used), VERBATIM from the document. 'Not specified' if the "
            "document does not state a co-investment or contribution. Never invent."
        ),
        max_length=200,
    )

    partnership_model: str = Field(
        default="",
        description=(
            "One tight sentence naming the partnership structure the document "
            "describes (PPP with X, CSR-funded via Y, direct-govt implementation, "
            "consortium of Z & W). Empty string if the document doesn't specify."
        ),
        max_length=400,
    )
    partnership_model_ta: str = Field(default="", description="partnership_model in Tamil.")

    track_record: str = Field(
        default="",
        description=(
            "One tight sentence on the applicant's prior deployments / relevant "
            "results as STATED IN THE PROPOSAL DOCUMENT (e.g. 'Deployed same "
            "platform in 40 Kerala panchayats since 2023 with X outcomes.'). "
            "Empty string if the document doesn't mention prior work — do not "
            "search the web or invent history."
        ),
        max_length=400,
    )
    track_record_ta: str = Field(default="", description="track_record in Tamil.")
