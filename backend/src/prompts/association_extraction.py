"""
Prompt: extract an ASSOCIATION / UNION submission.

Same approach as a petition — it reuses the shared grievance guidance so an
association's collective matter is categorised with the SAME GrievanceCategory
taxonomy (action_required, job_requests, school_admission, …), including the
document_date — then adds the association-specific identity + collective ask on
top. Identity is read from the document (there is no intake form for scans).

Output must match AssociationExtraction (src/models/association_extraction.py).
"""
# Reuse the live petition/grievance guidance verbatim so categorisation stays
# identical system-wide; the petition prompt itself is not modified.
from src.services.summarisation import SYSTEM_PROMPT as _BASE_GRIEVANCE_PROMPT

ASSOCIATION_EXTRACTION_PROMPT = (
    _BASE_GRIEVANCE_PROMPT
    + "\n\n"
    + """
ADDITIONAL TASK — ASSOCIATION / UNION EXTRACTION
================================================
This document is from a UNION, ASSOCIATION, federation, sangam or organised body
raising a COLLECTIVE matter for its members — not an individual grievance. First
produce the FULL grievance summary above (category, ministry, urgency, district,
summary, key_details, document_date) EXACTLY as specified — the association's
collective demand IS the matter to summarise and categorise.

CATEGORY — IMPORTANT: this document is ALREADY known to be from an association,
so do NOT use the 'associations_unions' category (that is redundant here), and
never use 'proposals', 'greetings' or 'invitation'. Choose the SPECIFIC
underlying grievance category that fits the collective demand — one of:
action_required, job_requests, school_admission, pension_requests,
transfer_requests, rti, school_upgradation, general, other. For example a
regularisation / appointment / pay-scale demand is usually job_requests (or
action_required when there is a firm deadline).

Then ALSO extract:

association_name
  The stated name of the body (e.g. "Tamil Nadu Graduate Teachers Association",
  "...Sangam", "...Federation", "...Union"). Keep the script as written. Empty
  string '' if not clearly stated — never invent.

member_count
  The membership size IF STATED (e.g. "12,000 members", "all 38 district units"),
  verbatim, else "Not specified". Never guess a number.

representative_name  /  representative_designation
  The office-bearer who signs / submits on behalf of the body — their name and
  role (President, General Secretary, State Coordinator …). Empty string '' if
  not clearly identifiable. Same strictness as petition identity: never guess
  between candidates.

association_ask  (and association_ask_ta)
  The COLLECTIVE demand in ONE clear line — what the association wants the
  government to do (e.g. "Regularise 3,200 guest lecturers and fix a pay scale").
  Specific, grounded in the document.

Never invent an association name, membership figure or office-bearer. When a
field is not clearly present use the empty string / "Not specified" — the
reviewer will complete it. Return ONLY the JSON object matching the schema.
""".strip()
)
