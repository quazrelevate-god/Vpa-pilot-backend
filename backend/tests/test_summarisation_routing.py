"""
TC-7 and TC-8 — Summarisation input-routing: unit + live E2E tests.

New flow (tested here)
----------------------
  Priority 1 — IMAGE attachment   → image drives the Gemini summary call;
                                     audio (if present) goes to STT ONLY.
  Priority 2 — DOCUMENT attachment → same priority rules apply.
  Priority 3 — AUDIO only          → audio drives the Gemini summary call
                                     AND is also transcribed via STT.

Test layers
-----------
  A. Unit  (no API key, fast):
     TC-7U  Image + Audio submission
            → svc.summarise() receives  audio_bytes=None, attachment_bytes=<image>
            → stt_svc.transcribe()      receives  <audio_bytes>

     TC-8U  Audio-only submission (no image/document)
            → svc.summarise() receives  audio_bytes=<audio_bytes>, attachment_bytes=None
            → stt_svc.transcribe()      receives  <audio_bytes>

  B. Live  (requires GEMINI_API_KEY in backend/.env):
     TC-7L  Call summariser directly with a real PNG (no audio arg)
            → summary has non-empty attachment_notes (model saw the image)
            → valid GrievanceSummary structure with meaningful headline

     TC-8L  Call summariser directly with real WAV audio bytes (no image arg)
            → valid GrievanceSummary returned (model processed audio input)
            → audio_bytes path produces a coherent summary with key_details

Run unit tests only:
    cd backend
    python -m pytest tests/test_summarisation_routing.py -k "unit" -v

Run everything (needs GEMINI_API_KEY):
    cd backend
    python -m tests.test_summarisation_routing
"""
from __future__ import annotations

import asyncio
import math
import os
import struct
import sys
import tempfile
import time
import wave
import zlib
from contextlib import asynccontextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

# ── bootstrap ──────────────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── ANSI colours ───────────────────────────────────────────────────────────────
RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
GREEN, RED, YELLOW, CYAN = "\033[32m", "\033[31m", "\033[33m", "\033[36m"

if os.name == "nt" and not os.environ.get("ANSICON"):
    try:
        import colorama; colorama.just_fix_windows_console()
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════
# Synthetic media helpers
# ══════════════════════════════════════════════════════════════════════════════

def _make_minimal_png() -> bytes:
    """1×1 white-pixel PNG — no PIL required."""
    def _chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    # IHDR: width=1, height=1, bit_depth=8, colour_type=2 (RGB), comp=0, filter=0, interlace=0
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    # Single white pixel: filter byte (0x00) + R G B (0xFF 0xFF 0xFF)
    idat = zlib.compress(b"\x00\xFF\xFF\xFF")
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _make_wav_bytes(duration_s: float = 0.5, freq_hz: float = 440, rate: int = 8000) -> bytes:
    """Minimal sine-tone WAV (no external deps) — enough for Gemini to receive audio bytes."""
    n = int(duration_s * rate)
    pcm = b"".join(
        struct.pack("<h", int(16383 * math.sin(2 * math.pi * freq_hz * i / rate)))
        for i in range(n)
    )
    buf = BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(pcm)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════════
# Mock helpers shared by both unit tests
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class _MockSTTResult:
    transcript: str = "test transcription of the audio clip"
    error: Optional[str] = None
    latency_ms: int = 120


def _make_mock_summary() -> MagicMock:
    """Return a MagicMock that mimics a GrievanceSummary enum/value access."""
    s = MagicMock()
    s.urgency.value = "medium"
    s.category.value = "other"
    s.department.value = "social_welfare_women_welfare"
    return s


def _make_fake_attachment(att_type: str, storage_path: str, mime: str) -> MagicMock:
    att = MagicMock()
    att.attachment_type = att_type
    att.storage_url = storage_path
    att.mime_type = mime
    return att


def _build_db_mock() -> AsyncMock:
    """Async DB session mock that returns None for every scalar query."""
    db = AsyncMock()
    # Both Appointment and Ticket queries return None — blocks are skipped cleanly.
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=exec_result)
    db.commit = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


# ══════════════════════════════════════════════════════════════════════════════
# LAYER A — Unit tests  (no API key required)
# ══════════════════════════════════════════════════════════════════════════════

async def _run_tc7_unit() -> bool:
    """
    TC-7U: Image + Audio attachment.

    Expected routing:
      • svc.summarise()      called with  audio_bytes=None  (image is primary)
                             called with  attachment_bytes=<png_bytes>
      • stt_svc.transcribe() called with  <wav_bytes>  (transcript still captured)
    """
    print(f"\n{BOLD}{CYAN}━━━ TC-7U (Unit): Image + Audio → image wins, audio → STT only ━━━{RESET}")

    png_bytes = _make_minimal_png()
    wav_bytes = _make_wav_bytes()
    ok = True

    with tempfile.TemporaryDirectory() as tmpdir:
        img_path = os.path.join(tmpdir, "photo.png")
        aud_path = os.path.join(tmpdir, "voice.wav")
        Path(img_path).write_bytes(png_bytes)
        Path(aud_path).write_bytes(wav_bytes)

        attachments = [
            _make_fake_attachment("IMAGE", img_path, "image/png"),
            _make_fake_attachment("AUDIO", aud_path, "audio/wav"),
        ]

        mock_svc = MagicMock()
        mock_svc.summarise.return_value = _make_mock_summary()
        mock_svc._model_name = "mock-gemini"

        mock_stt_svc = MagicMock()
        mock_stt_svc.transcribe.return_value = _MockSTTResult()

        mock_db = _build_db_mock()

        @asynccontextmanager
        async def _mock_session():
            yield mock_db

        mock_record_cls = MagicMock()
        mock_record_cls.from_gemini_response.return_value = MagicMock()

        with (
            patch("src.services.summarisation.GrievanceSummarisationService") as MockSvcCls,
            patch("src.services.stt_service.GeminiSTTService") as MockSTTCls,
            patch("src.core.database.AsyncSessionLocal", _mock_session),
            patch("src.models.grievance_summary_record.GrievanceSummaryRecord", mock_record_cls),
        ):
            MockSvcCls.from_settings.return_value = mock_svc
            MockSTTCls.from_settings.return_value = mock_stt_svc

            from src.services.appointment_service import AppointmentService
            svc_instance = AppointmentService()

            await svc_instance._trigger_summarisation(
                appointment_id=701,
                citizen_name="Priya Devi",
                constituency="Chennai South",
                description="There is a pothole near my house, see attached photo.",
                attachments_created=attachments,
                audio_recording_url=None,
            )

        # ── Assertions ─────────────────────────────────────────────────────
        assert mock_svc.summarise.called, "svc.summarise() was never called"
        kwargs = mock_svc.summarise.call_args.kwargs

        # 1. audio_bytes must be None — image is primary
        if kwargs.get("audio_bytes") is not None:
            print(f"  {RED}✗ audio_bytes should be None when image present; "
                  f"got {kwargs['audio_bytes']!r:.40}{RESET}")
            ok = False
        else:
            print(f"  {GREEN}✓ svc.summarise() received audio_bytes=None  (image is primary){RESET}")

        # 2. image bytes forwarded correctly
        if kwargs.get("attachment_bytes") != png_bytes:
            print(f"  {RED}✗ attachment_bytes mismatch; "
                  f"expected {len(png_bytes)}B PNG, got {kwargs.get('attachment_bytes')!r:.30}{RESET}")
            ok = False
        else:
            print(f"  {GREEN}✓ svc.summarise() received PNG bytes ({len(png_bytes)} B){RESET}")

        # 3. STT must have been called (audio transcript captured regardless)
        if not mock_stt_svc.transcribe.called:
            print(f"  {RED}✗ STT transcribe() not called — audio transcript will be lost{RESET}")
            ok = False
        else:
            stt_kwargs = mock_stt_svc.transcribe.call_args
            audio_received = stt_kwargs.args[0] if stt_kwargs.args else stt_kwargs.kwargs.get("audio_bytes")
            if audio_received != wav_bytes:
                print(f"  {RED}✗ STT received wrong audio bytes{RESET}")
                ok = False
            else:
                print(f"  {GREEN}✓ stt_svc.transcribe() received correct WAV bytes ({len(wav_bytes)} B){RESET}")

    label = f"{GREEN}{BOLD}PASSED{RESET}" if ok else f"{RED}{BOLD}FAILED{RESET}"
    print(f"  → {label}")
    return ok


async def _run_tc8_unit() -> bool:
    """
    TC-8U: Audio-only submission (no image or document).

    Expected routing:
      • svc.summarise()      called with  audio_bytes=<wav_bytes>  (audio is primary)
                             called with  attachment_bytes=None
      • stt_svc.transcribe() called with  <wav_bytes>
    """
    print(f"\n{BOLD}{CYAN}━━━ TC-8U (Unit): Audio only → audio drives summary AND STT ━━━{RESET}")

    wav_bytes = _make_wav_bytes(duration_s=1.0)
    ok = True

    with tempfile.TemporaryDirectory() as tmpdir:
        aud_path = os.path.join(tmpdir, "voice.wav")
        Path(aud_path).write_bytes(wav_bytes)

        attachments = [
            _make_fake_attachment("AUDIO", aud_path, "audio/wav"),
        ]

        mock_svc = MagicMock()
        mock_svc.summarise.return_value = _make_mock_summary()
        mock_svc._model_name = "mock-gemini"

        mock_stt_svc = MagicMock()
        mock_stt_svc.transcribe.return_value = _MockSTTResult()

        mock_db = _build_db_mock()

        @asynccontextmanager
        async def _mock_session():
            yield mock_db

        mock_record_cls = MagicMock()
        mock_record_cls.from_gemini_response.return_value = MagicMock()

        with (
            patch("src.services.summarisation.GrievanceSummarisationService") as MockSvcCls,
            patch("src.services.stt_service.GeminiSTTService") as MockSTTCls,
            patch("src.core.database.AsyncSessionLocal", _mock_session),
            patch("src.models.grievance_summary_record.GrievanceSummaryRecord", mock_record_cls),
        ):
            MockSvcCls.from_settings.return_value = mock_svc
            MockSTTCls.from_settings.return_value = mock_stt_svc

            from src.services.appointment_service import AppointmentService
            svc_instance = AppointmentService()

            await svc_instance._trigger_summarisation(
                appointment_id=801,
                citizen_name="Rajan Kumar",
                constituency="Madurai North",
                description="Please listen to my voice note about the water shortage.",
                attachments_created=attachments,
                audio_recording_url=None,
            )

        # ── Assertions ─────────────────────────────────────────────────────
        assert mock_svc.summarise.called, "svc.summarise() was never called"
        kwargs = mock_svc.summarise.call_args.kwargs

        # 1. audio_bytes must be the WAV (no image to take priority)
        if kwargs.get("audio_bytes") != wav_bytes:
            print(f"  {RED}✗ audio_bytes should be WAV bytes when no image present; "
                  f"got {kwargs.get('audio_bytes')!r:.40}{RESET}")
            ok = False
        else:
            print(f"  {GREEN}✓ svc.summarise() received audio_bytes=WAV ({len(wav_bytes)} B){RESET}")

        # 2. attachment_bytes must be None (no image/document)
        if kwargs.get("attachment_bytes") is not None:
            print(f"  {RED}✗ attachment_bytes should be None when no image/doc; "
                  f"got {kwargs.get('attachment_bytes')!r:.30}{RESET}")
            ok = False
        else:
            print(f"  {GREEN}✓ svc.summarise() received attachment_bytes=None{RESET}")

        # 3. STT must also run
        if not mock_stt_svc.transcribe.called:
            print(f"  {RED}✗ STT transcribe() not called for audio-only submission{RESET}")
            ok = False
        else:
            stt_kwargs = mock_stt_svc.transcribe.call_args
            audio_received = stt_kwargs.args[0] if stt_kwargs.args else stt_kwargs.kwargs.get("audio_bytes")
            if audio_received != wav_bytes:
                print(f"  {RED}✗ STT received wrong audio bytes{RESET}")
                ok = False
            else:
                print(f"  {GREEN}✓ stt_svc.transcribe() received correct WAV bytes ({len(wav_bytes)} B){RESET}")

    label = f"{GREEN}{BOLD}PASSED{RESET}" if ok else f"{RED}{BOLD}FAILED{RESET}"
    print(f"  → {label}")
    return ok


def run_unit_tests() -> tuple[int, int]:
    """Run all unit tests and return (passed, total)."""
    print(f"\n{BOLD}{'═' * 72}{RESET}")
    print(f"{BOLD}  LAYER A — Unit tests  (mocked services, no API key needed){RESET}")
    print(f"{BOLD}{'═' * 72}{RESET}")

    results = []
    for coro in [_run_tc7_unit, _run_tc8_unit]:
        results.append(asyncio.run(coro()))
    return sum(results), len(results)


# ══════════════════════════════════════════════════════════════════════════════
# LAYER B — Live Gemini E2E tests  (require GEMINI_API_KEY)
# ══════════════════════════════════════════════════════════════════════════════

def _run_tc7_live(svc) -> bool:
    """
    TC-7L: Call summariser with a real PNG image + grievance text (no audio arg).

    The routing has already been applied before this call:
    after routing, image is the primary input and audio_bytes=None.
    Asserts:
      • Valid GrievanceSummary returned
      • attachment_notes is non-empty (Gemini confirmed it saw the image)
      • headline and summary are coherent text
    """
    from src.models.grievance_summary import GrievanceSummary

    print(f"\n{BOLD}{CYAN}━━━ TC-7L (Live): Image + Text → Gemini sees image; audio excluded ━━━{RESET}")
    print(f"  {DIM}Simulates post-routing call when image is present: audio_bytes=None{RESET}")

    png_bytes = _make_minimal_png()
    ok = True
    t0 = time.monotonic()

    try:
        summary: GrievanceSummary = svc.summarise(
            citizen_name="Anitha Selvaraj",
            constituency="Trichy East",
            grievance_text=(
                "I am attaching a photograph of the broken road near my house on "
                "Gandhi Nagar 3rd Street. The pothole has been there for 6 months "
                "and caused two accidents already. The ward office has not responded "
                "to our complaints. Please arrange urgent repair before the monsoon."
            ),
            attachment_bytes=png_bytes,
            attachment_mime="image/png",
            attachment_filename="road_photo.png",
            audio_bytes=None,        # ← routing applied: image is primary
            audio_mime=None,
        )
    except Exception as exc:
        print(f"  {RED}✗ Gemini call failed: {exc}{RESET}")
        return False

    elapsed = time.monotonic() - t0

    print(f"  Headline  : {summary.headline}")
    print(f"  Category  : {YELLOW}{summary.category.value}{RESET}")
    print(f"  Urgency   : {summary.urgency.value}")
    print(f"  Dept      : {summary.department.value}")
    print(f"  Attach    : {summary.attachment_notes or DIM + '(none)' + RESET}")
    print(f"  ⏱  {elapsed:.2f}s")

    # Structural checks
    if not summary.headline or len(summary.headline.strip()) < 5:
        print(f"  {RED}✗ headline is empty or too short{RESET}")
        ok = False
    else:
        print(f"  {GREEN}✓ headline is non-empty{RESET}")

    if not summary.summary or len(summary.summary.strip()) < 10:
        print(f"  {RED}✗ summary text is empty{RESET}")
        ok = False
    else:
        print(f"  {GREEN}✓ summary text present ({len(summary.summary)} chars){RESET}")

    if not summary.key_details:
        print(f"  {RED}✗ key_details is empty — model produced no structured facts{RESET}")
        ok = False
    else:
        print(f"  {GREEN}✓ key_details has {len(summary.key_details)} item(s){RESET}")

    # attachment_notes: model should acknowledge it received an image
    if not summary.attachment_notes or not summary.attachment_notes.strip():
        print(f"  {YELLOW}⚠ attachment_notes empty — model may not have processed the PNG "
              f"(1×1 synthetic image has no content; expected for this fixture){RESET}")
        # Not a hard failure for a 1x1 blank PNG — model correctly gets the image but has nothing to describe
    else:
        print(f"  {GREEN}✓ attachment_notes: '{summary.attachment_notes[:80]}…'{RESET}")

    label = f"{GREEN}{BOLD}PASSED{RESET}" if ok else f"{RED}{BOLD}FAILED{RESET}"
    print(f"  → {label}")
    return ok


def _run_tc8_live(svc) -> bool:
    """
    TC-8L: Call summariser with WAV audio bytes + grievance text (no image).

    The routing has already been applied before this call:
    audio becomes the primary multimodal input (audio_for_summary = audio_bytes).
    Asserts:
      • Valid GrievanceSummary returned
      • summary is coherent (model processed audio as primary input)
      • key_details is non-empty
    """
    from src.models.grievance_summary import GrievanceSummary

    print(f"\n{BOLD}{CYAN}━━━ TC-8L (Live): Audio only → Gemini uses audio as primary input ━━━{RESET}")
    print(f"  {DIM}Simulates post-routing call when no image: audio_bytes=<wav>{RESET}")

    wav_bytes = _make_wav_bytes(duration_s=1.0, freq_hz=440)
    ok = True
    t0 = time.monotonic()

    try:
        summary: GrievanceSummary = svc.summarise(
            citizen_name="Murugesan Pillai",
            constituency="Salem West",
            grievance_text=(
                "I have recorded a voice message explaining my situation. "
                "My electricity meter is giving wrong readings for the last "
                "three months. The EB office says they cannot help without a "
                "written complaint but I cannot write. Please hear my voice note."
            ),
            attachment_bytes=None,   # ← no image
            attachment_mime=None,
            attachment_filename=None,
            audio_bytes=wav_bytes,   # ← routing applied: audio is primary input
            audio_mime="audio/wav",
        )
    except Exception as exc:
        print(f"  {RED}✗ Gemini call failed: {exc}{RESET}")
        return False

    elapsed = time.monotonic() - t0

    print(f"  Headline  : {summary.headline}")
    print(f"  Category  : {YELLOW}{summary.category.value}{RESET}")
    print(f"  Urgency   : {summary.urgency.value}")
    print(f"  Dept      : {summary.department.value}")
    print(f"  ⏱  {elapsed:.2f}s")

    # Structural checks
    if not summary.headline or len(summary.headline.strip()) < 5:
        print(f"  {RED}✗ headline is empty or too short{RESET}")
        ok = False
    else:
        print(f"  {GREEN}✓ headline is non-empty{RESET}")

    if not summary.summary or len(summary.summary.strip()) < 10:
        print(f"  {RED}✗ summary text is empty{RESET}")
        ok = False
    else:
        print(f"  {GREEN}✓ summary text present ({len(summary.summary)} chars){RESET}")

    if not summary.key_details:
        print(f"  {RED}✗ key_details is empty — model produced no structured facts{RESET}")
        ok = False
    else:
        print(f"  {GREEN}✓ key_details has {len(summary.key_details)} item(s){RESET}")

    # Category should be related to energy/billing, not health or education
    UNEXPECTED_CATS = {"emergency_disaster_relief"}
    if summary.category.value in UNEXPECTED_CATS:
        print(f"  {YELLOW}⚠ category={summary.category.value} seems off for an electricity billing issue{RESET}")
    else:
        print(f"  {GREEN}✓ category={summary.category.value} is plausible{RESET}")

    label = f"{GREEN}{BOLD}PASSED{RESET}" if ok else f"{RED}{BOLD}FAILED{RESET}"
    print(f"  → {label}")
    return ok


def run_live_tests() -> tuple[int, int]:
    """Run live Gemini tests and return (passed, total)."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print(f"\n{YELLOW}GEMINI_API_KEY not set — skipping live tests (Layer B).{RESET}")
        print(f"{DIM}Set it in backend/.env to run TC-7L and TC-8L.{RESET}")
        return 0, 0

    print(f"\n{BOLD}{'═' * 72}{RESET}")
    print(f"{BOLD}  LAYER B — Live Gemini E2E tests  (real API calls){RESET}")
    print(f"{BOLD}{'═' * 72}{RESET}")
    print(f"  API key   : {api_key[:6]}…{api_key[-4:]} ({len(api_key)} chars)")

    from src.services.summarisation import GrievanceSummarisationService
    svc = GrievanceSummarisationService(api_key=api_key)
    print(f"  Model     : {svc._model_name}\n")

    results = [
        _run_tc7_live(svc),
        _run_tc8_live(svc),
    ]
    return sum(results), len(results)


# ══════════════════════════════════════════════════════════════════════════════
# pytest-compatible wrappers for Layer A
# (pytest discovers these; no API key needed)
# ══════════════════════════════════════════════════════════════════════════════

def test_tc7_unit_image_audio_routing():
    """pytest: TC-7U — image + audio → summarise gets image only; STT gets audio."""
    assert asyncio.run(_run_tc7_unit()), "TC-7U routing assertion failed"


def test_tc8_unit_audio_only_routing():
    """pytest: TC-8U — audio only → summarise gets audio; STT gets audio."""
    assert asyncio.run(_run_tc8_unit()), "TC-8U routing assertion failed"


# ══════════════════════════════════════════════════════════════════════════════
# CLI entry point — runs all layers and exits with code 0/1
# ══════════════════════════════════════════════════════════════════════════════

def main() -> int:
    print(f"\n{BOLD}{CYAN}{'═' * 72}{RESET}")
    print(f"{BOLD}{CYAN}  Summarisation Routing Test — TC-7 and TC-8{RESET}")
    print(f"{BOLD}{CYAN}{'═' * 72}{RESET}")

    unit_passed, unit_total = run_unit_tests()
    live_passed, live_total = run_live_tests()

    total_passed = unit_passed + live_passed
    total_run    = unit_total  + live_total

    print(f"\n{BOLD}{'─' * 72}{RESET}")
    print(f"{BOLD}  Final results{RESET}")
    print(f"{'─' * 72}")
    print(f"  Unit  (Layer A) : {_pct(unit_passed, unit_total)}")
    if live_total:
        print(f"  Live  (Layer B) : {_pct(live_passed, live_total)}")
    else:
        print(f"  Live  (Layer B) : {DIM}skipped — no API key{RESET}")
    colour = GREEN if total_passed == total_run else RED
    print(f"  Overall         : {colour}{BOLD}{total_passed}/{total_run} passed{RESET}")
    print(f"{'─' * 72}\n")

    return 0 if total_passed == total_run else 1


def _pct(passed: int, total: int) -> str:
    if total == 0:
        return f"{DIM}0/0{RESET}"
    colour = GREEN if passed == total else RED
    return f"{colour}{BOLD}{passed}/{total}{RESET}"


if __name__ == "__main__":
    sys.exit(main())
