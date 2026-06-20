"""
Speech-to-Text Services — Sarvam AI + Gemini, side-by-side.
═══════════════════════════════════════════════════════════

Two providers wrapped behind a common `STTResult` shape so the Streamlit
tester can run both in parallel and let the operator compare quality, speed,
and Tamil-handling on the same audio clip.

Why two providers?
------------------
- **Sarvam Saaras v3** is purpose-built for Indian languages (Tamil first),
  supports code-mixed speech, native diarization, and ₹30/hour pricing.
- **Gemini 2.5 Flash** is the model we already use for grievance
  summarisation; reusing it for STT keeps the stack thin if quality is good
  enough.

This module is import-safe with no DB or FastAPI dependencies, so it can be
exercised directly from a Streamlit script or a one-off Python REPL.
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
import time
import wave
from dataclasses import dataclass, field
from typing import Optional

import requests
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Sarvam's REST endpoint accepts clips up to 30 seconds.  Anything longer must
# use the Batch API.  We keep a small safety margin so a 28 s clip with a noisy
# header byte-count doesn't get rejected mid-flight.
_SARVAM_REST_MAX_SECONDS = 28.0

# When duration can't be detected (e.g. Chrome-recorded WebM/Opus, which
# mutagen doesn't reliably parse), fall back to a byte-size heuristic.  Opus at
# typical ~32 kbps gives ~4 KB/sec, so anything over 150 KB is probably > 30 s.
_SARVAM_REST_MAX_BYTES_FALLBACK = 150 * 1024


def _get_audio_duration_seconds(audio_bytes: bytes, mime_type: str) -> Optional[float]:
    """
    Best-effort duration probe from in-memory bytes.

    Returns float seconds when the format is parseable, or None when it isn't
    (the caller then falls back to a byte-size heuristic).  No external tools —
    pure-Python via the `wave` stdlib module + `mutagen` for everything else.
    """
    # 1) WAV via stdlib — most reliable for our mic uploads
    if "wav" in (mime_type or "").lower():
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as w:
                return w.getnframes() / float(w.getframerate())
        except Exception:
            pass

    # 2) MP3 / M4A / OGG / FLAC / Opus via mutagen
    try:
        from mutagen import File as MutagenFile  # lazy import; small dep
        bio = io.BytesIO(audio_bytes)
        f = MutagenFile(bio)
        if f is not None and getattr(f, "info", None) is not None:
            length = getattr(f.info, "length", None)
            if length and length > 0:
                return float(length)
    except Exception:
        pass

    return None


def _should_use_batch(audio_bytes: bytes, mime_type: str, force_batch: bool = False) -> tuple[bool, Optional[float]]:
    """
    Decide REST vs Batch for Sarvam. Returns (use_batch, duration_seconds_or_None).

    Logic:
      - force_batch=True wins immediately.
      - If duration is known and > 28 s → Batch.
      - If duration unknown and bytes > 150 KB → Batch (likely > 30 s).
      - Otherwise → REST (fast path).
    """
    duration = _get_audio_duration_seconds(audio_bytes, mime_type)
    if force_batch:
        return True, duration
    if duration is not None:
        return duration > _SARVAM_REST_MAX_SECONDS, duration
    return len(audio_bytes) > _SARVAM_REST_MAX_BYTES_FALLBACK, duration


# ── Common result shape ──────────────────────────────────────────────────────

@dataclass
class STTResult:
    """One transcription result, regardless of provider."""
    provider: str                                 # "sarvam" | "gemini"
    model: str                                    # exact model id used
    transcript: str                               # Tamil (or original-language) transcript
    english_translation: Optional[str] = None     # only filled by translate-mode calls
    language_code: Optional[str] = None           # BCP-47 detected language (Sarvam only)
    language_probability: Optional[float] = None  # 0.0–1.0 (Sarvam only)
    timestamps: Optional[dict] = None             # chunk-level timing (Sarvam only)
    latency_ms: int = 0                           # round-trip wall-clock time
    duration_seconds: Optional[float] = None      # detected audio length (None if unknown)
    used_batch: bool = False                      # True if Sarvam Batch API was used
    error: Optional[str] = None                   # set if the call failed
    raw: dict = field(default_factory=dict)       # full provider response for inspection


# ── Sarvam STT ────────────────────────────────────────────────────────────────

class SarvamSTTService:
    """
    Wrapper around Sarvam AI's `POST /speech-to-text` REST endpoint.

    Constraints (REST mode):
      - Audio under 30 seconds per request.
      - Optimal sample rate 16 kHz.
      - Supports: WAV, MP3, AAC, AIFF, OGG, OPUS, FLAC, MP4/M4A, AMR, WMA, WebM, PCM.

    Usage:
        svc = SarvamSTTService.from_settings()
        result = svc.transcribe(audio_bytes, filename="clip.wav", mime_type="audio/wav")
    """

    def __init__(
        self,
        api_key: str,
        model: str = "saaras:v3",
        language_code: str = "ta-IN",
        base_url: str = "https://api.sarvam.ai",
        timeout_seconds: int = 60,
    ) -> None:
        if not api_key:
            raise ValueError("SARVAM_API_KEY is required to construct the service.")
        self._api_key = api_key
        self._model = model
        self._language_code = language_code
        self._endpoint = f"{base_url.rstrip('/')}/speech-to-text"
        self._timeout = timeout_seconds

    @classmethod
    def from_settings(cls) -> "SarvamSTTService":
        """Build the service using `src.core.config.settings`."""
        from src.core.config import settings  # lazy: keep module importable cold
        if not settings.SARVAM_API_KEY:
            raise ValueError(
                "SARVAM_API_KEY is not set. Add it to backend/.env:\n"
                "    SARVAM_API_KEY=sk_..."
            )
        return cls(
            api_key=settings.SARVAM_API_KEY,
            model=settings.SARVAM_STT_MODEL,
            language_code=settings.SARVAM_STT_LANGUAGE,
            base_url=settings.SARVAM_API_BASE_URL,
        )

    def transcribe(
        self,
        audio_bytes: bytes,
        filename: str = "audio.wav",
        mime_type: str = "audio/wav",
        mode: str = "transcribe",
        with_timestamps: bool = False,
        with_diarization: bool = False,
        force_batch: bool = False,
    ) -> STTResult:
        """
        Auto-routing entry point: clips ≤ 28 s go through the REST API
        (~1 s round-trip), longer clips use the Batch API (~30–120 s including
        polling overhead).  Set `force_batch=True` to always use Batch.

        `mode` is only honoured for saaras:v3. Valid values:
          - "transcribe": verbatim transcript in source language (default)
          - "translate":  Indian-language source → English transcript
          - "verbatim":   keep disfluencies (uhh, hmm)
          - "translit":   Indian-language text in Roman script
          - "codemix":    optimised for Tamil+English mixed speech
        """
        use_batch, duration = _should_use_batch(audio_bytes, mime_type, force_batch=force_batch)
        if use_batch:
            return self._transcribe_batch(
                audio_bytes=audio_bytes,
                filename=filename,
                mime_type=mime_type,
                mode=mode,
                with_timestamps=with_timestamps,
                with_diarization=with_diarization,
                duration_seconds=duration,
            )
        return self._transcribe_rest(
            audio_bytes=audio_bytes,
            filename=filename,
            mime_type=mime_type,
            mode=mode,
            with_timestamps=with_timestamps,
            with_diarization=with_diarization,
            duration_seconds=duration,
        )

    # ── REST (≤ 30 s) ─────────────────────────────────────────────────────────

    def _transcribe_rest(
        self,
        audio_bytes: bytes,
        filename: str,
        mime_type: str,
        mode: str,
        with_timestamps: bool,
        with_diarization: bool,
        duration_seconds: Optional[float],
    ) -> STTResult:
        """Fast synchronous path. Never raises — sets `.error` on failure."""
        t0 = time.monotonic()
        try:
            files = {"file": (filename, audio_bytes, mime_type)}
            data = {
                "model": self._model,
                "language_code": self._language_code,
            }
            # `mode` is a saaras:v3-only parameter; only attach it when the
            # model actually consumes it.
            if self._model.startswith("saaras"):
                data["mode"] = mode
            if with_timestamps:
                data["with_timestamps"] = "true"
            if with_diarization:
                data["with_diarization"] = "true"

            response = requests.post(
                self._endpoint,
                headers={"api-subscription-key": self._api_key},
                files=files,
                data=data,
                timeout=self._timeout,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            if response.status_code != 200:
                return STTResult(
                    provider="sarvam",
                    model=self._model,
                    transcript="",
                    latency_ms=elapsed_ms,
                    duration_seconds=duration_seconds,
                    used_batch=False,
                    error=f"HTTP {response.status_code}: {response.text[:300]}",
                )

            body = response.json()
            transcript = body.get("transcript", "") or ""
            return STTResult(
                provider="sarvam",
                model=self._model,
                transcript=transcript if mode != "translate" else "",
                english_translation=transcript if mode == "translate" else None,
                language_code=body.get("language_code"),
                language_probability=body.get("language_probability"),
                timestamps=body.get("timestamps"),
                latency_ms=elapsed_ms,
                duration_seconds=duration_seconds,
                used_batch=False,
                raw=body,
            )

        except Exception as exc:
            return STTResult(
                provider="sarvam",
                model=self._model,
                transcript="",
                latency_ms=int((time.monotonic() - t0) * 1000),
                duration_seconds=duration_seconds,
                used_batch=False,
                error=f"{type(exc).__name__}: {exc}",
            )

    # ── Batch (up to 2 hours) ─────────────────────────────────────────────────

    def _transcribe_batch(
        self,
        audio_bytes: bytes,
        filename: str,
        mime_type: str,
        mode: str,
        with_timestamps: bool,
        with_diarization: bool,
        duration_seconds: Optional[float],
    ) -> STTResult:
        """
        Slow async path via Sarvam's Batch API. Uses the official `sarvamai`
        SDK which handles job creation, upload, start, polling, and download.

        The SDK takes file PATHS (not bytes), so we round-trip through a temp
        file. The temp file is deleted as soon as the job finishes (or fails).
        """
        t0 = time.monotonic()
        tmp_path: Optional[str] = None
        try:
            # Lazy import keeps the REST-only path free of an extra dependency
            # at import time.
            from sarvamai import SarvamAI

            client = SarvamAI(api_subscription_key=self._api_key)

            # Write bytes to a temp file with the original extension so the
            # batch SDK can detect the format correctly.
            suffix = "." + (filename.rsplit(".", 1)[-1] if "." in filename else "wav")
            fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="sarvam_batch_")
            with os.fdopen(fd, "wb") as fh:
                fh.write(audio_bytes)

            # Create + run the job
            create_kwargs = {
                "model": self._model,
                "mode": mode,
                "language_code": self._language_code,
                "with_diarization": with_diarization,
                "with_timestamps": with_timestamps,
            }
            job = client.speech_to_text_job.create_job(**create_kwargs)
            job.upload_files(file_paths=[tmp_path])
            job.start()
            # Poll every 5 s, timeout after 10 min (covers 2-hour clips that
            # finish in a few minutes; raise if anything else goes sideways).
            job.wait_until_complete(poll_interval=5, timeout=600)
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            if not job.is_successful():
                status = job.get_status()
                return STTResult(
                    provider="sarvam",
                    model=self._model,
                    transcript="",
                    latency_ms=elapsed_ms,
                    duration_seconds=duration_seconds,
                    used_batch=True,
                    error=f"Batch job failed: state={getattr(status, 'job_state', '?')}",
                )

            # The job's manifest (`get_file_results()`) only tells us which
            # output files were produced — `{successful: [{file_name, status,
            # output_file}], failed: [...]}`. The actual transcripts live in
            # JSON files we have to download. `download_outputs(output_dir)`
            # writes one file per input as `<input_filename>.json`, each with
            # the same shape as the REST response (transcript, language_code,
            # timestamps, diarized_transcript, language_probability).
            outputs_dir = tempfile.mkdtemp(prefix="sarvam_outputs_")
            try:
                job.download_outputs(output_dir=outputs_dir)

                transcripts: list[str] = []
                language_codes: list[str] = []
                language_probs: list[float] = []
                timestamps_combined: Optional[dict] = None
                raw_outputs: list[dict] = []

                import json as _json
                for fname in sorted(os.listdir(outputs_dir)):
                    if not fname.endswith(".json"):
                        continue
                    fpath = os.path.join(outputs_dir, fname)
                    try:
                        with open(fpath, encoding="utf-8") as fh:
                            out = _json.load(fh)
                    except Exception:
                        continue
                    raw_outputs.append(out)
                    t = (out.get("transcript") or "").strip()
                    if t:
                        transcripts.append(t)
                    if out.get("language_code"):
                        language_codes.append(out["language_code"])
                    if out.get("language_probability") is not None:
                        language_probs.append(out["language_probability"])
                    if out.get("timestamps") and timestamps_combined is None:
                        timestamps_combined = out["timestamps"]
            finally:
                # Clean up the downloaded transcript files
                try:
                    import shutil
                    shutil.rmtree(outputs_dir, ignore_errors=True)
                except Exception:
                    pass

            full_transcript = "\n".join(transcripts).strip()
            return STTResult(
                provider="sarvam",
                model=self._model,
                transcript=full_transcript if mode != "translate" else "",
                english_translation=full_transcript if mode == "translate" else None,
                language_code=language_codes[0] if language_codes else None,
                language_probability=language_probs[0] if language_probs else None,
                timestamps=timestamps_combined,
                latency_ms=elapsed_ms,
                duration_seconds=duration_seconds,
                used_batch=True,
                raw={"outputs": raw_outputs},
            )

        except Exception as exc:
            return STTResult(
                provider="sarvam",
                model=self._model,
                transcript="",
                latency_ms=int((time.monotonic() - t0) * 1000),
                duration_seconds=duration_seconds,
                used_batch=True,
                error=f"{type(exc).__name__}: {exc}",
            )
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass


# ── Gemini audio transcription ────────────────────────────────────────────────

class GeminiSTTService:
    """
    Wrapper that uses our existing Gemini client to transcribe audio.

    Note: per Google's docs, Gemini is "audio understanding", not dedicated STT.
    We push it into transcription duty via a tightly-scoped prompt that asks for
    verbatim output and nothing else. Quality is good for clean speech in major
    languages but is not benchmarked for Tamil specifically — that's exactly
    what this Streamlit tester is for.
    """

    # System-style instruction. We pass it as the first text part so the
    # response is just the transcript text, no preamble, no markdown.
    _TRANSCRIBE_PROMPT_TA = (
        "Transcribe the following audio recording verbatim in TAMIL script (தமிழ்). "
        "If the speaker uses English words mixed with Tamil, keep them in Roman script. "
        "Preserve numbers, names, scheme names, and reference numbers exactly. "
        "Return ONLY the transcript text — no commentary, no markdown, no quotes."
    )
    _TRANSLATE_PROMPT_TA_TO_EN = (
        "Listen to the following audio and produce an ENGLISH translation of what was said. "
        "Preserve names, places, amounts, and reference numbers exactly. "
        "Return ONLY the English translation — no commentary, no preamble."
    )

    def __init__(
        self,
        api_key: str,
        model_name: str = "gemini-2.5-flash",
        service_tier: Optional[str] = "priority",
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required to construct the service.")
        self._client = genai.Client(api_key=api_key)
        self._model_name = model_name
        self._service_tier = self._resolve_tier(service_tier)

    @staticmethod
    def _resolve_tier(value: Optional[str]) -> Optional["types.ServiceTier"]:
        if not value:
            return None
        try:
            return types.ServiceTier(value.lower())
        except ValueError:
            return None

    @classmethod
    def from_settings(cls) -> "GeminiSTTService":
        from src.core.config import settings
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set.")
        return cls(
            api_key=settings.GEMINI_API_KEY,
            model_name=settings.GEMINI_PRIMARY_MODEL,
            service_tier=settings.GEMINI_SERVICE_TIER,
        )

    def transcribe(
        self,
        audio_bytes: bytes,
        mime_type: str = "audio/wav",
        translate_to_english: bool = False,
    ) -> STTResult:
        """Single Gemini call. Same contract as SarvamSTTService.transcribe()."""
        t0 = time.monotonic()
        duration = _get_audio_duration_seconds(audio_bytes, mime_type)
        prompt = (
            self._TRANSLATE_PROMPT_TA_TO_EN if translate_to_english
            else self._TRANSCRIBE_PROMPT_TA
        )
        try:
            config = types.GenerateContentConfig(
                temperature=0.0,        # deterministic verbatim output
                top_p=1.0,
                service_tier=self._service_tier,
            )
            response = self._client.models.generate_content(
                model=self._model_name,
                contents=[
                    prompt,
                    types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                ],
                config=config,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            text = (response.text or "").strip()

            return STTResult(
                provider="gemini",
                model=self._model_name,
                transcript=text if not translate_to_english else "",
                english_translation=text if translate_to_english else None,
                latency_ms=elapsed_ms,
                duration_seconds=duration,
                raw={"text": text},
            )

        except Exception as exc:
            return STTResult(
                provider="gemini",
                model=self._model_name,
                transcript="",
                latency_ms=int((time.monotonic() - t0) * 1000),
                duration_seconds=duration,
                error=f"{type(exc).__name__}: {exc}",
            )
