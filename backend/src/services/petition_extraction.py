"""
Petition Extraction Service — Gemini (Vertex-first via shared client factory).

Used ONLY by the AI Uploads pipeline. Unlike GrievanceSummarisationService (which
summarises an already-identified citizen's grievance), this reads a *scanned
petition document* and additionally EXTRACTS the petitioner's identity — name
(English + Tamil) and phone number — straight from the page, then produces the
same bilingual summary/category/department/urgency.

Separate prompt, separate schema, separate method — the existing summariser is
left completely untouched. The careful category/department guidance is reused
from summarisation.SYSTEM_PROMPT so classification stays consistent system-wide.

Delegates the Vertex-first + direct-API-fallback plumbing to
gemini_client_factory so every AI service uses the same behavior.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google.genai import types
from pydantic import Field

from src.models.grievance_summary import GrievanceSummary
from src.services.summarisation import SYSTEM_PROMPT as _BASE_PROMPT
from src.services.gemini_client_factory import GeminiClientBundle, build_from_settings

logger = logging.getLogger(__name__)


# ── Output schema: identity + the full grievance summary ────────────────────────
class PetitionExtraction(GrievanceSummary):
    """GrievanceSummary + identity fields extracted from the scanned petition."""

    citizen_name: str = Field(
        default="",
        description=(
            "STRICT: the petitioner's full name, ONLY if you are confident it is "
            "actually the petitioner (found in the signature block, after 'From' / "
            "'பெயர்' / 'இயற்பெயர்', or on the 'To … From' header). Keep it in the "
            "script it is written in. Return an EMPTY STRING '' if: the name is "
            "illegible, you are guessing between candidates, only address fragments "
            "are visible, or the name in view belongs to someone else (the addressee, "
            "a witness, an official mentioned in the body). Do NOT invent, do NOT "
            "guess, do NOT write 'Unknown'."
        ),
        max_length=200,
    )
    citizen_name_ta: str = Field(
        default="",
        description=(
            "The same petitioner's name in TAMIL (தமிழ்). Same rules as citizen_name — "
            "empty string '' if not confident, or if citizen_name is empty. If the "
            "petition name is already Tamil, echo it; if Latin, transliterate the "
            "SCRIPT only (do not translate meaning)."
        ),
        max_length=200,
    )
    mobile: Optional[str] = Field(
        default=None,
        description=(
            "STRICT: the petitioner's own 10-digit Indian mobile number, ONLY if it "
            "is clearly written on the petition AS THEIR CONTACT (e.g. beside the "
            "signature, in a 'Mobile:' / 'கைபேசி:' / 'தொ.பே:' label, or in a "
            "phone-number field). Return NULL if: no number is present, the number "
            "is not clearly labelled as the petitioner's, it is fewer than 10 "
            "digits, it is a landline / office / minister's helpline / TASMAC "
            "helpline / any other party's number, or you are uncertain. Never "
            "invent digits, never guess. Digits only, no spaces or symbols."
        ),
        max_length=20,
    )


# ── Extraction prompt — reuse the base classification guidance, add identity ────
EXTRACTION_PROMPT = (
    _BASE_PROMPT
    + "\n\n"
    + """
ADDITIONAL TASK — STRICT IDENTITY EXTRACTION
============================================

This is a scanned / photographed petition. Before summarising, extract the
petitioner's identity from the page. This is a Minister's office — a wrong
name or a wrong phone number causes real harm (SMS updates go to the wrong
person, records get merged into the wrong citizen). ABSOLUTE STRICTNESS:
when in doubt, RETURN EMPTY. A missing field is safe; a guessed field is
not.

citizen_name  (and citizen_name_ta)
-----------------------------------
Fill ONLY if the petitioner's name is clearly and unambiguously identifiable
from ONE of these positions:

  (a) Signature block at the end ("இப்படிக்கு / தங்கள் / அன்புடன் …" followed
      by a legible name).
  (b) 'From' / 'From:' / 'அனுப்புநர்' / 'மனுதாரர்' / 'பெயர்:' / 'இயற்பெயர்:'
      block at the top.
  (c) A clearly-labelled name field on a printed form (e.g. "Name of Applicant:
      _____").

Return EMPTY STRING '' when ANY of these are true:
  - The name is illegible / partly cut off / handwriting you cannot read
    with high confidence.
  - Multiple candidate names appear and you are not sure which is the
    petitioner (address block, witnesses, officials being complained about,
    the addressee/Minister).
  - Only initials / a signature scribble are present.
  - The petition is on behalf of an association / union / group and no
    individual signatory is unambiguous.

Never write "Unknown", "N/A", "Not found" or a placeholder — the string
must be either a real name or empty. Never invent, never guess between
candidates. Downstream code treats '' as "no name extracted" and the PA
will fill it manually — that is the correct fallback.

mobile
------
Fill ONLY if a 10-digit Indian mobile number is written on the page AND is
clearly labelled or positioned AS the petitioner's own contact number.
Accepted positions:

  - Beside / below the signature.
  - After a label: 'Mobile:', 'Mob:', 'Cell:', 'Phone:', 'கைபேசி:',
    'தொ.பே:', 'செல் எண்:'.
  - In a printed form's "Mobile / Phone" field for the applicant.

Return NULL when ANY of these are true:
  - No number is visible.
  - The number is fewer than 10 digits (do not pad or complete).
  - It is a landline (STD code like 044, 04565, etc.).
  - It is somebody else's number (an office they are complaining about, a
    TASMAC helpline, a school office, a minister's helpline, a witness's
    contact).
  - You cannot read a digit with confidence.
  - The petitioner explicitly gives it as an alternate contact for another
    person.

Digits only, no country code, no spaces, no dashes. Never invent digits.

After identity extraction, produce the full bilingual summary exactly as
specified in the CORE RULES above (name_en / name_ta / citizen_ask /
summary / key_details / category / ministry / urgency). Return ONLY the
JSON object matching the schema — no markdown, no preamble.
""".strip()
)


class PetitionExtractionService:
    """Stateless: call extract() once per uploaded petition file.

    Routes via the shared gemini_client_factory: Vertex AI first (data
    residency, VPC-SC, IAM audit) when VERTEX_AI_ENABLED + VERTEX_PROJECT_ID
    are set, with an automatic fallthrough to the direct api_key-based
    Gemini endpoint on any Vertex failure. A single Vertex outage or
    misconfiguration never stops the petition pipeline.
    """

    def __init__(self, bundle: GeminiClientBundle) -> None:
        self._bundle = bundle

    @classmethod
    def from_settings(cls) -> "PetitionExtractionService":
        return cls(build_from_settings())

    # ── Main entry point ────────────────────────────────────────────────────────
    def extract(self, *, file_bytes: bytes, mime_type: str, filename: Optional[str] = None) -> PetitionExtraction:
        """One Gemini call: read the petition document → identity + summary."""
        t0 = time.monotonic()
        contents: list = [
            "SCANNED PETITION DOCUMENT"
            + (f" (file: {filename})" if filename else "")
            + ". Extract the petitioner's identity, then summarise the grievance.",
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            "\n[Return the JSON object now.]",
        ]
        config = types.GenerateContentConfig(
            system_instruction=EXTRACTION_PROMPT,
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=PetitionExtraction,
            service_tier=self._bundle.service_tier,
        )
        result, backend = self._bundle.call_with_fallback(
            contents=contents, config=config,
            response_type=PetitionExtraction,
            service_name="petition_extraction",
        )
        logger.info(
            "Petition extraction done in %dms | backend=%s | "
            "name=%s | category=%s | urgency=%s",
            int((time.monotonic() - t0) * 1000), backend,
            result.citizen_name, result.category.value, result.urgency.value,
        )
        return result
