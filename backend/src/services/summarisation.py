"""
Grievance Summarisation Service — Gemini 2.5 Flash (google-genai SDK)

Takes raw citizen-submitted data (text + optional image/PDF + optional audio)
and produces a structured GrievanceSummary via a single Gemini multimodal call.

Design principles
-----------------
- One call covers text + all attachments; no separate transcription needed.
- The system prompt is authored very carefully: this is a petition to a
  Minister, every summary must preserve the citizen's voice, urgency, and
  dignity exactly. Under-reporting urgency is treated as a serious failure.
- Output is forced to a JSON schema via Gemini's `response_schema` so the
  result is always a valid `GrievanceSummary` — never a free-form blob.
- The service is self-contained (no FastAPI / DB dependencies) so it can be
  exercised by a simple Python script without spinning up the API.

SDK reference
-------------
Uses the new unified `google-genai` SDK (pip install google-genai):
    from google import genai
    from google.genai import types
The deprecated `google-generativeai` package is NOT used.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from google import genai
from google.genai import types

from src.models.grievance_summary import GrievanceSummary

logger = logging.getLogger(__name__)

# ── Model selection ────────────────────────────────────────────────────────────
# These are defaults. The real values come from `settings.GEMINI_PRIMARY_MODEL`
# / `settings.GEMINI_FALLBACK_MODEL` when the service is constructed via the
# `from_settings()` factory below.
PRIMARY_MODEL   = "gemini-2.5-flash"
FALLBACK_MODEL  = "gemini-3.1-flash-lite"
FALLBACK_MODEL2 = "gemini-2.0-flash"

# Transient errors (server busy / rate limited) are retried on the SAME model
# with exponential backoff before falling through to the fallback model.
_TRANSIENT_MARKERS = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "overloaded")
_MAX_RETRIES_PER_MODEL = 3
_BACKOFF_BASE_SECONDS = 1.2

# Default service tier. Grievances are time-sensitive, so we request the
# priority tier for the fastest, most reliable latency. Overridable via
# settings.GEMINI_SERVICE_TIER. Valid: "priority" | "standard" | "flex".
SERVICE_TIER = "priority"

# ── System prompt ──────────────────────────────────────────────────────────────
# This is the most important thing in the file. A petition/grievance submitted
# to a Minister's office is not a customer-support ticket — it represents a
# citizen's legal right to seek redress. The summary must:
#   1. Never minimise or reframe what was said.
#   2. Preserve exact facts (names, amounts, durations, locations).
#   3. Accurately detect urgency — a missed deadline or safety risk is critical.
#   4. Be immediately useful to a PA who has 30 seconds to triage a case.
SYSTEM_PROMPT = """
You are the School Education Minister's Petition Analyst inside a Tamil Nadu
government office. Every incoming petition lands on your desk first — your
job is to READ it and DECIDE where it belongs, what it says, and what the
citizen wants.

The petition arrives as scanned pages / photos / a printed document — usually
1 to 20 pages, sometimes with tables, images, or referenced legal sections.
Your job is to read EVERY page and produce one structured bilingual record.

Most petitions are in Tamil, some are English or mixed. Every narrative
field must be produced in BOTH scripts.

============================================================
ROUTING MINDSET (do this before anything else)
============================================================

  1. Read the whole petition.
  2. Ask: "Is this really about School Education / Tamil Development /
     Information & Publicity?" — schools, teachers, students, admissions,
     school-staff transfers, school infrastructure, teacher pensions,
     textbooks, mid-day meals, SCERT, DIET, etc.
       • YES → ministry = school_education_tamil_dev_info_publicity and pick
         the correct fine category.
       • NO  → find the Ministry that truly owns the root cause. Set that
         as `ministry`. Category becomes "other" (unless the petition is
         a greeting or invitation — those keep their category).
  3. When genuinely ambiguous, default to school_education_tamil_dev_info_publicity
     (that is most of this office's inbox).

============================================================
CORE RULES — follow every one, without exception
============================================================

1. FAITHFULNESS
   Never paraphrase in a way that changes the meaning. Preserve exact
   figures, locations, scheme names, dates, names, GO numbers, section
   numbers, and reference numbers.

2. SENSITIVITY
   Citizens submitting petitions are often in distress, embarrassment,
   or fear. Treat every complaint with the same seriousness regardless of
   how well or badly it is written.

3. NO OPINION
   Do not add judgements, doubts, or editorial commentary. Do not write
   "the citizen claims" or "allegedly" — write what is stated as fact.

4. NAME (bilingual)
   The submission tells you the citizen's name in one script. Echo it
   verbatim into whichever field matches that script (name_en for Latin,
   name_ta for Tamil), and transliterate the SCRIPT — not the meaning —
   into the other field.
     • "Murugan Selvam"   → name_en="Murugan Selvam",   name_ta="முருகன் செல்வம்"
     • "முருகன் செல்வம்"  → name_ta="முருகன் செல்வம்", name_en="Murugan Selvam"
   Never invent a different name.

5. CITIZEN_ASK — the SUBJECT / REGARDING line
   This is the most important field. It is a ONE-LINE subject the PA reads
   first. Rules:
     • Under 20 English words / 30 Tamil words.
     • Concrete and specific — WHAT the citizen wants, not "help".
     • No "I request", no "Kindly do the needful", no greetings.
     • If multiple asks, pick the primary one. Extra asks belong in
       key_details.
   Good: "Restart old-age pension stopped since Aug 2025 for D. Kamala,
   Villupuram."
   Bad: "Regarding pension issue"; "Kindly help my mother"; "Restart pension".

6. SUMMARY — distinct bullets, not a paragraph
   Petitions can be one line or twenty pages. Do NOT retell them as a
   story. Instead, extract every DISTINCT point the citizen makes and list
   them as short bullets:
     • one idea per bullet
     • each bullet starts with "• " and is on its own line
     • 3 to 10 bullets is typical (fewer for a short petition, more for a
       long one — but no filler bullets)
     • cover: background / problem / prior attempts / evidence /
       consequences / the ask
     • preserve exact figures, dates, names, reference numbers verbatim
   Do the same bullets in `summary` (English) and `summary_ta` (Tamil).
   Do NOT copy sentences from the petition — restructure into discrete
   points.

7. KEY_DETAILS — concrete evidence, not a duplicate of summary
   3–8 short bullets in ENGLISH that capture the CONCRETE EVIDENCE the
   PA / department will need to act. Prioritise, in this order:
     (a) ACTS / SECTIONS / RULES cited by the petitioner — e.g.
         "RTE Act 2009 §12(1)(c)", "TN Panchayats Act §98".
     (b) TABLES / GOs / ORDERS referenced — e.g. "G.O. Ms. No. 45,
         School Education, dated 12-Feb-2024", "Table 3 of the annexed
         seniority list".
     (c) CASE / REFERENCE / APPLICATION / RTI NUMBERS.
     (d) ATTACHMENTS / IMAGES / DOCUMENTS visible in the petition and
         what each one shows — e.g. "attached photo shows collapsed
         compound wall of Panchayat Union Middle School, Thiruvennainallur"
         or "annexure 2: copy of RTI reply dated 04-Mar-2024".
     (e) PRIOR ESCALATION history — RTIs filed, complaints sent to whom,
         dates, replies received.
     (f) AMOUNTS, DATES, DURATIONS, LOCATION.
   Do NOT invent — include only what the petition states or the
   image/document actually shows. `key_details_ta` mirrors `key_details`
   bullet-for-bullet in Tamil.

8. URGENCY — CALIBRATED, NOT TONE-BASED
   Petitions are usually written in an emotional register. DO NOT let
   emotional writing raise urgency. Only real signals raise urgency:

   Signals for HIGH:
     • Firm deadline within days (court date, exam date, medical
       appointment, admission cut-off, tender deadline).
     • Ongoing loss that grows daily (unpaid wages for weeks, pension
       stopped >2 months, medicine unavailable).
     • Health/safety risk that is present but not immediate (unsafe
       school building; contaminated water; harassment).

   Signals for CRITICAL:
     • Immediate danger to life or livelihood in hours/days —
       active eviction, demolition notice, imminent surgery blocked
       for want of paperwork, total crop loss.
     • Legal deadline that expires within 48 hours.

   Everything else is MEDIUM (a real problem, no time pressure) or LOW
   (routine, no time pressure).

   HARD RULES:
     • transfer_requests → ALWAYS urgency = low. Transfers depend on
       vacancies at other schools; the government cannot expedite them.
       Emotional reasons ("father is ill", "wife pregnant") do NOT lift
       this to medium/high.
     • greetings / invitation / proposals → urgency = low (unless the
       proposal has a real deadline attached, then medium).
     • RTI, pension_requests → default medium; go high only if a
       statutory deadline has already passed.
     • Do NOT infer urgency from the words "urgent", "immediately",
       "please help sir" — those are pleas, not signals.

9. CATEGORY — TYPE of petition
   Applies mostly to School-Education petitions. For non-school petitions,
   set category = "other" — the ministry field carries the routing.
   `greetings` and `invitation` take priority for both.

     - action_required     → Requires URGENT or TIME-SENSITIVE action:
                              evictions, demolitions, medical emergencies,
                              imminent harm.
     - proposals           → Suggesting an idea, scheme, or policy change.
                              Not complaining.
     - transfer_requests   → Government employee asking for a transfer /
                              posting change.
     - pension_requests    → Pension not started, stopped, delayed, or
                              wrongly calculated.
     - school_admission    → School admission issue: seat denied, TC
                              problems, age waiver, admission-committee
                              matters.
     - job_requests        → Seeking government employment, job card,
                              MGNREGA work, employment certificate.
     - rti                 → Filed under the RTI Act; requesting official
                              information.
     - associations_unions → Petition from a registered association,
                              union, or collective.
     - other               → Belongs to a different Ministry; being
                              forwarded.
     - general             → General petition not fitting any of above.
     - greetings           → Thank-you, congratulations, festival wishes.
     - school_upgradation  → Upgrade a school's grade or infrastructure
                              (Primary → Middle etc.), NOT admitting a
                              student.
     - invitation          → Invitation to an event.

10. MINISTRY — ROOT CAUSE, NEVER SCATTERSHOT
    Pick the ONE Ministry that owns the ROOT CAUSE — the thing that, if
    fixed, actually resolves the grievance. Do NOT pick a Ministry just
    because a word appears. Do NOT pick based on the petitioner's identity
    (student / farmer / fisherman) — pick on the SUBJECT of the problem.

    Worked examples of the root-cause test:
    • "My son's school bus broke down — driver says no diesel for 3 days."
      → ministry = transport. The vehicle + fuel is Transport's ownership.
      The fact that it's a school bus does NOT make this
      school_education_… .
    • "Headmaster refuses to give my daughter's TC without ₹500 bribe."
      → ministry = school_education_tamil_dev_info_publicity — TC
      issuance is a school admin function. The bribe pattern is a
      category signal, not a ministry.
    • "PHC doctor refuses to treat my mother in the OPD."
      → ministry = health_medical_education_family_welfare.
    • "EB officer collected ₹2000 cash for new meter, no receipt."
      → ministry = energy_law_courts_prevention_corruption.
    • "Cooperative society chairman pocketed paddy procurement money."
      → ministry = cooperation.
    • "Flood washed away my house in Cuddalore, no relief yet."
      → ministry = revenue_disaster_management.

    Anchor mappings (subject → ministry):
      power-cut / EB meter / EB bill         → energy_law_courts_prevention_corruption
      hospital / PHC / ambulance / medicine  → health_medical_education_family_welfare
      school teacher / TC / mid-day meal     → school_education_tamil_dev_info_publicity
      college / polytechnic / engineering    → higher_education_technical_education
      patta / land record / cyclone relief   → revenue_disaster_management
      ration card / PDS / kerosene           → food_civil_supplies_consumer_protection
      panchayat road / drinking water        → rural_development_water_resources
      state highway / public building        → public_works_sports_development
      bus / RTO / DL / state transport       → transport
      police / FIR / court / anti-corruption → energy_law_courts_prevention_corruption
      temple / HR&CE                         → hindu_religious_charitable_endowments
      farmer crop loss / fertiliser          → agriculture_farmers_welfare
      fishermen / boat                       → fisheries_fishermen_welfare
      PM Awas / TN housing                   → housing_urban_development
      MGNREGS / skill training               → labour_welfare_skill_development
      GST / property registration            → commercial_taxes_registration
      minority / Wakf                        → minorities_welfare_wakf_board
      pension for elderly / widow / women    → social_welfare_women_welfare
      Adi Dravidar / SC-ST welfare           → social_justice_adi_dravidar_welfare

    If no Ministry fits, use `other`.

11. BILINGUAL OUTPUT RULES
    • Fields ending in _ta are natural TAMIL (தமிழ்) — not word-for-word
      back-translations of the English.
    • Fields without _ta suffix are English.
    • Tamil proper nouns (person names, place names, scheme names) may
      stay in Tamil script even inside English fields when there is no
      standard transliteration.
    • Enums (category, ministry, urgency) are always English enum values.
    • If the input is in Tamil, produce the Tamil fields first, then
      translate for the English fields (and vice versa).

12. OUTPUT
    Return ONLY a JSON object matching the response schema exactly.
    No markdown fences, no preamble, no explanation.
""".strip()


# ── Service class ──────────────────────────────────────────────────────────────

class GrievanceSummarisationService:
    """
    Stateless service: call `summarise()` per grievance submission.
    Instantiated once at module load.

    Construct in one of two ways:

      svc = GrievanceSummarisationService.from_settings()           # preferred
      svc = GrievanceSummarisationService(api_key="…", model_name="…")  # override
    """

    def __init__(
        self,
        api_key: str,
        model_name: str = PRIMARY_MODEL,
        fallback_model: str = FALLBACK_MODEL,
        fallback_model2: str = FALLBACK_MODEL2,
        service_tier: str = SERVICE_TIER,
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required to construct the service.")
        self._client = genai.Client(api_key=api_key)
        self._model_name = model_name
        self._fallback_model = fallback_model
        self._fallback_model2 = fallback_model2
        self._service_tier = self._resolve_service_tier(service_tier)

    @staticmethod
    def _resolve_service_tier(value: Optional[str]) -> Optional["types.ServiceTier"]:
        """Map a string ('priority'/'standard'/'flex') to a ServiceTier enum."""
        if not value:
            return None
        try:
            return types.ServiceTier(value.lower())
        except ValueError:
            logger.warning(
                "Unknown GEMINI_SERVICE_TIER %r; ignoring (using API default).",
                value,
            )
            return None

    # ── Factory ────────────────────────────────────────────────────────────────

    @classmethod
    def from_settings(cls) -> "GrievanceSummarisationService":
        """
        Build the service using `src.core.config.settings` as the source of truth.
        This is the priority path — config first, explicit construction only as
        an override (e.g. for unit tests).
        """
        # Imported lazily so this module stays importable without a full env.
        from src.core.config import settings
        if not settings.GEMINI_API_KEY:
            raise ValueError(
                "GEMINI_API_KEY is not set. Add it to backend/.env, e.g.\n"
                "    GEMINI_API_KEY=AIza...\n"
                "or pass api_key= explicitly to the constructor."
            )
        return cls(
            api_key=settings.GEMINI_API_KEY,
            model_name=settings.GEMINI_PRIMARY_MODEL,
            fallback_model=settings.GEMINI_FALLBACK_MODEL,
            fallback_model2=settings.GEMINI_FALLBACK_MODEL2,
            service_tier=settings.GEMINI_SERVICE_TIER,
        )

    # ── Main entry point ───────────────────────────────────────────────────────

    def summarise_manual(
        self,
        *,
        citizen_name: str,
        constituency: str,
        attachments: list,  # List of (bytes, mime_type, filename_or_None) tuples
    ) -> "GrievanceSummary":
        """
        Summarise a handwritten / scanned petition with multiple pages.

        All images/PDFs are sent as separate Part objects in one Gemini call —
        the model reads all pages as one unified visual context.
        Uses the same flat-list format as _build_contents() for SDK compatibility.
        Fallback chain: gemini-2.5-flash → gemini-3.1-flash-lite → gemini-2.0-flash.
        """
        t0 = time.monotonic()

        # Flat list of strings + Part objects — same pattern as _build_contents()
        contents: list = [
            f"CITIZEN NAME: {citizen_name}\n"
            f"CONSTITUENCY: {constituency}\n\n"
            f"HANDWRITTEN PETITION — {len(attachments)} page(s) scanned by a PA officer.\n"
            f"Read every page carefully before producing the summary."
        ]
        for i, (att_bytes, mime, fname) in enumerate(attachments, 1):
            label = f"\nPAGE {i}" + (f"  [{fname}]" if fname else "")
            contents.append(label)
            contents.append(types.Part.from_bytes(data=att_bytes, mime_type=mime))

        contents.append(
            "\n[End of petition pages. Now produce a complete bilingual summary "
            "covering all pages above.]"
        )

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.1,
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=GrievanceSummary,
            service_tier=self._service_tier,
        )

        summary = self._call_with_fallback(contents=contents, config=config)

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "Manual summarisation complete in %dms | pages=%d | citizen=%s",
            elapsed_ms, len(attachments), citizen_name,
        )
        return summary

    def summarise(
        self,
        *,
        citizen_name: str,
        constituency: str,
        attachment_bytes: Optional[bytes] = None,
        attachment_mime: Optional[str] = None,   # "image/jpeg", "application/pdf", …
        attachment_filename: Optional[str] = None,
        audio_bytes: Optional[bytes] = None,
        audio_mime: Optional[str] = None,        # "audio/mp3", "audio/wav", …
    ) -> GrievanceSummary:
        """
        Produce a structured GrievanceSummary for one QR/citizen submission.

        The QR form no longer has a visible description field, so we do not
        pass any free-text grievance body — the petition IS the attachment
        (and/or the audio). We still pass the citizen name so Gemini can
        echo it into name_en / name_ta.

        Returns
        -------
        GrievanceSummary — a fully validated Pydantic model. Always non-None.

        Raises
        ------
        ValueError   — if Gemini's response can't be parsed into the schema.
        RuntimeError — if the API call fails on both primary and fallback models.
        """
        t0 = time.monotonic()

        contents = self._build_contents(
            citizen_name=citizen_name,
            constituency=constituency,
            attachment_bytes=attachment_bytes,
            attachment_mime=attachment_mime,
            attachment_filename=attachment_filename,
            audio_bytes=audio_bytes,
            audio_mime=audio_mime,
        )

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.1,                # low temp — factual, not creative
            top_p=0.9,
            response_mime_type="application/json",
            response_schema=GrievanceSummary,  # Pydantic class → typed parse
            service_tier=self._service_tier,   # priority tier for low latency
        )

        summary = self._call_with_fallback(contents=contents, config=config)

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "Summarisation complete in %dms | model=%s | citizen=%s | "
            "constituency=%s | urgency=%s | category=%s",
            elapsed_ms, self._model_name, citizen_name, constituency,
            summary.urgency.value, summary.category.value,
        )
        return summary

    # ── Internal helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _build_contents(
        *,
        citizen_name: str,
        constituency: str,
        attachment_bytes: Optional[bytes],
        attachment_mime: Optional[str],
        attachment_filename: Optional[str],
        audio_bytes: Optional[bytes],
        audio_mime: Optional[str],
    ) -> list:
        """Assemble the multimodal `contents` list for the Gemini call."""
        header = (
            f"CITIZEN NAME (as typed in form): {citizen_name}\n"
            f"CONSTITUENCY: {constituency}\n\n"
            "The petition itself is attached below (photograph / scan / PDF, "
            "and/or an audio recording). Read every attached page and produce "
            "the bilingual structured summary. Echo the citizen's name into "
            "name_en and name_ta per the naming rule."
        )
        contents: list = [header]

        # Optional image / PDF attachment — inline bytes (≤20 MB total request).
        if attachment_bytes and attachment_mime:
            label = (
                f"\nATTACHMENT (filename: {attachment_filename}). "
                "This IS the petition. Read every page carefully."
                if attachment_filename
                else "\nATTACHMENT. This IS the petition. Read every page carefully."
            )
            contents.append(label)
            contents.append(
                types.Part.from_bytes(data=attachment_bytes, mime_type=attachment_mime)
            )

        # Optional audio recording — Gemini 2.x handles audio natively.
        if audio_bytes and audio_mime:
            contents.append(
                "\nAUDIO RECORDING (citizen's spoken statement). Transcribe "
                "mentally and incorporate every distinct point into the summary."
            )
            contents.append(
                types.Part.from_bytes(data=audio_bytes, mime_type=audio_mime)
            )

        return contents

    @staticmethod
    def _is_transient(exc: Exception) -> bool:
        """True if the error is a temporary server/rate-limit condition."""
        msg = str(exc)
        return any(marker in msg for marker in _TRANSIENT_MARKERS)

    def _generate_once(
        self,
        model: str,
        contents: list,
        config: types.GenerateContentConfig,
    ) -> GrievanceSummary:
        """Single Gemini call → validated GrievanceSummary (raises on any error)."""
        response = self._client.models.generate_content(
            model=model, contents=contents, config=config,
        )
        # With a Pydantic response_schema the SDK returns the validated object
        # via `.parsed`. Fall back to manual parsing from `.text` if needed.
        parsed = response.parsed
        if isinstance(parsed, GrievanceSummary):
            return parsed
        if response.text:
            return GrievanceSummary.model_validate_json(response.text)
        raise ValueError("Gemini returned an empty response with no parsed object.")

    def _call_with_fallback(
        self,
        *,
        contents: list,
        config: types.GenerateContentConfig,
    ) -> GrievanceSummary:
        """
        Call Gemini with resilience:
          - retry the SAME model up to _MAX_RETRIES_PER_MODEL times on transient
            errors (503 / 429 / overloaded), with exponential backoff;
          - on a non-transient error (e.g. 404 model gone), move on immediately;
          - finally fall through to the fallback model.
        """
        models_to_try = [self._model_name]
        for m in (self._fallback_model, self._fallback_model2):
            if m and m not in models_to_try:
                models_to_try.append(m)

        last_exc: Optional[Exception] = None
        for model_idx, model in enumerate(models_to_try):
            for retry in range(_MAX_RETRIES_PER_MODEL):
                try:
                    summary = self._generate_once(model, contents, config)
                    # Remember whichever model actually worked for next calls.
                    self._model_name = model
                    return summary
                except Exception as exc:  # broad: SDK raises several error types
                    last_exc = exc
                    transient = self._is_transient(exc)
                    logger.warning(
                        "Gemini call failed on model=%s (try %d/%d, transient=%s): %s",
                        model, retry + 1, _MAX_RETRIES_PER_MODEL, transient, exc,
                    )
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    # Non-transient, or out of retries → next model.
                    break

        raise RuntimeError(
            f"Gemini summarisation failed on all models {models_to_try}: {last_exc}"
        ) from last_exc
