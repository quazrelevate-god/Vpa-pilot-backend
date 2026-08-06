"""
Prompt: extract an ASSOCIATION / UNION submission.

Same approach as a petition — it reuses the shared grievance guidance so an
association's collective matter is categorised with the SAME GrievanceCategory
taxonomy (action_required, job_requests, school_admission, …), including the
document_date — then adds the association-specific identity + collective ask
+ Minister-facing decision context on top.

Output must match AssociationExtraction (src/models/association_extraction.py).

Every "empty if silent, never invent" rule is repeated PER FIELD below on
purpose — Gemini treats each field prompt independently, and a single global
"don't invent" clause loses signal against 12 concrete field descriptions.
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

DECISION CONTEXT — for the Minister / super-admin reviewer
----------------------------------------------------------
These fields tell the reviewer WHY this ask deserves the level of attention
they should give it. Every field below MUST be grounded in the document. If the
document is silent on a field, return the empty string / empty list — a real
"nothing said" is far more useful than an invented summary.

demand_context  (and demand_context_ta)
  One tight sentence naming the TRIGGER for this ask NOW — a GO deadline, an
  upcoming exam / recruitment window, a policy change, a season (harvest,
  academic year), a court date. Grounded in what the document says triggered
  the letter. Empty string if the document does not name a trigger.

expected_outcome  (and expected_outcome_ta)
  One tight sentence naming the concrete outcome the body wants ("Regularise
  3,200 guest lecturers", "Release 8 months of pending honorarium", "Withdraw
  Circular 42/2025"). NOT a restatement of association_ask — the ask is the
  WHAT; the expected_outcome is the specific concrete state after the
  government acts. Empty string if the document does not specify a target end-state.

key_stakeholders  (and key_stakeholders_ta) — max 4 items, 2–5 words each
  Notable PEOPLE, AFFILIATIONS, backers or partner bodies the DOCUMENT itself
  names — e.g. "MLA Ram Kumar (Salem)", "Backed by TN Federation of Teachers".
  Do NOT list generic 'members', 'employees', 'students'. Do NOT invent names.
  Empty list if the document names no stakeholders beyond the signing office-bearer.

risks_if_ignored  (and risks_if_ignored_ta) — max 4 items, short phrases
  What the document STATES will happen if the government does not act — protest
  rally, hunger strike, legal notice, media escalation, factional shift, exam
  boycott. Extract ONLY explicit warnings from the letter or concrete red flags
  in its tone. Never generic "may cause unrest" language. Empty list if the
  document contains no such warnings.

precedent_context  (and precedent_context_ta)
  One tight sentence on prior dealings the document mentions — earlier meetings
  with the Minister, prior promises, a specific GO already issued, cases
  already filed, an earlier delegation. Do NOT search the web or infer history.
  Empty string if the document says nothing about history.

ai_recommendation  (and ai_rationale + ai_rationale_ta) — triage hint, NOT a decision
  Pick ONE of:
    engage_now       — high-leverage / time-critical / large body — the Minister
                       should meet or respond soon. Signals: named deadline,
                       stated escalation risk, prior GO on the same topic,
                       large / multi-district body, election window relevance.
    routine          — standard collective ask; reviewer can process at normal
                       pace. No deadline, no escalation, moderate body.
    refer            — the ask is clearly operational — a specific missing
                       payment, a transfer request, a routine RTI follow-up —
                       best handled at the concerned department level.
    needs_more_info  — the body's identity, membership, or the ask itself is
                       unclear, or a key fact (name, number, deadline) is
                       missing. Ask for clarification before deciding.

  ai_rationale (and ai_rationale_ta) is ONE short sentence pointing at the
  specific signal that led you to that recommendation — the deadline named,
  the member count, the prior GO, the stated escalation. Not vague.

  Default is 'routine' — pick 'engage_now', 'refer' or 'needs_more_info' only
  when a concrete signal in the document warrants it.

Never invent an association name, membership figure, office-bearer, stakeholder
or history. When a field is not clearly present use the empty string / empty
list / "Not specified" — the reviewer will complete it. Return ONLY the JSON
object matching the schema.
""".strip()
)
