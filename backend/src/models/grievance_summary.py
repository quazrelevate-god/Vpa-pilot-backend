"""
Pydantic schema for the AI-generated grievance summary.

This is the single structured output contract between the Gemini summarisation
service and every consumer (form submission handler, PA portal API, SMS builder).
Never change field names without updating the migration + frontend together.

Note on vocabulary: "Ministry" here means the top-level government body that
contains the Minister's office (e.g. School Education, Transport, Revenue).
The sub-department inside a Ministry (e.g. SCERT, Elementary Education) is
tracked separately on the ticket, and is still called "department" there.
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
    OTHER                   = "other"                    # பிற — other / unclassified
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


class Ministry(str, Enum):
    """
    Tamil Nadu Ministries — Gemini routes each grievance to exactly one.
    A Ministry is the top-level portfolio that contains a Minister's office
    (School Education, Transport, Revenue …). The sub-department inside a
    Ministry (SCERT, Elementary Education, RTO …) lives on the ticket, not here.
    """
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
MINISTRY_DISPLAY: dict[str, str] = {
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

    Narrative fields (summary, citizen_ask, key_details) have both an English
    version and a Tamil (_ta) version. Enum fields (category, ministry, urgency)
    are English-only — they are used programmatically for routing and stats.
    Citizen name is echoed in both scripts (name_en / name_ta): the form
    submission fills whichever the citizen typed; the model fills the other.
    """

    # ── Citizen identity — bilingual ──────────────────────────────────────────
    name_en: str = Field(
        default="",
        description=(
            "Citizen's name in ENGLISH / Latin script. If the form submitted a "
            "Latin-script name, keep it verbatim. If the form submitted a Tamil "
            "name, transliterate it into English here (e.g. 'முருகன்' → 'Murugan'). "
            "Do not translate meaning — just the script."
        ),
        max_length=200,
    )
    name_ta: str = Field(
        default="",
        description=(
            "Citizen's name in TAMIL script (தமிழ்). If the form submitted a "
            "Tamil name, keep it verbatim. If the form submitted a Latin-script "
            "name, transliterate it into Tamil script (e.g. 'Murugan' → 'முருகன்'). "
            "Do not translate meaning — just the script."
        ),
        max_length=200,
    )

    # ── One-liner subject ─────────────────────────────────────────────────────
    citizen_ask: str = Field(
        description=(
            "SUBJECT / REGARDING line — ONE short sentence in ENGLISH stating "
            "exactly what the citizen is asking for. This is what the PA reads "
            "first to know what the petition is about. Concrete, not vague: "
            "not 'help' but 'restart my old-age pension stopped since Aug 2025'. "
            "Under 20 words. NO greeting, NO preamble, NO 'I request…' — just "
            "the ask itself."
        ),
        max_length=300,
    )
    citizen_ask_ta: str = Field(
        description=(
            "Same one-line SUBJECT / REGARDING as `citizen_ask`, in natural "
            "TAMIL (தமிழ்). Not a word-for-word back-translation — write it as "
            "a Tamil-speaking PA officer would. Under 30 Tamil words."
        ),
        max_length=400,
    )

    # ── Body summary — distinct bullets, not narrative ────────────────────────
    summary: str = Field(
        description=(
            "In ENGLISH: the full picture, as a series of DISTINCT POINTS. "
            "Petitions can be 1 line or 20 pages — do NOT retell as prose. "
            "Extract every distinct point the citizen makes (background, "
            "problem, prior attempts, damage, requests) and list them as short "
            "bullets separated by newlines, each starting with '• '. 3 to 10 "
            "bullets typical. One idea per bullet. Preserve exact figures, "
            "dates, names, scheme names, reference numbers verbatim."
        ),
        max_length=3000,
    )
    summary_ta: str = Field(
        description=(
            "Same bulleted points as `summary`, in natural TAMIL (தமிழ்). Use "
            "the same '• ' prefix and newline-separated bullets. Keep Tamil "
            "proper nouns, place names, scheme names, and figures verbatim."
        ),
        max_length=4000,
    )

    # ── Classification ────────────────────────────────────────────────────────
    category: GrievanceCategory = Field(
        description="Best-fit petition category (always English enum)."
    )

    ministry: Ministry = Field(
        description=(
            "The ONE Tamil Nadu Ministry that owns the ROOT CAUSE of this "
            "grievance. Pick based on what is actually broken or being "
            "requested, NOT on which words appear in the text. See the "
            "ministry routing rules in the system prompt for worked examples."
        )
    )

    urgency: UrgencyLevel = Field(
        description=(
            "Calibrated urgency — NOT tone-based. Ignore emotional writing "
            "style. Only real signals raise urgency: firm deadlines (exam, "
            "court, medical), imminent health/safety risk, active eviction/"
            "demolition, imminent livelihood loss. Transfer requests are "
            "ALWAYS low (they depend on other schools' vacancies). See the "
            "urgency calibration rules in the system prompt."
        )
    )

    # ── Supporting evidence ───────────────────────────────────────────────────
    key_details: list[str] = Field(
        description=(
            "3–8 short factual bullets in ENGLISH capturing the concrete "
            "evidence that supports the petition. INCLUDE, when present: "
            "specific ACTS / SECTIONS / RULES cited (e.g. 'RTE Act 2009 "
            "§12(1)(c)'), TABLES / ORDERS / GOs referenced (e.g. 'G.O. Ms. "
            "No. 45 dated 12-Feb-2024'), CASE / REFERENCE / APPLICATION "
            "NUMBERS, IMAGES / DOCUMENTS attached and what each one shows "
            "(e.g. 'attached photo shows collapsed compound wall'), PRIOR "
            "ESCALATION history (RTI filed, complaints sent, dates), "
            "AMOUNTS / DATES / DURATIONS, and LOCATION. Do not invent — "
            "only include what is stated or visible in the petition."
        ),
        min_length=1,
        max_length=8,
    )
    key_details_ta: list[str] = Field(
        description=(
            "Same bullets as `key_details`, in natural TAMIL (தமிழ்). "
            "Keep Tamil proper nouns, place names, scheme names and amounts "
            "verbatim. Same count as `key_details`."
        ),
        min_length=1,
        max_length=8,
    )
