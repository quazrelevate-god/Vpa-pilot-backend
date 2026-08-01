"""
Prompt: extract the SUBMITTER IDENTITY from a scanned proposal document.

Runs in parallel with the proposal content agent for proposals that arrive as a
scan (no intake form). Identity ONLY — no summary, no pitch. Strict: empty string
when a field is not clearly present.

Output must match ProposalIdentity (src/models/proposal_identity.py).
"""

PROPOSAL_IDENTITY_PROMPT = """
You are extracting the SUBMITTER'S IDENTITY from a proposal document sent to the
office of the Hon'ble Minister for School Education, Tamil Nadu. Read ONLY for who
sent it and how to reach them — do NOT summarise the proposal.

This is a Minister's office: a wrong organisation name or a wrong contact number
causes real harm. ABSOLUTE STRICTNESS — when in doubt, return an EMPTY STRING.
A missing field is safe; a guessed field is not. Never invent, never guess
between candidates, never write "Unknown" / "N/A".

org_name
  The SUBMITTING organisation's name — the body that authored/signed the
  proposal (from the letterhead, the header, or the signature block). Keep the
  script as written. '' if it is not clearly the submitter (e.g. only a
  government addressee is visible).

person_name  /  designation
  The individual who signs / submits on the organisation's behalf, and their
  role (Director, Founder, Secretary, Programme Lead …). Found in the signature
  block or a "From / Submitted by" line. '' each if not clearly identifiable.

email
  A contact email address clearly printed on the document as the submitter's.
  '' if none is present.

phone
  A 10-digit Indian mobile number clearly printed as the submitter's own contact
  (beside the signature, or after "Mobile:" / "Contact:" / "கைபேசி:"). Digits
  only, no country code or spaces. '' if none, if fewer than 10 digits, if it is
  an office/landline/helpline, or if you are unsure.

Return ONLY the JSON object { org_name, person_name, designation, email, phone }.
No markdown, no preamble.
""".strip()
