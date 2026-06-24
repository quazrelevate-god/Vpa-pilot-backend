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
    """
    Minister PA office categories — reflects what TYPE of petition the citizen
    is raising. Used for analytics and PA team routing.
    """
    ACTION_REQUIRED         = "action_required"          # உடனடி நடவடிக்கை தேவை — urgent, time-sensitive
    PROPOSALS               = "proposals"                # முன்மொழிவுகள் — suggestions, scheme ideas
    TRANSFER_REQUESTS       = "transfer_requests"        # பணியிட மாற்றக் கோரிக்கைகள் — job/posting transfers
    PENSION_REQUESTS        = "pension_requests"         # ஓய்வூதியக் கோரிக்கைகள் — pension delays, rejections
    SCHOOL_ADMISSION        = "school_admission"         # பள்ளி சேர்க்கை — school admission issues
    JOB_REQUESTS            = "job_requests"             # வேலைவாய்ப்பு கோரிக்கைகள் — employment, job cards
    RTI                     = "rti"                      # தகவல் அறியும் உரிமை மனுக்கள் — RTI petitions
    ASSOCIATIONS_UNIONS     = "associations_unions"      # சங்கங்கள் / தொழிற்சங்கங்கள் — union / association matters
    OTHER                           = "other"                    # பிற — other / unclassified
    GENERAL                 = "general"                  # பொது மனுக்கள் — general petitions
    GREETINGS               = "greetings"                # வாழ்த்து மற்றும் மரியாதைச் செய்திகள்
    SCHOOL_UPGRADATION      = "school_upgradation"       # பள்ளி தரம் உயர்த்துதல்
    INVITATION              = "invitation"               # அழைப்பிதழ் — greetings/appreciation


# English-only labels — PA portal, dashboard analytics, API responses
CATEGORY_DISPLAY_EN: dict[str, str] = {
    "action_required":     "Action Required",
    "proposals":           "Proposals",
    "transfer_requests":   "Transfer Requests",
    "pension_requests":    "Pension Requests",
    "school_admission":    "School Admission",
    "job_requests":        "Job Requests",
    "rti":                 "RTI",
    "associations_unions": "Associations / Unions",
    "other":               "Other",
    "general":             "General",
    "greetings":           "Greetings",
    "school_upgradation":  "School Upgradation",
    "invitation":          "Invitation",
}

# Tamil-only labels — citizen-facing outputs, SMS, form display
CATEGORY_DISPLAY_TA: dict[str, str] = {
    "action_required":     "உடனடி நடவடிக்கை தேவை",
    "proposals":           "முன்மொழிவுகள்",
    "transfer_requests":   "பணியிட மாற்றக் கோரிக்கைகள்",
    "pension_requests":    "ஓய்வூதியக் கோரிக்கைகள்",
    "school_admission":    "பள்ளி சேர்க்கை",
    "job_requests":        "வேலைவாய்ப்பு கோரிக்கைகள்",
    "rti":                 "தகவல் அறியும் உரிமை",
    "associations_unions": "சங்கங்கள் / தொழிற்சங்கங்கள்",
    "other":               "பிற",
    "general":             "பொது மனுக்கள்",
    "greetings":           "வாழ்த்து செய்திகள்",
    "school_upgradation":  "பள்ளி தரம் உயர்த்துதல்",
    "invitation":          "அழைப்பிதழ்",
}

# Default alias — PA portal / dashboard use English
CATEGORY_DISPLAY = CATEGORY_DISPLAY_EN


class Department(str, Enum):
    """Tamil Nadu government departments — Gemini routes each grievance to one."""
    RURAL_DEVELOPMENT_WATER_RESOURCES        = "rural_development_water_resources"
    PUBLIC_WORKS_SPORTS_DEVELOPMENT          = "public_works_sports_development"
    HEALTH_MEDICAL_EDUCATION_FAMILY_WELFARE  = "health_medical_education_family_welfare"
    REVENUE_DISASTER_MANAGEMENT              = "revenue_disaster_management"
    FOOD_CIVIL_SUPPLIES_CONSUMER_PROTECTION  = "food_civil_supplies_consumer_protection"
    ENERGY_LAW_COURTS_PREVENTION_CORRUPTION  = "energy_law_courts_prevention_corruption"
    SCHOOL_EDUCATION_TAMIL_DEV_INFO_PUBLICITY = "school_education_tamil_dev_info_publicity"
    NATURAL_RESOURCES_MINERALS_MINES         = "natural_resources_minerals_mines"
    INDUSTRIES_INVESTMENT_PROMOTION          = "industries_investment_promotion"
    FISHERIES_FISHERMEN_WELFARE              = "fisheries_fishermen_welfare"
    ANIMAL_HUSBANDRY                         = "animal_husbandry"
    MILK_DAIRY_DEVELOPMENT                   = "milk_dairy_development"
    FORESTS                                  = "forests"
    AGRICULTURE_FARMERS_WELFARE              = "agriculture_farmers_welfare"
    ENVIRONMENT_CLIMATE_CHANGE               = "environment_climate_change"
    HOUSING_URBAN_DEVELOPMENT                = "housing_urban_development"
    COOPERATION                              = "cooperation"
    MSME                                     = "msme"
    SOCIAL_WELFARE_WOMEN_WELFARE             = "social_welfare_women_welfare"
    HANDLOOMS_TEXTILES_KHADI                 = "handlooms_textiles_khadi"
    COMMERCIAL_TAXES_REGISTRATION            = "commercial_taxes_registration"
    TRANSPORT                                = "transport"
    HR_CE                                    = "hindu_religious_charitable_endowments"
    AI_INFORMATION_TECHNOLOGY                = "ai_information_technology"
    WELFARE_NON_RESIDENT_TAMILS              = "welfare_non_resident_tamils"
    BACKWARD_CLASSES_WELFARE                 = "backward_classes_welfare"
    LABOUR_WELFARE_SKILL_DEVELOPMENT         = "labour_welfare_skill_development"
    HUMAN_RESOURCES_MANAGEMENT               = "human_resources_management"
    FINANCE_PLANNING_DEVELOPMENT             = "finance_planning_development"
    PROHIBITION_EXCISE                       = "prohibition_excise"
    TOURISM                                  = "tourism"
    HIGHER_EDUCATION_TECHNICAL_EDUCATION     = "higher_education_technical_education"
    MINORITIES_WELFARE_WAKF_BOARD            = "minorities_welfare_wakf_board"
    SOCIAL_JUSTICE_ADI_DRAVIDAR_WELFARE      = "social_justice_adi_dravidar_welfare"
    OTHER                                    = "other"


# Human-readable display names — used by PA portal and any UI surface.
DEPARTMENT_DISPLAY: dict[str, str] = {
    "rural_development_water_resources":         "Rural Development & Water Resources",
    "public_works_sports_development":           "Public Works & Sports Development",
    "health_medical_education_family_welfare":   "Health, Medical Education & Family Welfare",
    "revenue_disaster_management":               "Revenue & Disaster Management",
    "food_civil_supplies_consumer_protection":   "Food, Civil Supplies & Consumer Protection",
    "energy_law_courts_prevention_corruption":   "Energy, Law, Courts & Prevention of Corruption",
    "school_education_tamil_dev_info_publicity": "School Education, Tamil Development, Information & Publicity",
    "natural_resources_minerals_mines":          "Natural Resources (Minerals & Mines)",
    "industries_investment_promotion":           "Industries & Investment Promotion",
    "fisheries_fishermen_welfare":               "Fisheries & Fishermen Welfare",
    "animal_husbandry":                          "Animal Husbandry",
    "milk_dairy_development":                    "Milk & Dairy Development",
    "forests":                                   "Forests",
    "agriculture_farmers_welfare":               "Agriculture & Farmers Welfare",
    "environment_climate_change":                "Environment & Climate Change",
    "housing_urban_development":                 "Housing & Urban Development",
    "cooperation":                               "Cooperation",
    "msme":                                      "MSME",
    "social_welfare_women_welfare":              "Social Welfare & Women Welfare",
    "handlooms_textiles_khadi":                  "Handlooms, Textiles & Khadi",
    "commercial_taxes_registration":             "Commercial Taxes & Registration",
    "transport":                                 "Transport",
    "hindu_religious_charitable_endowments":     "Hindu Religious & Charitable Endowments (HR&CE)",
    "ai_information_technology":                 "AI & Information Technology",
    "welfare_non_resident_tamils":               "Welfare of Non-Resident Tamils",
    "backward_classes_welfare":                  "Backward Classes Welfare",
    "labour_welfare_skill_development":          "Labour Welfare & Skill Development",
    "human_resources_management":                "Human Resources Management",
    "finance_planning_development":              "Finance, Planning & Development",
    "prohibition_excise":                        "Prohibition & Excise",
    "tourism":                                   "Tourism",
    "higher_education_technical_education":      "Higher Education & Technical Education",
    "minorities_welfare_wakf_board":             "Minorities Welfare & Wakf Board",
    "social_justice_adi_dravidar_welfare":       "Social Justice & Adi Dravidar Welfare",
    "other":                                     "Other / Unclassified",
}


class UrgencyLevel(str, Enum):
    LOW      = "low"       # routine, no time pressure
    MEDIUM   = "medium"    # should be addressed this week
    HIGH     = "high"      # needs attention in 24-48 hours
    CRITICAL = "critical"  # life/safety/livelihood at immediate risk


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

    department: Department = Field(
        description=(
            "PRIMARY department — the ONE Tamil Nadu government department that "
            "owns the ROOT CAUSE of this grievance. Pick based on what is actually "
            "broken or being requested, NOT on departments merely mentioned. "
            "Example: 'school bus broke down' → transport (broken vehicle is the "
            "root cause), even though 'school' is mentioned. Example: 'PHC doctor "
            "demanded bribe' → health_medical_education_family_welfare (the service "
            "failure is in Health), NOT energy_law_courts_prevention_corruption. "
            "Use 'other' ONLY when the root cause does not plausibly fit any "
            "listed department."
        )
    )

    secondary_departments: list[Department] = Field(
        default_factory=list,
        description=(
            "0–2 ADDITIONAL departments with CLEAR partial ownership that genuinely "
            "need to be looped in. Leave empty unless a second department's "
            "involvement is unambiguous and necessary to resolve the grievance. "
            "Do NOT pad this list. Do NOT add a department just because it was "
            "mentioned in passing. The PA office uses these for cross-routing — "
            "false positives waste cycles."
        ),
        max_length=2,
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

    # ── Attachment notes ───────────────────────────────────────────────────────
    attachment_notes: Optional[str] = Field(
        default=None,
        description=(
            "If an image/PDF/audio was provided, briefly note in ENGLISH what it shows "
            "and whether it corroborates or adds to the written grievance. "
            "Omit if no attachment was processed."
        ),
        max_length=1000,
    )

    attachment_notes_ta: Optional[str] = Field(
        default=None,
        description=(
            "Tamil translation of `attachment_notes`. Omit if no attachment was processed."
        ),
        max_length=1000,
    )
