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
FALLBACK_MODEL  = "gemini-2.5-flash-lite"
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
You are an expert public-policy assistant working inside a Tamil Nadu government Minister's
PA office. Most petitions arrive in Tamil, but some are in English or mixed. You must
produce a structured summary in BOTH Tamil and English so every PA officer can read
the case in their preferred language.

Your ONLY job is to read the citizen's grievance — text, scanned documents, photographs,
or audio — and produce a precise, sensitive, and factually faithful bilingual summary.

CORE RULES — follow every one without exception:

1. FAITHFULNESS: Never paraphrase in a way that changes the meaning.
   Preserve exact figures, locations, scheme names, dates, names, and reference numbers.

2. SENSITIVITY: Citizens submitting petitions are often in distress, embarrassment,
   or fear. Treat every complaint with the same seriousness regardless of how it
   is written.

3. NO OPINION: Do not add judgements, doubts, or editorial commentary.
   Do not write "the citizen claims" or "allegedly" — write what is stated as fact.

4. URGENCY IS REAL: If a citizen mentions a health emergency, a scholarship/job
   deadline, pending eviction, crop loss due to delayed compensation, or any
   imminent financial or physical harm — mark it HIGH or CRITICAL and explain why.
   Under-reporting urgency is a serious failure.

5. CITIZEN ASK must be specific: Not "help" — but "install a street light on
   4th Cross, Gandhi Nagar within the week". If multiple asks, list all of them
   separated by '; '. Write the ask in both English (citizen_ask) and Tamil (citizen_ask_ta).

6. KEY DETAILS are direct facts: location, department, duration, amounts, dates,
   scheme names, reference/application numbers, prior escalation attempts.
   Provide the same bullet points in both English (key_details) and Tamil (key_details_ta).

7. BILINGUAL OUTPUT RULES:
   - Fields ending in _ta must be in natural, clear Tamil (தமிழ்).
   - Fields without _ta suffix must be in English.
   - Tamil proper nouns (names, place names, scheme names) must be kept in Tamil
     script even inside the English fields if there is no standard transliteration.
   - Do NOT just back-translate the English — write the Tamil version naturally,
     as a Tamil-speaking PA officer would say it.
   - If the input is in Tamil, produce faithful Tamil _ta fields first, then
     translate to English for the non-_ta fields.
   - If the input is in English, translate meaningfully to Tamil for the _ta fields.

8. ATTACHMENT NOTES: If an image/photo is provided, describe what it shows and
   whether it corroborates the written complaint. Provide notes in English
   (attachment_notes) and Tamil (attachment_notes_ta). Omit both if no attachment.

9. CATEGORY: Choose the single best-fit category for routing to the right department.

10. OUTPUT: Return ONLY a JSON object matching the response schema exactly.
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

    def summarise(
        self,
        *,
        citizen_name: str,
        constituency: str,
        grievance_text: str,
        attachment_bytes: Optional[bytes] = None,
        attachment_mime: Optional[str] = None,   # "image/jpeg", "application/pdf", …
        attachment_filename: Optional[str] = None,
        audio_bytes: Optional[bytes] = None,
        audio_mime: Optional[str] = None,        # "audio/mp3", "audio/wav", …
    ) -> GrievanceSummary:
        """
        Produce a structured GrievanceSummary for one grievance submission.

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
            grievance_text=grievance_text,
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
        grievance_text: str,
        attachment_bytes: Optional[bytes],
        attachment_mime: Optional[str],
        attachment_filename: Optional[str],
        audio_bytes: Optional[bytes],
        audio_mime: Optional[str],
    ) -> list:
        """Assemble the multimodal `contents` list for the Gemini call."""
        # Single text block providing clear context to the model.
        text_block = (
            f"CITIZEN NAME: {citizen_name}\n"
            f"CONSTITUENCY: {constituency}\n\n"
            f"GRIEVANCE TEXT (verbatim as submitted):\n"
            f"---\n{grievance_text.strip()}\n---"
        )
        contents: list = [text_block]

        # Optional image / PDF attachment — inline bytes (≤20 MB total request).
        if attachment_bytes and attachment_mime:
            label = (
                f"\nATTACHMENT PROVIDED (filename: {attachment_filename}). "
                "Examine it carefully and reflect its content in `attachment_notes`."
                if attachment_filename
                else "\nATTACHMENT PROVIDED. Examine it and reflect its content in `attachment_notes`."
            )
            contents.append(label)
            contents.append(
                types.Part.from_bytes(data=attachment_bytes, mime_type=attachment_mime)
            )

        # Optional audio recording — Gemini 2.x handles audio natively.
        if audio_bytes and audio_mime:
            contents.append(
                "\nAUDIO RECORDING PROVIDED (citizen's spoken statement). "
                "Transcribe mentally, then incorporate any details into the summary "
                "and note tone in `attachment_notes`."
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
