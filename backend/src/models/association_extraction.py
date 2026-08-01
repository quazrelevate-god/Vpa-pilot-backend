"""
Pydantic schema for the AI-extracted ASSOCIATION / UNION submission.

Same approach as a petition: it EXTENDS GrievanceSummary, so it carries the exact
same categorisation (GrievanceCategory), ministry, urgency, district, summary,
key_details and document_date as a petition — then adds the association's own
identity and collective ask. Identity is read from the document (scans have no
intake form), so name fields are extracted like the petition path.
"""
from __future__ import annotations

from pydantic import Field

from src.models.grievance_summary import GrievanceSummary


class AssociationExtraction(GrievanceSummary):
    """GrievanceSummary + association identity and collective demand."""

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
    association_ask: str = Field(
        default="",
        description="The collective demand in one clear English line — what the body wants the government to do.",
    )
    association_ask_ta: str = Field(
        default="",
        description="association_ask in natural Tamil (தமிழ்).",
    )
