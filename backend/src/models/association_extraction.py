"""
Pydantic schema for the AI-extracted ASSOCIATION / UNION submission.

Same approach as a petition: it EXTENDS GrievanceSummary, so it carries the exact
same categorisation (GrievanceCategory), ministry, urgency, district, summary,
key_details and document_date as a petition — then adds the association's own
identity, collective ask, and a Minister-facing decision context (why now,
expected outcome, risks of ignoring, prior dealings, and a triage hint).

Identity is read from the document (scans have no intake form), so name fields
are extracted like the petition path.

Every v2 field defaults to empty so associations extracted before this schema
was extended still parse without a migration.
"""
from __future__ import annotations

import logging
from enum import Enum

from pydantic import Field, field_validator

from src.models.grievance_summary import GrievanceCategory, GrievanceSummary


logger = logging.getLogger(__name__)


# Grievance categories that must NEVER appear on an association — the intake
# router already sent proposals / greetings / invitations away to their own
# tables, and 'associations_unions' is the redundant self-label the prompt
# bans (it would say "this association is about associations"). If Gemini
# defies the prompt and picks one anyway, coerce to 'other' so the record
# still lands and analytics stay sane. See `_coerce_banned_category` below.
_NON_ASSOCIATION_CATEGORIES: frozenset[GrievanceCategory] = frozenset({
    GrievanceCategory.PROPOSALS,
    GrievanceCategory.GREETINGS,
    GrievanceCategory.INVITATION,
    GrievanceCategory.ASSOCIATIONS_UNIONS,
})


class AssociationRecommendation(str, Enum):
    """A triage HINT for the human reviewer — never a decision.

    engage_now       — high-leverage / time-critical / large body — Minister should meet
                       or respond soon (protests threatened, election window, deadline).
    routine          — standard collective ask; reviewer can process at normal pace.
    refer            — the ask is operational and best handled at the concerned
                       department level.
    needs_more_info  — identity / ask unclear or a key fact missing; clarify before
                       deciding.
    """
    ENGAGE_NOW      = "engage_now"
    ROUTINE         = "routine"
    REFER           = "refer"
    NEEDS_MORE_INFO = "needs_more_info"


# English + Tamil labels for the review UI / analytics.
RECOMMENDATION_DISPLAY_EN: dict[str, str] = {
    "engage_now":      "Engage now",
    "routine":         "Routine",
    "refer":           "Refer to department",
    "needs_more_info": "Needs more info",
}
RECOMMENDATION_DISPLAY_TA: dict[str, str] = {
    "engage_now":      "உடனடி பங்கேற்பு",
    "routine":         "வழக்கமானது",
    "refer":           "துறைக்கு அனுப்ப",
    "needs_more_info": "கூடுதல் தகவல் தேவை",
}


class AssociationExtraction(GrievanceSummary):
    """GrievanceSummary + association identity + collective demand + decision context."""

    # Post-parse guard: if Gemini disobeys the prompt and returns one of the
    # non-association categories (proposals/greetings/invitation/
    # associations_unions), silently coerce to 'other' so the record still
    # lands and analytics don't get polluted. Log at WARNING so we notice if
    # the model starts drifting. Runs BEFORE the pydantic enum coercion so
    # both strings and GrievanceCategory instances hit the same branch.
    @field_validator("category", mode="before")
    @classmethod
    def _coerce_banned_category(cls, v):
        try:
            enum_val = GrievanceCategory(v) if not isinstance(v, GrievanceCategory) else v
        except ValueError:
            return v  # let the base validator complain about truly-unknown values
        if enum_val in _NON_ASSOCIATION_CATEGORIES:
            logger.warning(
                "association extraction returned banned category %r — coercing to 'other'. "
                "Prompt bans it; update the prompt if the model keeps drifting.",
                enum_val.value,
            )
            return GrievanceCategory.OTHER
        return enum_val

    # ── Identity ────────────────────────────────────────────────────────────────
    association_name: str = Field(
        default="",
        description=(
            "The stated name of the union/association/federation/sangam/body, in the "
            "script it is written in. Empty string '' if not clearly stated. Never invent."
        ),
        max_length=300,
    )
    member_count: str = Field(
        default="Not specified",
        description="Membership size if stated (verbatim, e.g. '12,000 members'), else 'Not specified'.",
        max_length=120,
    )
    representative_name: str = Field(
        default="",
        description="The office-bearer signing on behalf of the body. Empty string '' if not clearly identifiable.",
        max_length=200,
    )
    representative_designation: str = Field(
        default="",
        description="The office-bearer's role (President, General Secretary, …). Empty string '' if unclear.",
        max_length=200,
    )

    # ── The ask ─────────────────────────────────────────────────────────────────
    association_ask: str = Field(
        default="",
        description="The collective demand in one clear English line — what the body wants the government to do.",
    )
    association_ask_ta: str = Field(
        default="",
        description="association_ask in natural Tamil (தமிழ்).",
    )

    # ── v2: Minister-facing decision context ────────────────────────────────────
    # Every field below defaults to empty / "Not specified" so associations
    # extracted before this schema was extended still parse.

    demand_context: str = Field(
        default="",
        description=(
            "One tight sentence on WHY NOW — the trigger, the deadline, the "
            "event driving this ask (a government order, a court date, an "
            "upcoming exam, a policy change, a season). Extracted ONLY from "
            "what the document actually says — if the document is silent on "
            "the trigger, return empty string. Never invent a context."
        ),
        max_length=400,
    )
    demand_context_ta: str = Field(default="", description="demand_context in Tamil.")

    expected_outcome: str = Field(
        default="",
        description=(
            "One tight sentence on the concrete outcome the body wants to see "
            "if the government acts (regularisation of N posts, release of "
            "delayed dues, revocation of order X). Grounded in the document. "
            "Empty string if the document doesn't specify a target outcome."
        ),
        max_length=400,
    )
    expected_outcome_ta: str = Field(default="", description="expected_outcome in Tamil.")

    key_stakeholders: list[str] = Field(
        default_factory=list,
        description=(
            "Up to 4 short items (2–5 words each) naming notable people, "
            "affiliations, backers or partner bodies the DOCUMENT itself names "
            "(e.g. 'MLA Ram Kumar (Salem)', 'Backed by TN Federation'). Do NOT "
            "list generic 'members' or invent names. Empty list if the document "
            "names no stakeholders beyond the signing office-bearer."
        ),
    )
    key_stakeholders_ta: list[str] = Field(
        default_factory=list,
        description="key_stakeholders in Tamil, same order and length.",
    )

    risks_if_ignored: list[str] = Field(
        default_factory=list,
        description=(
            "Up to 4 short risk points the Minister should weigh before "
            "declining or delaying — extracted ONLY from what the document "
            "STATES will happen (protests, hunger strike, legal action, media "
            "escalation, factional shift) OR from concrete red flags in the "
            "letter's tone. Never generic risk language. Empty list if the "
            "document is silent and shows no such flags."
        ),
    )
    risks_if_ignored_ta: list[str] = Field(
        default_factory=list,
        description="risks_if_ignored in Tamil, same order and length.",
    )

    precedent_context: str = Field(
        default="",
        description=(
            "One tight sentence on prior dealings the document mentions — "
            "earlier meetings with the Minister, prior promises, GOs already "
            "issued, cases already filed. Empty string if the document says "
            "nothing about history. Do NOT search the web or infer history."
        ),
        max_length=400,
    )
    precedent_context_ta: str = Field(default="", description="precedent_context in Tamil.")

    ai_recommendation: AssociationRecommendation = Field(
        default=AssociationRecommendation.ROUTINE,
        description=(
            "Triage hint for the reviewer: engage_now | routine | refer | "
            "needs_more_info. NOT a decision — the Minister / PA still decides."
        ),
    )
    ai_rationale: str = Field(
        default="",
        description=(
            "One short English sentence justifying the recommendation, pointing "
            "at a concrete signal from the document (member count, deadline, "
            "prior GO, stated escalation)."
        ),
        max_length=300,
    )
    ai_rationale_ta: str = Field(default="", description="ai_rationale in Tamil.")
