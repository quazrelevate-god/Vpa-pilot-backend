"""
Pydantic schema for the AI-generated grievance summary.

This is the single structured output contract between the Gemini summarisation
service and every consumer (form submission handler, PA portal API, SMS builder).
Never change field names without updating the migration + frontend together.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class GrievanceCategory(str, Enum):
    INFRASTRUCTURE   = "infrastructure"    # roads, lights, drainage, public buildings
    WATER_SANITATION = "water_sanitation"  # water supply, sewage, garbage
    PENSION_WELFARE  = "pension_welfare"   # pension stoppage, welfare schemes
    HEALTH           = "health"            # hospitals, medicine, ambulance
    EDUCATION        = "education"         # schools, teachers, scholarships
    LAND_REVENUE     = "land_revenue"      # land disputes, pattas, survey issues
    ELECTRICITY      = "electricity"       # power cuts, meter issues, bills
    LEGAL_JUSTICE    = "legal_justice"     # police complaints, FIR, court matters
    EMPLOYMENT       = "employment"        # MGNREGS, job cards, unemployment
    HOUSING          = "housing"           # PM Awas, housing schemes
    CORRUPTION       = "corruption"        # bribery, misuse of office
    DISASTER_RELIEF  = "disaster_relief"   # flood, fire, crop damage
    OTHER            = "other"


class UrgencyLevel(str, Enum):
    LOW      = "low"       # routine, no time pressure
    MEDIUM   = "medium"    # should be addressed this week
    HIGH     = "high"      # needs attention in 24-48 hours
    CRITICAL = "critical"  # life/safety/livelihood at immediate risk


class CitizenSentiment(str, Enum):
    DISTRESSED  = "distressed"   # fear, desperation, crying for help
    FRUSTRATED  = "frustrated"   # repeated attempts, system failed them
    NEUTRAL     = "neutral"      # factual, calm request
    HOPEFUL     = "hopeful"      # believes the Minister can resolve it


class GrievanceSummary(BaseModel):
    """
    Structured output produced by the Gemini summarisation call.
    Every narrative field has an English (_en) and a Tamil (_ta) version so a
    PA can read the summary in either language without switching tools.
    Enum fields (category, urgency, sentiment) are always English — they are
    used programmatically for routing and statistics.
    """

    # ── What happened — English ────────────────────────────────────────────────
    headline: str = Field(
        description=(
            "One crisp sentence (≤ 15 words) in ENGLISH stating what the grievance is "
            "about. Written as a neutral case title, not a question or directive."
        ),
        max_length=150,
    )

    summary: str = Field(
        description=(
            "2-3 sentences in ENGLISH. Captures: who the citizen is, what specific "
            "problem they face, how long it has been ongoing, and any impact on their "
            "life or safety. Preserve the citizen's voice — do not reframe or minimise."
        ),
        max_length=600,
    )

    # ── What happened — Tamil ──────────────────────────────────────────────────
    headline_ta: str = Field(
        description=(
            "Same as `headline` but written in TAMIL (தமிழ்). "
            "Natural Tamil — not a word-for-word back-translation. "
            "Example: 'மதுரை தெற்கு தொகுதியில் 4 மாதமாக முதியோர் ஓய்வூதியம் நின்றது.'"
        ),
        max_length=200,
    )

    summary_ta: str = Field(
        description=(
            "Same as `summary` but written in TAMIL (தமிழ்). "
            "Use clear, simple Tamil that a field PA officer can read aloud to the citizen."
        ),
        max_length=800,
    )

    # ── Classification ─────────────────────────────────────────────────────────
    category: GrievanceCategory = Field(
        description="Best-fit category for routing and statistics (always English enum)."
    )

    urgency: UrgencyLevel = Field(
        description=(
            "Urgency level inferred from the grievance content. "
            "Mark HIGH if the citizen mentions pending deadlines, health risk, or "
            "financial distress. Mark CRITICAL if there is immediate danger to life, "
            "safety, or total loss of livelihood. Always English enum."
        )
    )

    urgency_reason: Optional[str] = Field(
        default=None,
        description=(
            "Required when urgency is HIGH or CRITICAL. "
            "One sentence in ENGLISH explaining the specific signal that raised urgency."
        ),
        max_length=200,
    )

    urgency_reason_ta: Optional[str] = Field(
        default=None,
        description=(
            "Tamil translation of `urgency_reason`. Required when urgency is HIGH or "
            "CRITICAL. One sentence in TAMIL explaining why urgency was raised."
        ),
        max_length=300,
    )

    # ── What the citizen wants — English ──────────────────────────────────────
    citizen_ask: str = Field(
        description=(
            "In ENGLISH: exactly what action the citizen is requesting. "
            "Specific and concrete — not 'help' but 'repair the street light on "
            "4th Cross within the week'. Multiple asks separated by '; '."
        ),
        max_length=300,
    )

    # ── What the citizen wants — Tamil ────────────────────────────────────────
    citizen_ask_ta: str = Field(
        description=(
            "Same as `citizen_ask` but written in TAMIL (தமிழ்). "
            "What the citizen is asking for, in clear Tamil."
        ),
        max_length=400,
    )

    # ── Supporting detail — English ────────────────────────────────────────────
    key_details: list[str] = Field(
        description=(
            "3-6 factual bullet points in ENGLISH extracted from the grievance. "
            "Include: location, duration, scheme names, amounts, dates, reference numbers."
        ),
        min_length=1,
        max_length=6,
    )

    # ── Supporting detail — Tamil ──────────────────────────────────────────────
    key_details_ta: list[str] = Field(
        description=(
            "Same bullet points as `key_details` but written in TAMIL (தமிழ்). "
            "Preserve Tamil proper nouns, place names, and amounts verbatim."
        ),
        min_length=1,
        max_length=6,
    )

    sentiment: CitizenSentiment = Field(
        description="Emotional tone inferred from the text and/or audio (always English enum)."
    )

    # ── Attachment notes ───────────────────────────────────────────────────────
    attachment_notes: Optional[str] = Field(
        default=None,
        description=(
            "If an image/PDF/audio was provided, briefly note in ENGLISH what it shows "
            "and whether it corroborates or adds to the written grievance. "
            "Omit if no attachment was processed."
        ),
        max_length=200,
    )

    attachment_notes_ta: Optional[str] = Field(
        default=None,
        description=(
            "Tamil translation of `attachment_notes`. Omit if no attachment was processed."
        ),
        max_length=300,
    )
