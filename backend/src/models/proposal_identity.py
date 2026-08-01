"""
Pydantic schema for the PROPOSAL IDENTITY agent.

Used ONLY for proposals that arrive as a scanned document (AI upload / QR) — where
there is no intake form to supply the submitter's identity. It runs in parallel
with the proposal CONTENT agent (ProposalExtractionService) and pulls the
organisation + contact straight off the page. Proposals from the /proposal web
form skip this entirely (the form is the authoritative identity).

Strict: every field is '' unless clearly and unambiguously present — never invent.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ProposalIdentity(BaseModel):
    """Submitter identity extracted from a scanned proposal document."""

    org_name: str = Field(
        default="",
        description="The submitting organisation's name from the letterhead / signature. '' if not clear.",
        max_length=300,
    )
    person_name: str = Field(
        default="",
        description="The contact person / signatory who submits on the organisation's behalf. '' if not clear.",
        max_length=200,
    )
    designation: str = Field(
        default="",
        description="That person's role/title (Director, Founder, Programme Lead …). '' if not clear.",
        max_length=200,
    )
    email: str = Field(
        default="",
        description="A contact email clearly printed on the document. '' if none.",
        max_length=254,
    )
    phone: str = Field(
        default="",
        description="A 10-digit Indian contact mobile clearly printed as the submitter's. Digits only. '' if none / unclear.",
        max_length=20,
    )
