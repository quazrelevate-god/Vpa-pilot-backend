"""
Grievance Summariser — Streamlit Tester
═══════════════════════════════════════

A small standalone UI for exercising the grievance summarisation module.
Lets you submit (text + optional image) → see the structured GrievanceSummary
returned by Gemini → visually validate it against simple rules.

Run with:
    cd backend
    venv/Scripts/streamlit run streamlit_app.py

Image input is the *priority* path: a photograph of a broken pipe, a copy of
a pension order, or a scan of an FIR carries information that text alone
often misses. The summary should reflect what's in the image via the
`attachment_notes` field.
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import streamlit as st
from PIL import Image

# Make the project importable when launched from any cwd.
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.models.grievance_summary import (  # noqa: E402
    CitizenSentiment,
    GrievanceCategory,
    GrievanceSummary,
    UrgencyLevel,
)
from src.services.summarisation import GrievanceSummarisationService  # noqa: E402

# ── Page setup ────────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Grievance Summariser — Tester",
    page_icon="📜",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Subtle styling — keeps the page looking like a tester, not a toy.
st.markdown(
    """
    <style>
      .block-container { padding-top: 1.6rem; padding-bottom: 3rem; max-width: 1200px; }
      h1, h2, h3 { letter-spacing: -0.01em; }
      .stMetric { background: #f8fafc; border: 1px solid #e2e8f0;
                  border-radius: 10px; padding: 12px 14px; }
      .small { color: #64748b; font-size: 0.85rem; }
      .pill { display: inline-block; padding: 3px 10px; border-radius: 999px;
              font-size: 0.78rem; font-weight: 600; }
      .pill-ok   { color: #047857; background: #e7f6ef; }
      .pill-warn { color: #b45309; background: #fef6e7; }
      .pill-err  { color: #be123c; background: #fdeaee; }
      .stTextArea textarea { font-family: inherit; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Sidebar: identity + status ────────────────────────────────────────────────

with st.sidebar:
    st.markdown("### 🏛️ PA Office Tester")
    st.caption("Standalone harness for the Gemini summarisation module.")

    st.divider()
    st.markdown("**Citizen identity**")
    citizen_name = st.text_input("Full name", value="Saroja Devi")
    constituency = st.text_input("Constituency / ward", value="Madurai South")

    st.divider()
    st.markdown("**Model**")
    # Service is cached so we don't recreate the client per submit.
    try:
        svc = st.session_state.get("svc") or GrievanceSummarisationService.from_settings()
        st.session_state["svc"] = svc
        st.success(
            f"Connected · `{svc._model_name}` "
            f"(fallback: `{svc._fallback_model}`)",
            icon="✅",
        )
    except Exception as exc:
        st.error(f"Could not initialise service:\n\n{exc}")
        st.stop()

    st.caption(
        "API key loads from `backend/.env` → `GEMINI_API_KEY`. "
        "Override in `src/core/config.py` if needed."
    )

# ── Header ────────────────────────────────────────────────────────────────────

st.title("📜 Grievance Summariser — Live Tester")
st.markdown(
    "<span class='small'>Submit a citizen petition — text and/or photograph "
    "— and inspect what the Gemini-backed summariser produces. The image path "
    "is the priority: a single photo of a broken pipe or a pension order is "
    "often worth more than a paragraph of text.</span>",
    unsafe_allow_html=True,
)

# ── Two-column input form ─────────────────────────────────────────────────────

left, right = st.columns([1.05, 1], gap="large")

with left:
    st.subheader("Grievance text")
    grievance_text = st.text_area(
        label="What is the citizen reporting?",
        height=260,
        value=(
            "Sir, my old-age pension of ₹1,200 per month has not come since "
            "February. I went to the village office three times. I have to "
            "borrow from neighbours to buy blood pressure medicine. Please "
            "help me get my pension restarted. Pension ID OAP/MDU/2019/4421."
        ),
        help=(
            "Type or paste the citizen's grievance verbatim. The model is "
            "instructed not to paraphrase facts, so the raw words matter."
        ),
    )
    st.caption(f"{len(grievance_text)} characters")

with right:
    st.subheader("Attachment (priority)")
    uploaded = st.file_uploader(
        label="Upload a photograph, scan, or PDF of supporting evidence",
        type=["png", "jpg", "jpeg", "webp", "pdf"],
        help=(
            "Most petitions come with a photo (broken road, FIR copy, pension "
            "order, hospital bill). The summariser will examine the image and "
            "reflect what it sees in the `attachment_notes` field."
        ),
    )

    attachment_bytes = None
    attachment_mime = None
    attachment_name = None
    if uploaded is not None:
        attachment_bytes = uploaded.getvalue()
        attachment_mime = uploaded.type or "application/octet-stream"
        attachment_name = uploaded.name

        size_kb = len(attachment_bytes) / 1024
        st.caption(f"`{attachment_name}` · `{attachment_mime}` · {size_kb:,.1f} KB")

        # Preview when it's an image
        if attachment_mime.startswith("image/"):
            try:
                img = Image.open(io.BytesIO(attachment_bytes))
                st.image(img, caption="Preview", use_container_width=True)
            except Exception as exc:
                st.warning(f"Could not preview image: {exc}")
        else:
            st.info("PDF preview not rendered; file will still be sent to Gemini.")
    else:
        st.markdown(
            "<div style='padding:42px 16px; text-align:center; "
            "border:2px dashed #e2e8f0; border-radius:12px; color:#94a3b8;'>"
            "<div style='font-size:36px;'>🖼️</div>"
            "<div style='margin-top:6px;'>No attachment yet — image input is recommended.</div>"
            "</div>",
            unsafe_allow_html=True,
        )

# ── Submit ────────────────────────────────────────────────────────────────────

st.divider()
col_run, col_clear, _ = st.columns([1.5, 1, 4])
with col_run:
    run = st.button(
        "✨ Summarise grievance",
        type="primary",
        use_container_width=True,
        disabled=not grievance_text.strip(),
    )
with col_clear:
    if st.button("Reset result", use_container_width=True):
        st.session_state.pop("last_summary", None)
        st.session_state.pop("last_elapsed", None)
        st.session_state.pop("last_inputs", None)

if run:
    with st.spinner("Calling Gemini…"):
        t0 = time.monotonic()
        try:
            summary = svc.summarise(
                citizen_name=citizen_name.strip() or "Unknown",
                constituency=constituency.strip() or "Unknown",
                grievance_text=grievance_text,
                attachment_bytes=attachment_bytes,
                attachment_mime=attachment_mime,
                attachment_filename=attachment_name,
            )
            elapsed = time.monotonic() - t0
            st.session_state["last_summary"] = summary
            st.session_state["last_elapsed"] = elapsed
            st.session_state["last_inputs"] = {
                "had_text": bool(grievance_text.strip()),
                "had_image": attachment_mime is not None
                and attachment_mime.startswith("image/"),
                "had_pdf": attachment_mime == "application/pdf",
            }
        except Exception as exc:
            st.session_state.pop("last_summary", None)
            st.error(f"Summarisation failed:\n\n{exc}")

# ── Result rendering ──────────────────────────────────────────────────────────

summary: GrievanceSummary | None = st.session_state.get("last_summary")

if summary is not None:
    elapsed = st.session_state.get("last_elapsed", 0.0)
    inputs = st.session_state.get("last_inputs", {})

    st.divider()
    st.markdown("## 📋 Structured summary")

    # Top-line metrics (language-neutral enums)
    m1, m2, m3, m4 = st.columns(4)
    urgency_emoji = {
        UrgencyLevel.LOW: "🟢",
        UrgencyLevel.MEDIUM: "🟡",
        UrgencyLevel.HIGH: "🟠",
        UrgencyLevel.CRITICAL: "🔴",
    }[summary.urgency]
    sentiment_emoji = {
        CitizenSentiment.DISTRESSED: "😟",
        CitizenSentiment.FRUSTRATED: "😤",
        CitizenSentiment.NEUTRAL: "😐",
        CitizenSentiment.HOPEFUL: "🙂",
    }[summary.sentiment]
    m1.metric("Urgency", f"{urgency_emoji} {summary.urgency.value.upper()}")
    m2.metric("Category", summary.category.value.replace("_", " ").title())
    m3.metric("Sentiment", f"{sentiment_emoji} {summary.sentiment.value.title()}")
    m4.metric("Round-trip", f"{elapsed:.2f}s")

    st.markdown("")

    # Bilingual tabs
    tab_en, tab_ta = st.tabs(["🇬🇧 English", "🇮🇳 தமிழ் (Tamil)"])

    with tab_en:
        st.markdown(f"### {summary.headline}")
        st.markdown(
            f"<span class='small'>**Citizen's ask:** {summary.citizen_ask}</span>",
            unsafe_allow_html=True,
        )
        st.markdown("#### Summary")
        st.write(summary.summary)

        cdet_en, catt_en = st.columns([1.15, 1], gap="large")
        with cdet_en:
            st.markdown("#### Key details")
            for d in summary.key_details:
                st.markdown(f"- {d}")
            if summary.urgency_reason:
                st.markdown("#### Why this urgency")
                st.info(summary.urgency_reason)
        with catt_en:
            st.markdown("#### Attachment notes")
            if summary.attachment_notes:
                st.success(summary.attachment_notes)
            else:
                st.markdown(
                    "<span class='small'>No attachment notes.</span>",
                    unsafe_allow_html=True,
                )

    with tab_ta:
        st.markdown(f"### {summary.headline_ta}")
        st.markdown(
            f"<span class='small'>**குடிமகனின் கோரிக்கை:** {summary.citizen_ask_ta}</span>",
            unsafe_allow_html=True,
        )
        st.markdown("#### சுருக்கம்")
        st.write(summary.summary_ta)

        cdet_ta, catt_ta = st.columns([1.15, 1], gap="large")
        with cdet_ta:
            st.markdown("#### முக்கிய விவரங்கள்")
            for d in summary.key_details_ta:
                st.markdown(f"- {d}")
            if summary.urgency_reason_ta:
                st.markdown("#### இது ஏன் அவசரம்?")
                st.info(summary.urgency_reason_ta)
        with catt_ta:
            st.markdown("#### இணைப்பு குறிப்புகள்")
            if summary.attachment_notes_ta:
                st.success(summary.attachment_notes_ta)
            else:
                st.markdown(
                    "<span class='small'>இணைப்பு குறிப்புகள் இல்லை.</span>",
                    unsafe_allow_html=True,
                )

    # ── Validation panel ──────────────────────────────────────────────────────
    st.divider()
    st.markdown("## 🔎 Validation")

    checks: list[tuple[str, bool, str]] = []

    # 1. key_details must be non-empty (English)
    checks.append((
        "key_details non-empty (English)",
        len(summary.key_details) >= 1,
        f"{len(summary.key_details)} detail(s)",
    ))

    # 2. key_details_ta must be non-empty (Tamil)
    checks.append((
        "key_details_ta non-empty (Tamil)",
        len(summary.key_details_ta) >= 1,
        f"{len(summary.key_details_ta)} detail(s)",
    ))

    # 3. headline_ta must be in Tamil script (contains Tamil Unicode)
    has_tamil = any("஀" <= c <= "௿" for c in summary.headline_ta)
    checks.append((
        "headline_ta contains Tamil script",
        has_tamil,
        summary.headline_ta[:60] + ("…" if len(summary.headline_ta) > 60 else ""),
    ))

    # 4. urgency_reason required for HIGH/CRITICAL (both languages)
    high_levels = (UrgencyLevel.HIGH, UrgencyLevel.CRITICAL)
    if summary.urgency in high_levels:
        checks.append((
            "urgency_reason given (English)",
            bool(summary.urgency_reason and summary.urgency_reason.strip()),
            summary.urgency_reason or "missing!",
        ))
        checks.append((
            "urgency_reason_ta given (Tamil)",
            bool(summary.urgency_reason_ta and summary.urgency_reason_ta.strip()),
            (summary.urgency_reason_ta or "missing!")[:80],
        ))
    else:
        checks.append(("urgency_reason optional (urgency is LOW/MEDIUM)", True, "n/a"))

    # 5. citizen_ask must be specific (not just "help" / "support")
    vague = {"help", "support", "kindly help", "please help"}
    ask_text = (summary.citizen_ask or "").strip().lower()
    checks.append((
        "citizen_ask is specific (English)",
        bool(ask_text) and ask_text not in vague and len(ask_text) > 15,
        summary.citizen_ask or "missing",
    ))

    # 6. citizen_ask_ta must be present and non-trivial
    ask_ta = (summary.citizen_ask_ta or "").strip()
    checks.append((
        "citizen_ask_ta present (Tamil)",
        bool(ask_ta) and len(ask_ta) > 5,
        ask_ta[:80] if ask_ta else "missing",
    ))

    # 7. headline ≤ 150 chars, single line
    checks.append((
        "headline ≤ 150 chars, single line",
        len(summary.headline) <= 150 and "\n" not in summary.headline,
        f"{len(summary.headline)} chars",
    ))

    # 8. If an image was uploaded, attachment_notes should be present
    if inputs.get("had_image"):
        checks.append((
            "attachment_notes populated (image, English)",
            bool(summary.attachment_notes and summary.attachment_notes.strip()),
            summary.attachment_notes or "missing — model ignored the image?",
        ))
        checks.append((
            "attachment_notes_ta populated (image, Tamil)",
            bool(summary.attachment_notes_ta and summary.attachment_notes_ta.strip()),
            (summary.attachment_notes_ta or "missing — model ignored the image?")[:80],
        ))
    elif inputs.get("had_pdf"):
        checks.append((
            "attachment_notes populated (PDF, English)",
            bool(summary.attachment_notes and summary.attachment_notes.strip()),
            summary.attachment_notes or "missing — model ignored the PDF?",
        ))

    # Render the validation rows
    for label, ok, detail in checks:
        pill = "pill-ok" if ok else "pill-err"
        status = "PASS" if ok else "FAIL"
        st.markdown(
            f"<div style='display:flex; justify-content:space-between; "
            f"align-items:center; padding:8px 12px; border-bottom:1px solid #f1f5f9;'>"
            f"<span><b>{label}</b> "
            f"<span class='small'>· {detail}</span></span>"
            f"<span class='pill {pill}'>{status}</span></div>",
            unsafe_allow_html=True,
        )

    passed = sum(1 for _, ok, _ in checks if ok)
    total = len(checks)
    st.markdown(
        f"<div style='margin-top:14px; text-align:right;'>"
        f"<b>{passed} / {total} checks passed</b></div>",
        unsafe_allow_html=True,
    )

    # ── Raw JSON for inspection ───────────────────────────────────────────────
    with st.expander("View raw JSON (for inspection / copying)"):
        st.json(summary.model_dump(mode="json"))

else:
    st.divider()
    st.info(
        "Fill in the grievance text (and optionally upload a photo), then click "
        "**Summarise grievance** to see the structured output and validation."
    )
