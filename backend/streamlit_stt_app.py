"""
STT Comparison Tester — Sarvam vs Gemini
════════════════════════════════════════

Standalone Streamlit app for validating which STT provider handles Tamil
petition audio best.  Runs both Sarvam (Saaras v3) and Gemini (2.5 Flash) on
the SAME audio clip in parallel, shows the transcripts side-by-side, records
your judgement, and tracks running latency averages.

Run with:
    cd backend
    venv/Scripts/streamlit run streamlit_stt_app.py --server.port 8502

Why a separate Streamlit app?
-----------------------------
We already have `streamlit_app.py` for grievance summarisation. Keeping STT
on its own port (8502) means you can run both side-by-side without
session-state collisions, and the existing tester stays untouched until STT
is validated and integrated into the appointment flow.

The audio you upload is held in memory only — nothing is written to disk and
no DB row is created. Pure read-only experimentation.
"""
from __future__ import annotations

import io
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import streamlit as st

# Make the project importable when launched from any cwd.
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.services.stt_service import (  # noqa: E402
    GeminiSTTService,
    SarvamSTTService,
    STTResult,
    _get_audio_duration_seconds,
)


def _fmt_duration(seconds: Optional[float]) -> str:
    """Format seconds as 0:07.3 / 1:23 / 12:05 — graceful for unknowns."""
    if seconds is None:
        return "—"
    m, s = divmod(seconds, 60)
    return f"{int(m)}:{s:04.1f}" if m < 1 else f"{int(m)}:{int(s):02d}"

# ── Page setup ────────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="STT Tester — Sarvam vs Gemini",
    page_icon="🎙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
      .block-container { padding-top: 1.6rem; padding-bottom: 3rem; max-width: 1300px; }
      h1, h2, h3 { letter-spacing: -0.01em; }
      .small      { color: #64748b; font-size: 0.85rem; }
      .provider-card {
        border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px;
        background: #fafbfc; min-height: 280px;
      }
      .provider-card.sarvam { border-top: 3px solid #6366f1; }
      .provider-card.gemini { border-top: 3px solid #10b981; }
      .pill {
        display: inline-block; padding: 3px 10px; border-radius: 999px;
        font-size: 0.78rem; font-weight: 600; margin-right: 6px;
      }
      .pill-fast  { color: #047857; background: #e7f6ef; }
      .pill-slow  { color: #b45309; background: #fef6e7; }
      .pill-err   { color: #be123c; background: #fdeaee; }
      .pill-info  { color: #1e40af; background: #e0e7ff; }
      .transcript {
        background: white; border: 1px solid #e2e8f0; border-radius: 8px;
        padding: 14px 16px; font-size: 1rem; line-height: 1.6;
        white-space: pre-wrap; word-wrap: break-word; min-height: 120px;
      }
      .transcript.tamil { font-family: 'Noto Sans Tamil', 'Inter', sans-serif; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Initialise services (cached in session_state) ─────────────────────────────

def _init_services():
    """Create both clients once per session. Caches errors so the sidebar can show
    actionable status rather than crashing the page."""
    if "sarvam_svc" not in st.session_state:
        try:
            st.session_state["sarvam_svc"] = SarvamSTTService.from_settings()
            st.session_state["sarvam_err"] = None
        except Exception as exc:
            st.session_state["sarvam_svc"] = None
            st.session_state["sarvam_err"] = str(exc)

    if "gemini_svc" not in st.session_state:
        try:
            st.session_state["gemini_svc"] = GeminiSTTService.from_settings()
            st.session_state["gemini_err"] = None
        except Exception as exc:
            st.session_state["gemini_svc"] = None
            st.session_state["gemini_err"] = str(exc)


_init_services()
sarvam_svc: Optional[SarvamSTTService] = st.session_state.get("sarvam_svc")
gemini_svc: Optional[GeminiSTTService] = st.session_state.get("gemini_svc")

# Running averages of latency, kept in session for the chart at the bottom.
st.session_state.setdefault("latency_history", [])  # list[dict]
st.session_state.setdefault("scoring_history", [])  # list[dict]

# ── Sidebar: provider status + run options ────────────────────────────────────

with st.sidebar:
    st.markdown("### 🎙️ STT Tester")
    st.caption("Side-by-side Tamil transcription: Sarvam vs Gemini.")

    st.divider()
    st.markdown("**Provider status**")

    if sarvam_svc:
        st.success(
            f"Sarvam · `{sarvam_svc._model}` · `{sarvam_svc._language_code}`",
            icon="✅",
        )
    else:
        st.error(
            f"Sarvam unavailable:\n\n{st.session_state.get('sarvam_err', 'unknown')}",
            icon="⚠️",
        )

    if gemini_svc:
        st.success(
            f"Gemini · `{gemini_svc._model_name}` · priority tier",
            icon="✅",
        )
    else:
        st.error(
            f"Gemini unavailable:\n\n{st.session_state.get('gemini_err', 'unknown')}",
            icon="⚠️",
        )

    st.divider()
    st.markdown("**Run options**")

    sarvam_mode = st.selectbox(
        "Sarvam mode (saaras:v3)",
        options=["transcribe", "verbatim", "codemix", "translit"],
        index=0,
        help=(
            "transcribe: clean verbatim · "
            "verbatim: keeps uhh/hmm · "
            "codemix: optimised for Tamil+English · "
            "translit: Tamil in Roman script"
        ),
    )
    also_run_translate = st.checkbox(
        "Also run English translation",
        value=True,
        help="Fires a second call on each provider to translate the speech to English.",
    )
    force_batch = st.checkbox(
        "Force Sarvam Batch API",
        value=False,
        help=(
            "Sarvam REST is capped at ~30 s. Anything longer auto-routes to "
            "Batch (slower; polls every 5 s). Tick this to force Batch even "
            "for short clips (e.g. to A/B test the two pipelines)."
        ),
    )

    st.divider()
    st.markdown("**Session stats**")
    st.metric("Runs this session", len(st.session_state["latency_history"]))
    if st.button("Reset stats", use_container_width=True):
        st.session_state["latency_history"] = []
        st.session_state["scoring_history"] = []
        st.rerun()

# ── Header ────────────────────────────────────────────────────────────────────

st.title("🎙️ STT Tester — Sarvam vs Gemini")
st.markdown(
    "<span class='small'>Upload a Tamil audio clip (≤ 30 sec recommended — Sarvam's "
    "REST cap). Both providers transcribe in parallel; you compare and score. "
    "Latency and accuracy ratings persist for this session.</span>",
    unsafe_allow_html=True,
)

# ── Audio input — mic OR file upload ─────────────────────────────────────────

st.divider()
st.subheader("1 · Provide audio")

# Reset counter — bumping this gives the recorder/uploader widgets a fresh
# `key`, which is how Streamlit "forgets" the previous capture. Without this,
# `st.audio_input` keeps the prior recording stuck on screen forever.
st.session_state.setdefault("recorder_counter", 0)
_rc = st.session_state["recorder_counter"]

tab_mic, tab_upload = st.tabs(["🎤 Record from mic", "📁 Upload file"])

uploaded = None  # unified — set by whichever tab the user used

with tab_mic:
    st.caption(
        "Click the mic to record (browser will ask for mic permission once). "
        "Anything over ~28 s auto-uses Sarvam's Batch API. "
        "Chrome records as WebM/Opus."
    )
    mic_key = f"mic_input_{_rc}"
    mic_recording = st.audio_input(
        "🎙️ Record a Tamil grievance",
        key=mic_key,
        help="Press the red button to start, press again to stop.",
    )
    if mic_recording is not None:
        uploaded = mic_recording
        # st.audio_input gives a generic name; tag it so the history is readable
        if not getattr(uploaded, "name", None) or uploaded.name == "audio.wav":
            uploaded.name = f"mic_recording_{int(time.time())}.wav"

with tab_upload:
    upload_key = f"file_upload_{_rc}"
    file_upload = st.file_uploader(
        "Audio file (Tamil grievance recording)",
        type=["wav", "mp3", "m4a", "ogg", "flac", "webm", "aac"],
        help=(
            "Any common audio format. Optimal sample rate is 16 kHz. Clips "
            "longer than 28 s automatically route to Sarvam's Batch API."
        ),
        key=upload_key,
    )
    if file_upload is not None:
        uploaded = file_upload

# Common preview — shown whichever tab produced audio
if uploaded is not None:
    audio_bytes_preview = uploaded.getvalue()
    size_kb = len(audio_bytes_preview) / 1024
    mime = uploaded.type or "audio/wav"
    dur_seconds = _get_audio_duration_seconds(audio_bytes_preview, mime)
    source = "🎤 mic" if uploaded is st.session_state.get(mic_key) else "📁 upload"

    route_pill = (
        "<span class='pill pill-info'>🚀 REST path</span>"
        if (dur_seconds is not None and dur_seconds <= 28 and not force_batch
            and size_kb * 1024 <= 150 * 1024)
        else "<span class='pill pill-slow'>⏳ BATCH path (polls every 5 s)</span>"
    )

    st.markdown(
        f"<div class='small' style='margin-top:8px;'>"
        f"{source} · <b>{getattr(uploaded, 'name', 'audio')}</b> · "
        f"{mime} · {size_kb:,.1f} KB · "
        f"length: <b>{_fmt_duration(dur_seconds)}</b> "
        f"{route_pill}"
        f"</div>",
        unsafe_allow_html=True,
    )
    st.audio(audio_bytes_preview, format=mime)

    # ── Reset / clear button (works for both mic AND upload) ──────────────────
    rc1, rc2, _ = st.columns([1.5, 1.5, 4])
    with rc1:
        if st.button("🔄 Clear & re-record", use_container_width=True):
            st.session_state["recorder_counter"] += 1
            st.session_state.pop("last_results", None)
            st.session_state.pop("last_wallclock_ms", None)
            st.session_state.pop("last_filename", None)
            st.rerun()
    with rc2:
        if st.button("🧹 Clear results only", use_container_width=True,
                     help="Keep the audio, just drop the previous transcripts."):
            st.session_state.pop("last_results", None)
            st.session_state.pop("last_wallclock_ms", None)
            st.rerun()

# ── Run button ────────────────────────────────────────────────────────────────

st.divider()
st.subheader("2 · Run both providers")

ready = uploaded is not None and (sarvam_svc is not None or gemini_svc is not None)
col_run, _ = st.columns([1.4, 4])
with col_run:
    run = st.button(
        "🚀 Transcribe with both",
        type="primary",
        use_container_width=True,
        disabled=not ready,
    )

if not ready and uploaded is None:
    st.info("Upload an audio file to enable the run button.")


# ── Parallel execution helper ─────────────────────────────────────────────────

def _run_both_parallel(
    audio_bytes: bytes,
    filename: str,
    mime_type: str,
) -> dict:
    """
    Fire Sarvam + Gemini concurrently on background threads. Returns a dict with
    up to four results: sarvam_transcribe, sarvam_translate, gemini_transcribe,
    gemini_translate.  Missing providers are skipped silently.

    Threads are used (not asyncio) because Streamlit blocks on its main loop and
    both client libraries are synchronous.
    """
    results: dict = {}

    def _sarvam_transcribe():
        if sarvam_svc:
            results["sarvam_transcribe"] = sarvam_svc.transcribe(
                audio_bytes, filename=filename, mime_type=mime_type,
                mode=sarvam_mode, force_batch=force_batch,
            )

    def _sarvam_translate():
        if sarvam_svc and also_run_translate:
            results["sarvam_translate"] = sarvam_svc.transcribe(
                audio_bytes, filename=filename, mime_type=mime_type,
                mode="translate", force_batch=force_batch,
            )

    def _gemini_transcribe():
        if gemini_svc:
            results["gemini_transcribe"] = gemini_svc.transcribe(
                audio_bytes, mime_type=mime_type, translate_to_english=False,
            )

    def _gemini_translate():
        if gemini_svc and also_run_translate:
            results["gemini_translate"] = gemini_svc.transcribe(
                audio_bytes, mime_type=mime_type, translate_to_english=True,
            )

    threads = [
        threading.Thread(target=_sarvam_transcribe),
        threading.Thread(target=_sarvam_translate),
        threading.Thread(target=_gemini_transcribe),
        threading.Thread(target=_gemini_translate),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)

    return results


# ── Execute & store ───────────────────────────────────────────────────────────

if run and uploaded is not None:
    with st.spinner("Calling Sarvam + Gemini in parallel…"):
        t0 = time.monotonic()
        results = _run_both_parallel(
            audio_bytes=uploaded.getvalue(),
            filename=uploaded.name,
            mime_type=uploaded.type or "audio/wav",
        )
        wallclock_ms = int((time.monotonic() - t0) * 1000)

    st.session_state["last_results"] = results
    st.session_state["last_wallclock_ms"] = wallclock_ms
    st.session_state["last_filename"] = uploaded.name

    # Append to history for the latency chart
    sarvam_r_h = results.get("sarvam_transcribe")
    gemini_r_h = results.get("gemini_transcribe")
    dur_h = (
        (sarvam_r_h.duration_seconds if sarvam_r_h else None)
        or (gemini_r_h.duration_seconds if gemini_r_h else None)
    )
    snapshot = {
        "filename": uploaded.name,
        "duration_s": round(dur_h, 1) if dur_h else None,
        "sarvam_ms": sarvam_r_h.latency_ms if sarvam_r_h else None,
        "sarvam_path": "BATCH" if (sarvam_r_h and sarvam_r_h.used_batch) else "REST",
        "gemini_ms": gemini_r_h.latency_ms if gemini_r_h else None,
        "wallclock_ms": wallclock_ms,
    }
    st.session_state["latency_history"].append(snapshot)

# ── Render results ────────────────────────────────────────────────────────────

results = st.session_state.get("last_results")

if results:
    st.divider()
    st.subheader("3 · Compare transcripts")

    sarvam_r: Optional[STTResult] = results.get("sarvam_transcribe")
    gemini_r: Optional[STTResult] = results.get("gemini_transcribe")
    sarvam_en: Optional[STTResult] = results.get("sarvam_translate")
    gemini_en: Optional[STTResult] = results.get("gemini_translate")

    col_s, col_g = st.columns(2, gap="large")

    # ── Sarvam panel ──────────────────────────────────────────────────────────
    with col_s:
        st.markdown(
            "<div class='provider-card sarvam'>"
            "<h3 style='margin-top:0;'>🟣 Sarvam Saaras v3</h3>",
            unsafe_allow_html=True,
        )
        if sarvam_r is None:
            st.warning("Sarvam not run (service unavailable).")
        elif sarvam_r.error:
            st.markdown(f"<span class='pill pill-err'>FAILED</span>", unsafe_allow_html=True)
            st.error(sarvam_r.error)
        else:
            lat_pill = (
                "pill-fast" if sarvam_r.latency_ms < 5000
                else "pill-slow" if sarvam_r.latency_ms < 15000
                else "pill-err"
            )
            lang_pct = (
                f"{int((sarvam_r.language_probability or 0) * 100)}%"
                if sarvam_r.language_probability is not None else "—"
            )
            path_pill = (
                "<span class='pill pill-slow'>BATCH</span>"
                if sarvam_r.used_batch
                else "<span class='pill pill-fast'>REST</span>"
            )
            st.markdown(
                f"<span class='pill {lat_pill}'>{sarvam_r.latency_ms} ms</span>"
                f"{path_pill}"
                f"<span class='pill pill-info'>lang: {sarvam_r.language_code or '?'} "
                f"({lang_pct})</span>"
                f"<span class='pill pill-info'>mode: {sarvam_mode}</span>",
                unsafe_allow_html=True,
            )
            st.markdown(
                f"<div class='transcript tamil'>{sarvam_r.transcript or '<i>(empty)</i>'}</div>",
                unsafe_allow_html=True,
            )
            if sarvam_en and not sarvam_en.error and sarvam_en.english_translation:
                st.markdown("**English translation**")
                st.markdown(
                    f"<div class='transcript'>{sarvam_en.english_translation}</div>",
                    unsafe_allow_html=True,
                )
                st.caption(f"translate call: {sarvam_en.latency_ms} ms")
        st.markdown("</div>", unsafe_allow_html=True)

    # ── Gemini panel ──────────────────────────────────────────────────────────
    with col_g:
        st.markdown(
            "<div class='provider-card gemini'>"
            "<h3 style='margin-top:0;'>🟢 Gemini 2.5 Flash</h3>",
            unsafe_allow_html=True,
        )
        if gemini_r is None:
            st.warning("Gemini not run (service unavailable).")
        elif gemini_r.error:
            st.markdown(f"<span class='pill pill-err'>FAILED</span>", unsafe_allow_html=True)
            st.error(gemini_r.error)
        else:
            lat_pill = (
                "pill-fast" if gemini_r.latency_ms < 5000
                else "pill-slow" if gemini_r.latency_ms < 15000
                else "pill-err"
            )
            st.markdown(
                f"<span class='pill {lat_pill}'>{gemini_r.latency_ms} ms</span>"
                f"<span class='pill pill-info'>{gemini_r.model}</span>",
                unsafe_allow_html=True,
            )
            st.markdown(
                f"<div class='transcript tamil'>{gemini_r.transcript or '<i>(empty)</i>'}</div>",
                unsafe_allow_html=True,
            )
            if gemini_en and not gemini_en.error and gemini_en.english_translation:
                st.markdown("**English translation**")
                st.markdown(
                    f"<div class='transcript'>{gemini_en.english_translation}</div>",
                    unsafe_allow_html=True,
                )
                st.caption(f"translate call: {gemini_en.latency_ms} ms")
        st.markdown("</div>", unsafe_allow_html=True)

    # ── Quick comparison summary ──────────────────────────────────────────────
    # Audio length first (it's the constant; latency depends on it), then the
    # two providers' transcribe latencies, then the wall-clock total of the
    # parallel batch.
    st.divider()
    s_ms = sarvam_r.latency_ms if (sarvam_r and not sarvam_r.error) else None
    g_ms = gemini_r.latency_ms if (gemini_r and not gemini_r.error) else None
    dur_s = (
        (sarvam_r.duration_seconds if sarvam_r else None)
        or (gemini_r.duration_seconds if gemini_r else None)
    )

    cm_dur, cm_s, cm_g, cm_wc = st.columns(4)
    cm_dur.metric(
        "🎧 Audio length",
        _fmt_duration(dur_s),
        delta=("BATCH path" if (dur_s and dur_s > 28) or force_batch else "REST path"),
        delta_color="off",
    )
    cm_s.metric("Sarvam transcribe", f"{s_ms} ms" if s_ms else "—")
    cm_g.metric("Gemini transcribe", f"{g_ms} ms" if g_ms else "—")
    cm_wc.metric("Total wall-clock", f"{st.session_state.get('last_wallclock_ms', 0)} ms")

    if s_ms and g_ms:
        faster = "Sarvam" if s_ms < g_ms else "Gemini"
        delta = abs(s_ms - g_ms)
        st.caption(f"⚡ **{faster}** was faster by **{delta} ms** for this clip.")

    s_chars = len(sarvam_r.transcript) if sarvam_r and not sarvam_r.error else 0
    g_chars = len(gemini_r.transcript) if gemini_r and not gemini_r.error else 0
    if s_chars and g_chars:
        st.caption(
            f"Sarvam transcript: {s_chars} chars · Gemini transcript: {g_chars} chars · "
            f"length delta: {abs(s_chars - g_chars)} chars "
            f"({abs(s_chars - g_chars) / max(s_chars, g_chars) * 100:.1f}%)"
        )

    # ── Manual scoring ────────────────────────────────────────────────────────
    st.divider()
    st.subheader("4 · Your judgement")
    score_col, note_col = st.columns([1, 2], gap="large")
    with score_col:
        verdict = st.radio(
            "Which transcript is better?",
            options=["— skip —", "Sarvam wins", "Gemini wins", "Tie / similar"],
            horizontal=False,
            key="verdict_radio",
        )
    with note_col:
        note = st.text_area(
            "Notes (dialect, errors, code-mix handling, etc.)",
            height=110,
            key="verdict_note",
        )
    if st.button("💾 Record verdict", type="secondary"):
        if verdict != "— skip —":
            st.session_state["scoring_history"].append({
                "filename": st.session_state.get("last_filename", "?"),
                "verdict": verdict,
                "note": note,
                "sarvam_ms": s_ms,
                "gemini_ms": g_ms,
            })
            st.success(f"Recorded: {verdict}")

    # ── Raw JSON expanders ────────────────────────────────────────────────────
    with st.expander("🔎 Raw responses (for debugging)"):
        if sarvam_r:
            st.markdown("**Sarvam transcribe**")
            st.json(sarvam_r.raw if sarvam_r.raw else {"error": sarvam_r.error})
        if sarvam_en:
            st.markdown("**Sarvam translate**")
            st.json(sarvam_en.raw if sarvam_en.raw else {"error": sarvam_en.error})
        if gemini_r:
            st.markdown("**Gemini transcribe**")
            st.json(gemini_r.raw if gemini_r.raw else {"error": gemini_r.error})
        if gemini_en:
            st.markdown("**Gemini translate**")
            st.json(gemini_en.raw if gemini_en.raw else {"error": gemini_en.error})

# ── Session-level stats: latency history + scoreboard ────────────────────────

if st.session_state["latency_history"]:
    st.divider()
    st.subheader("📊 Session stats")

    hist = st.session_state["latency_history"]
    sarvam_avg = sum(h["sarvam_ms"] for h in hist if h["sarvam_ms"]) / max(
        sum(1 for h in hist if h["sarvam_ms"]), 1
    )
    gemini_avg = sum(h["gemini_ms"] for h in hist if h["gemini_ms"]) / max(
        sum(1 for h in hist if h["gemini_ms"]), 1
    )
    total_audio_s = sum(h["duration_s"] for h in hist if h.get("duration_s")) or 0.0

    # Audio length FIRST, then latencies, then run count — matches the per-run row.
    da, sa, ga, ra = st.columns(4)
    da.metric("🎧 Total audio processed", _fmt_duration(total_audio_s) if total_audio_s else "—")
    sa.metric("Sarvam avg latency", f"{sarvam_avg:.0f} ms")
    ga.metric("Gemini avg latency", f"{gemini_avg:.0f} ms")
    ra.metric("Total runs", len(hist))

    # Tiny inline chart
    try:
        import pandas as pd
        chart_df = pd.DataFrame([
            {"run": i + 1, "Sarvam": h["sarvam_ms"], "Gemini": h["gemini_ms"]}
            for i, h in enumerate(hist)
        ]).set_index("run")
        st.line_chart(chart_df, height=220)
    except ImportError:
        pass  # pandas not installed; skip chart silently

    # Scoreboard
    sh = st.session_state["scoring_history"]
    if sh:
        st.markdown("**Verdict scoreboard**")
        sarvam_wins = sum(1 for s in sh if s["verdict"] == "Sarvam wins")
        gemini_wins = sum(1 for s in sh if s["verdict"] == "Gemini wins")
        ties = sum(1 for s in sh if s["verdict"] == "Tie / similar")
        sw, gw, tw = st.columns(3)
        sw.metric("Sarvam wins", sarvam_wins)
        gw.metric("Gemini wins", gemini_wins)
        tw.metric("Ties", ties)
        with st.expander("All verdicts"):
            st.dataframe(sh, use_container_width=True)
