// Source of truth for the QA test set.
// Edit statuses here as tests run; open dashboard.html to see the current state.
// Statuses: pending | running | pass | fail | blocked | skipped
//
// After editing, run `python3 qa/sync-xlsx.py` to regenerate test-cases.xlsx.

window.META = {
  project: "Manu — VPA Petition Desk",
  environment: "Railway (testing)",
  gitSha: "daa51f8",
  updated: "2026-08-23",
  activeLayer: "P4 — Events (voice + photo)"
};

window.LAYERS = [
  {
    key: "P1",
    label: "Phase 1 — Citizen Intake",
    surface: "Jinja2 citizen pages (form, referral, upload, voice, QR)",
    order: 1,
    active: true
  },
  {
    key: "P2",
    label: "Phase 2 — PA Petition Review",
    surface: "PA portal /ai-review — AWAITING_REVIEW drawer, triage, dedup",
    order: 2,
    active: true
  },
  {
    key: "P3",
    label: "Phase 3 — Tickets / Association Review",
    surface: "PA portal /tickets + /association-review — post-approval lifecycle",
    order: 3,
    active: true
  },
  {
    key: "P4",
    label: "Phase 4 — Events (voice + photo)",
    surface: "Events UI — invitation calendar, voice + photo extraction, EventPopup",
    order: 4,
    active: true
  },
  { key: "P5", label: "Phase 5 — Executive / Dept / Minister",  order: 5, active: false },
  { key: "P6", label: "Phase 6 — Cross-cutting sanity",         order: 6, active: false }
];

// -------------------------------------------------------------------------
// Phase 1 & Phase 2 — ALL VERIFIED on Railway
// -------------------------------------------------------------------------
// 113 total · 111 pass · 2 skipped (CI-23 rate limit, CI-71 one-per-day
// guard — both intentionally off in the test env). Dedup group (CI-59..64)
// verified on the same-doc/two-phone scenario; CI-61's reported "appt gone"
// bug stays fixed. Phase 2 pill-count parity fixes landed as 21de97f
// (ai-review) and 3f0df68 (tickets).
window.TEST_CASES = [
  // ============================================================
  // A. Referral form — happy paths (5)
  // ============================================================
  { id: "CI-01", layer: "P1", category: "Referral form — happy",
    name: "Submit English referral on desktop",
    steps: "1. Open /referral (desktop viewport)\n2. Fill name (English), 10-digit mobile, complaint\n3. Submit",
    expected: "200 OK + reference token shown; row visible in crowd table",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-02", layer: "P1", category: "Referral form — happy",
    name: "Submit Tamil referral on desktop",
    steps: "1. Open /referral, toggle Tamil\n2. Fill Tamil name + mobile + Tamil complaint\n3. Submit",
    expected: "200 OK + Tamil reference token; Tamil chars preserved end-to-end (no mojibake, no ???)",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-03", layer: "P1", category: "Referral form — happy",
    name: "Submit English referral on mobile viewport",
    steps: "1. Resize to 375x812\n2. Fill valid form\n3. Submit",
    expected: "Layout intact, form usable with thumbs, submit succeeds",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-04", layer: "P1", category: "Referral form — happy",
    name: "Submit Tamil referral on mobile viewport",
    steps: "1. 375x812 + Tamil toggle\n2. Fill Tamil form\n3. Submit",
    expected: "Tamil font renders on mobile, form submits, ref token in Tamil",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-05", layer: "P1", category: "Referral form — happy",
    name: "Language toggle mid-form preserves data",
    steps: "1. Fill 50% of form in English\n2. Toggle to Tamil\n3. Verify inputs still there",
    expected: "Values persist; labels swap; no reset",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // B. Field validation — mobile (5)
  // ============================================================
  { id: "CI-06", layer: "P1", category: "Validation — mobile",
    name: "Letters/symbols in mobile field rejected",
    steps: "1. Type 'abcdefghij', '####', '9876@1234'\n2. Attempt submit each",
    expected: "Inline error 'valid 10-digit mobile'; submit blocked",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-07", layer: "P1", category: "Validation — mobile",
    name: "Short mobile (<10 digits) rejected",
    steps: "1. Type '98765'\n2. Attempt submit",
    expected: "Inline error; submit blocked",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-08", layer: "P1", category: "Validation — mobile",
    name: "Long mobile (>10 digits) rejected",
    steps: "1. Type '98765432109'\n2. Attempt submit",
    expected: "Inline error OR silent truncation with warning; submit blocked",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-09", layer: "P1", category: "Validation — mobile",
    name: "Mobile with country-code prefix ('+91 98765...')",
    steps: "1. Type '+919876543210'\n2. Submit",
    expected: "Either strip prefix silently and accept, OR clean error asking for 10 digits",
    status: "pass", actual: "Verified on Railway",
    notes: "Design decision — must not silently save '+91' inside stored mobile" },

  { id: "CI-10", layer: "P1", category: "Validation — mobile",
    name: "Mobile with spaces / dashes / brackets",
    steps: "1. Type '98765 43210', '98765-43210', '(987)654-3210'\n2. Submit",
    expected: "Either normalize and accept, OR clean error",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // C. Field validation — name (4)
  // ============================================================
  { id: "CI-11", layer: "P1", category: "Validation — name",
    name: "Empty name rejected",
    steps: "1. Leave name blank\n2. Submit",
    expected: "Inline required-field error",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-12", layer: "P1", category: "Validation — name",
    name: "Whitespace-only name rejected",
    steps: "1. Type '     '\n2. Submit",
    expected: "Rejected (trimmed to empty); not saved as blank row",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-13", layer: "P1", category: "Validation — name",
    name: "Very long name (300 chars) handled",
    steps: "1. Paste 300-char name\n2. Submit valid form",
    expected: "Either accepted (truncated w/ warning) or clean length error; no 500",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-14", layer: "P1", category: "Validation — name",
    name: "Name with emoji / mixed script / RTL / control chars",
    steps: "1. Try 'ராம் 🙏', 'راماكشوان', 'Ram\\n\\rKumar'\n2. Submit each",
    expected: "Emoji/Unicode preserved OR stripped consistently; no crash; no chars break downstream drawer",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // D. Field validation — complaint (4)
  // ============================================================
  { id: "CI-15", layer: "P1", category: "Validation — complaint",
    name: "Empty complaint rejected",
    steps: "1. Fill name+mobile, leave complaint blank\n2. Submit",
    expected: "Inline required-field error",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-16", layer: "P1", category: "Validation — complaint",
    name: "10,000-char complaint",
    steps: "1. Paste 10000 chars into complaint\n2. Submit",
    expected: "Accepted (truncated w/ warning) OR clean length error; no 500; DB row not corrupted",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-17", layer: "P1", category: "Validation — complaint",
    name: "HTML / <script> injection in complaint body",
    steps: "1. Paste '<script>alert(1)</script><img src=x onerror=alert(2)>'\n2. Submit\n3. View in PA portal drawer",
    expected: "Rendered as escaped text everywhere — no dialog, no console error, no HTML executed",
    status: "pass", actual: "Verified on Railway", notes: "XSS regression" },

  { id: "CI-18", layer: "P1", category: "Validation — complaint",
    name: "Complaint = only newlines / control chars",
    steps: "1. Type '\\n\\n\\n\\r\\r'\n2. Submit",
    expected: "Rejected as empty (after trim)",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // E. Referral form — session / behavior / security (5)
  // ============================================================
  { id: "CI-19", layer: "P1", category: "Referral form — behavior",
    name: "Mobile field REQUIRED on mobile viewport (CITZ-03)",
    steps: "1. 375x812\n2. Try to submit without mobile\n3. Try with valid mobile",
    expected: "Blocked with inline error; passes when filled",
    status: "pass", actual: "Verified on Railway", notes: "CITZ-03 Critical fix" },

  { id: "CI-20", layer: "P1", category: "Referral form — behavior",
    name: "CSRF token — form has one; spoofed request rejected",
    steps: "1. Inspect form for CSRF hidden input\n2. Replay POST via curl without token\n3. Replay with wrong token",
    expected: "Legit form works; spoof/replay → 403",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-21", layer: "P1", category: "Referral form — behavior",
    name: "Session expiry mid-form → clean re-init",
    steps: "1. Open form\n2. Wait for session to expire (or manually clear cookie)\n3. Submit",
    expected: "Redirect to fresh session / polite message; no 500",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-22", layer: "P1", category: "Referral form — behavior",
    name: "Browser back after submit → no duplicate row",
    steps: "1. Submit valid form\n2. Press browser back\n3. Press submit again",
    expected: "Either idempotent (same ref) or clean 'already submitted' guard; no duplicate crowd row",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-23", layer: "P1", category: "Referral form — behavior",
    name: "Rapid double-submit rate-limited (CITZ-03)",
    steps: "1. Submit valid form\n2. Immediately submit again",
    expected: "Second call HTTP 429 or clean UI block; no duplicate row",
    status: "skipped", actual: "N/A in this test window",
    notes: "Skipped — RATE_LIMIT_ENABLED=false globally by user decision" },

  // ============================================================
  // F. Upload — file types ACCEPTED (6)
  // ============================================================
  { id: "CI-24", layer: "P1", category: "Upload — file types",
    name: "PDF single-page → extraction runs",
    steps: "1. Upload clean 1-page PDF\n2. Wait for extraction",
    expected: "Ticket in AWAITING_REVIEW, source doc viewable",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-25", layer: "P1", category: "Upload — file types",
    name: "PDF multi-page (5+) → extraction runs",
    steps: "1. Upload 5-page petition PDF\n2. Wait",
    expected: "Extraction handles multi-page (concat or first-page best-effort); ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-26", layer: "P1", category: "Upload — file types",
    name: "Small JPEG (<500KB) → OCR runs",
    steps: "1. Upload small photo of petition\n2. Wait",
    expected: "OCR extracts fields; ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-27", layer: "P1", category: "Upload — file types",
    name: "Large JPEG with EXIF rotation",
    steps: "1. Take portrait photo on phone (EXIF orientation flag set)\n2. Upload",
    expected: "Server auto-rotates before OCR; extraction reads text upright",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-28", layer: "P1", category: "Upload — file types",
    name: "PNG upload accepted",
    steps: "1. Upload a PNG screenshot of petition text\n2. Wait",
    expected: "Same extraction flow; ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-29", layer: "P1", category: "Upload — file types",
    name: "HEIC (iPhone) upload",
    steps: "1. Take iPhone photo saved as .heic\n2. Upload from iOS Safari",
    expected: "Either server transcodes and extracts, OR clean 'please convert to JPEG' error",
    status: "pass", actual: "Verified on Railway",
    notes: "iOS default format — must not silently fail" },

  // ============================================================
  // G. Upload — file types REJECTED (4)
  // ============================================================
  { id: "CI-30", layer: "P1", category: "Upload — rejected types",
    name: "Password-protected PDF → clean reject",
    steps: "1. Encrypt a PDF with a password\n2. Upload",
    expected: "Clean 'cannot read encrypted PDF' UI message; no traceback",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-31", layer: "P1", category: "Upload — rejected types",
    name: "Corrupted PDF (truncated bytes) → clean reject",
    steps: "1. Truncate a PDF at 512 bytes\n2. Upload",
    expected: "Clean 'file damaged' UI message; no server 500; no partial ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-32", layer: "P1", category: "Upload — rejected types",
    name: "Dangerous MIME types (docx, exe, svg, zip)",
    steps: "1. Try uploading .docx, .exe, .zip, .svg one by one",
    expected: "All rejected client-side AND server-side; no bypass by renaming .exe to .pdf",
    status: "pass", actual: "Verified on Railway",
    notes: "SVG can carry JS — must be rejected" },

  { id: "CI-33", layer: "P1", category: "Upload — rejected types",
    name: "0-byte file",
    steps: "1. `touch empty.pdf`\n2. Upload it",
    expected: "Clean 'file is empty' error; no crash",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // H. Upload — file sizes (3)
  // ============================================================
  { id: "CI-34", layer: "P1", category: "Upload — sizes",
    name: "5MB normal PDF processes cleanly",
    steps: "1. Upload a 5MB PDF\n2. Wait",
    expected: "Extraction completes within ~15s; ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-35", layer: "P1", category: "Upload — sizes",
    name: "20MB large PDF — processes or clean size error",
    steps: "1. Upload 20MB PDF\n2. Watch UI",
    expected: "Either succeeds within reasonable time OR clean 'file too large' message; no 500; no timeout",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-36", layer: "P1", category: "Upload — sizes",
    name: "100MB huge file → immediate rejection",
    steps: "1. Try to upload 100MB video/PDF\n2. Watch",
    expected: "Rejected client-side before upload starts OR server rejects with clean 413; no hang",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // I. Upload — filename edges (5)
  // ============================================================
  { id: "CI-37", layer: "P1", category: "Upload — filename",
    name: "<script>alert(1)</script>.pdf renders as text (CITZ-02)",
    steps: "1. Rename any PDF to that name\n2. Upload\n3. Watch filename chip in UI\n4. Also check PA portal drawer",
    expected: "Filename escaped everywhere; no alert dialog; no console XSS error",
    status: "pass", actual: "Verified on Railway", notes: "CITZ-02 Critical XSS fix" },

  { id: "CI-38", layer: "P1", category: "Upload — filename",
    name: "Path traversal in filename (`../../etc/passwd`)",
    steps: "1. Rename to `../../etc/passwd.pdf`\n2. Upload\n3. Check server storage path",
    expected: "Stored under safe randomized/sanitized name; no directory traversal; no server file overwritten",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-39", layer: "P1", category: "Upload — filename",
    name: "Unicode Tamil filename preserved end-to-end",
    steps: "1. Rename to 'மனு.pdf'\n2. Upload\n3. Check filename display in citizen UI + PA drawer + doc download",
    expected: "Filename renders correctly in all three surfaces; download preserves Tamil",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-40", layer: "P1", category: "Upload — filename",
    name: "500-char filename handled",
    steps: "1. Rename to 500 chars + '.pdf'\n2. Upload",
    expected: "Truncated cleanly OR clean error; no DB constraint violation",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-41", layer: "P1", category: "Upload — filename",
    name: "Filename with quotes / backslash / percent",
    steps: "1. Try `pet\"'()%20file.pdf`\n2. Upload",
    expected: "Stored/displayed safely; no shell/SQL injection artifacts; URLs escape correctly",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // J. AI extraction — happy path (4)
  // ============================================================
  { id: "CI-42", layer: "P1", category: "AI extraction — happy",
    name: "English printed PDF → all fields extracted",
    steps: "1. Upload clean English petition PDF\n2. Open ticket in PA portal",
    expected: "Name, mobile, address, complaint populated; source doc viewable; confidence displayed",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-43", layer: "P1", category: "AI extraction — happy",
    name: "Tamil printed PDF → all fields, no mojibake",
    steps: "1. Upload clean Tamil petition PDF\n2. Open ticket in portal",
    expected: "Tamil name/complaint preserved (not ??? or garbled); font renders in drawer",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-44", layer: "P1", category: "AI extraction — happy",
    name: "JPEG petition → OCR extraction runs",
    steps: "1. Upload photo of petition\n2. Wait\n3. Check portal",
    expected: "OCR extracts (may be lower confidence); ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-45", layer: "P1", category: "AI extraction — happy",
    name: "Rotated image (90/180/270) auto-oriented",
    steps: "1. Upload a photo rotated 90 degrees\n2. Check extraction result",
    expected: "Text extracted correctly (server auto-rotates before OCR)",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // K. AI extraction — edge cases (7)
  // ============================================================
  { id: "CI-46", layer: "P1", category: "AI extraction — edges",
    name: "Blurry image → polished user error",
    steps: "1. Upload a completely blurry/motion-blur photo\n2. Watch UI",
    expected: "Polished 'could not read' message; NOT Python traceback, NOT 'codec error', NOT 'gemini-2.5-flash failed on all models'",
    status: "pass", actual: "Verified on Railway",
    notes: "Verifies businessMessage() TECHNICAL regex" },

  { id: "CI-47", layer: "P1", category: "AI extraction — edges",
    name: "Random selfie / landscape (not a doc) → polished error",
    steps: "1. Upload a scenic photo with no text\n2. Watch UI",
    expected: "Polite 'no petition detected in image' style message; no traceback",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-48", layer: "P1", category: "AI extraction — edges",
    name: "Blank white page / paper → empty extraction",
    steps: "1. Upload a blank PDF or blank photo\n2. Watch UI",
    expected: "Empty result surfaced cleanly; either 'no text detected' or ticket in special empty state; no crash",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-49", layer: "P1", category: "AI extraction — edges",
    name: "Handwritten petition — best-effort or clean fallback",
    steps: "1. Upload photo of a handwritten petition\n2. Check portal",
    expected: "Either partial extraction with low confidence flag, OR clean 'handwriting not supported'; no silent success with garbage",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-50", layer: "P1", category: "AI extraction — edges",
    name: "Two petitions in one page/photo",
    steps: "1. Upload a photo containing 2 distinct petitions\n2. Check extraction",
    expected: "Either one extracted (dominant), OR user prompted to choose, OR two tickets created — behavior consistent and documented",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-51", layer: "P1", category: "AI extraction — edges",
    name: "Vertex fallback — primary fails, Vertex picks up",
    steps: "1. Temporarily break Gemini API key OR force upload during API outage\n2. Watch logs for Vertex retry",
    expected: "Log line 'Vertex AI backend ready ... creds=env-content' present at boot; on primary failure request routes through Vertex; ticket still created",
    status: "pass", actual: "Verified on Railway — 'Vertex AI backend ready (project=namkural location=asia-south1 creds=env-content)' in appointment 430 log",
    notes: "Verifies petition_extraction.py Vertex overload (commit 6fda89b)" },

  { id: "CI-52", layer: "P1", category: "AI extraction — edges",
    name: "Both models fail → polished error, no traceback",
    steps: "1. Force both Gemini + Vertex to fail (bad keys, network offline)\n2. Upload valid PDF",
    expected: "Polite 'extraction unavailable, please try again' message in UI; server logs the technical detail; no user-visible traceback",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // L. Voice upload (6)
  // ============================================================
  { id: "CI-53", layer: "P1", category: "Voice upload",
    name: "Tamil voice → 200 OK, no 500 (ASCII fix)",
    steps: "1. Record 20s Tamil complaint\n2. Upload via voice flow",
    expected: "200 OK, extraction runs, no UnicodeEncodeError from httpx headers",
    status: "pass", actual: "Verified on Railway",
    notes: "Verifies event_service.py _ascii_safe fix" },

  { id: "CI-54", layer: "P1", category: "Voice upload",
    name: "Voice + Tamil text in note field → no header crash",
    steps: "1. Same as CI-53\n2. Add Tamil text into the note before upload",
    expected: "200 OK; note stored on ticket; Tamil preserved",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-55", layer: "P1", category: "Voice upload",
    name: "English voice → extraction runs",
    steps: "1. Record 20s English complaint\n2. Upload",
    expected: "Extraction returns English fields; ticket created",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-56", layer: "P1", category: "Voice upload",
    name: "Very short (1s) audio → clean short-input handling",
    steps: "1. Record 1s clip\n2. Upload",
    expected: "Either extracts short phrase OR clean 'too short' message; no crash",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-57", layer: "P1", category: "Voice upload",
    name: "Silence-only audio → empty extraction",
    steps: "1. Record 10s of silence\n2. Upload",
    expected: "Extraction returns empty; clean 'no speech detected' UI; no crash",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-58", layer: "P1", category: "Voice upload",
    name: "Corrupted audio file → clean rejection",
    steps: "1. Truncate an m4a to 200 bytes\n2. Upload",
    expected: "Clean 'audio file damaged' error; no 500; no partial ticket",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // M. Dedup & signatory (6) — INTENTIONALLY LEFT PENDING
  // ============================================================
  { id: "CI-59", layer: "P1", category: "Dedup & signatory",
    name: "Same doc, two different phones → both AWAITING_REVIEW",
    steps: "1. Phone A uploads doc.pdf, books appointment\n2. Phone B uploads same doc.pdf, books appointment",
    expected: "Two independent tickets, both AWAITING_REVIEW; both appointments visible",
    status: "pass", actual: "Verified on Railway",
    notes: "Setup for CI-60/61. Awaiting focused end-to-end pass — reported-bug regression." },

  { id: "CI-60", layer: "P1", category: "Dedup & signatory",
    name: "Convert first (CI-59 ticket A) → appointment preserved",
    steps: "1. Portal → Petition Review → open A\n2. Convert to petition",
    expected: "Petition row created; A's appointment still linked; ticket advances",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-61", layer: "P1", category: "Dedup & signatory",
    name: "Convert second (CI-59 ticket B) — dedup preserves BOTH appointments (REPORTED BUG)",
    steps: "1. Open B (same doc as A, different phone)\n2. Convert to petition",
    expected: "Either merges into A's signatory list WITH B's appointment PRESERVED, OR creates B as separate petition. B's appointment must not vanish.",
    status: "pass", actual: "Verified on Railway",
    notes: "USER-REPORTED BUG: 'appointment gone and not found in the petition too'. Focus of the dedup pass." },

  { id: "CI-62", layer: "P1", category: "Dedup & signatory",
    name: "Same phone, DIFFERENT name → deduped by mobile (blind index)",
    steps: "1. Phone 9876543210 submits as 'Ram'\n2. Same phone submits as 'Ramesh'",
    expected: "Second recognized as same citizen (mobile blind index match); either updates name or flags conflict; no duplicate citizen row",
    status: "pass", actual: "Verified on Railway",
    notes: "Verifies Fernet encryption + SHA-256 blind index" },

  { id: "CI-63", layer: "P1", category: "Dedup & signatory",
    name: "Same phone, case/whitespace variation in name",
    steps: "1. Submit as 'Ram Kumar'\n2. Submit as '  RAM KUMAR  '",
    expected: "Recognized as same citizen; name normalization consistent",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-64", layer: "P1", category: "Dedup & signatory",
    name: "Concurrent submissions of same doc (race)",
    steps: "1. Open two browser windows\n2. Upload same doc.pdf in both, submit within 1 second",
    expected: "Both persisted OR one wins with clean dedup; no orphan rows, no partial state, no double-commit",
    status: "pass", actual: "Verified on Railway",
    notes: "Verifies CORR-06 signatory merge FOR UPDATE row-lock" },

  // ============================================================
  // N. Appointment booking (5)
  // ============================================================
  { id: "CI-65", layer: "P1", category: "Appointment",
    name: "View available slots for a department",
    steps: "1. Complete upload\n2. Reach appointment step\n3. Select department",
    expected: "Slot grid loads (uses /api/venues cache); shows next-N days; unavailable slots grayed",
    status: "pass", actual: "Verified on Railway",
    notes: "Verifies PERF-18 Cache-Control on /api/venues" },

  { id: "CI-66", layer: "P1", category: "Appointment",
    name: "Book a slot → confirmation shown",
    steps: "1. Pick a slot\n2. Confirm booking",
    expected: "Confirmation page with time, department, QR/ref; appointment row in DB",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-67", layer: "P1", category: "Appointment",
    name: "No slots available → clean message",
    steps: "1. Pick a fully-booked department/day\n2. View slots",
    expected: "Empty-state 'no slots today, try tomorrow' message; not a blank grid",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-68", layer: "P1", category: "Appointment",
    name: "Concurrent booking of same slot (race)",
    steps: "1. Two browsers, both click same slot at same time",
    expected: "One wins, other gets clean 'slot just taken' error; no double-booking in DB",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-69", layer: "P1", category: "Appointment",
    name: "Book slot → convert-to-petition later → appointment survives",
    steps: "1. Book slot\n2. Convert ticket to petition in portal\n3. Check appointment still present on new petition",
    expected: "Appointment linked to petition; visible in citizen's confirmation and on portal drawer",
    status: "pass", actual: "Verified on Railway", notes: "Related to CI-61 bug" },

  // ============================================================
  // O. Guards (2)
  // ============================================================
  { id: "CI-70", layer: "P1", category: "Guards",
    name: "One-per-day OFF → second submit allowed (testing mode)",
    steps: "1. Confirm ONE_PETITION_PER_DAY=false on Railway\n2. Same phone submits twice in same day",
    expected: "Both accepted; both tickets in queue",
    status: "pass", actual: "Verified on Railway — guard off in current test window", notes: "" },

  { id: "CI-71", layer: "P1", category: "Guards",
    name: "One-per-day ON → second submit blocked (SKIPPED)",
    steps: "1. Would flip ONE_PETITION_PER_DAY=true\n2. Same phone submits twice",
    expected: "Second blocked with clean 'retry-tomorrow' copy",
    status: "skipped", actual: "N/A in this test window",
    notes: "Skipped — ONE_PETITION_PER_DAY=false by user decision. Retest when guard re-enabled." },

  // ============================================================
  // P. Session / QR / auth (5)
  // ============================================================
  { id: "CI-72", layer: "P1", category: "Session / QR",
    name: "QR link → no session token in URL (CITZ-01)",
    steps: "1. Generate QR link from portal\n2. Open in fresh incognito\n3. Inspect URL bar, referrer header, browser history",
    expected: "Token lives in HttpOnly cookie ONLY; never visible in URL / referrer / history",
    status: "pass", actual: "Verified on Railway", notes: "CITZ-01 Critical" },

  { id: "CI-73", layer: "P1", category: "Session / QR",
    name: "Direct hit to /citizen/upload without QR session → clean redirect",
    steps: "1. Wipe cookies\n2. Navigate directly to /citizen/upload",
    expected: "Redirect to landing OR 'session expired' page; not a 500, not a blank page, not a stack trace",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-74", layer: "P1", category: "Session / QR",
    name: "Tampered session cookie → clean rejection",
    steps: "1. Get a valid session cookie\n2. Change one char in devtools\n3. Reload",
    expected: "401 or clean redirect; polite message; no server 500",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-75", layer: "P1", category: "Session / QR",
    name: "Session expiry mid-upload → clean recovery",
    steps: "1. Start upload\n2. Manually expire session between file-select and submit\n3. Submit",
    expected: "Clean 'session expired, please re-scan QR' UI; upload not silently dropped",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-76", layer: "P1", category: "Session / QR",
    name: "Multiple browser tabs sharing session",
    steps: "1. Open citizen flow in tab A and tab B (same session cookie)\n2. Submit form in A\n3. Try to submit in B",
    expected: "Behavior consistent — either last-write-wins with cross-tab awareness, OR guarded and B is told 'already submitted'; no silent duplicate row",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // Q. Cross-cutting UX (6)
  // ============================================================
  { id: "CI-77", layer: "P1", category: "Cross-cutting UX",
    name: "All error toasts polished across citizen flow",
    steps: "1. Force errors: bad file type, huge file, expired session, network offline, bad OCR\n2. Screenshot every error toast",
    expected: "Zero tracebacks, zero 'gemini-2.5-flash', zero 'codec can't encode', zero HTTP status codes; only user-friendly text",
    status: "pass", actual: "Verified on Railway",
    notes: "Regression net for TECHNICAL regex + businessMessage()" },

  { id: "CI-78", layer: "P1", category: "Cross-cutting UX",
    name: "Loading state during long AI extraction (>5s)",
    steps: "1. Upload a 10-page PDF that takes >5s to extract\n2. Watch UI",
    expected: "Spinner + progress copy visible whole time; no frozen screen; no spurious 'failed'",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-79", layer: "P1", category: "Cross-cutting UX",
    name: "Empty state on landing when no history",
    steps: "1. Fresh browser, first visit to citizen home\n2. Observe landing",
    expected: "Welcome/onboarding copy; no 'undefined' or broken layout",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-80", layer: "P1", category: "Cross-cutting UX",
    name: "iOS Safari safe-area / notch handling",
    steps: "1. Open in iOS Safari on iPhone with notch (or simulator)\n2. Check top bar and bottom action button",
    expected: "Content not hidden under notch or home indicator; scroll works",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-81", layer: "P1", category: "Cross-cutting UX",
    name: "Tamil font (Noto Serif Tamil) loads on all citizen pages",
    steps: "1. Visit /referral, /citizen/upload, appointment, confirmation in Tamil mode\n2. Inspect font-family used",
    expected: "Tamil text uses Noto Serif Tamil (not system fallback); no invisible boxes",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "CI-82", layer: "P1", category: "Cross-cutting UX",
    name: "Print / share confirmation preview",
    steps: "1. On confirmation screen, use browser print preview and share sheet",
    expected: "Print-friendly layout; share (mobile) sheet includes reference token / QR",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // R. Summariser resilience — production incident regression
  // ============================================================
  { id: "CI-83", layer: "P1", category: "Summariser resilience",
    name: "Tamil citizen_name → background summarisation completes (SDK ASCII bug)",
    steps: "1. Submit an appointment where citizen name field contains Tamil (e.g. 'ராம் குமார்')\n2. Wait 10s for the background summariser\n3. Tail Railway logs OR open the appointment's GrievanceSummaryRecord in the portal",
    expected: "Log shows 'Summarisation complete in Nms | backend=vertex | ...' — NOT '[GEMINI WARN] appointment_id=X: ... ascii codec can't encode characters'. GrievanceSummaryRecord row exists.",
    status: "pass", actual: "Verified on Railway",
    notes: "Regression for prod appointment 426. Fixed via _sanitize_user_field ascii-strip; UnicodeEncodeError short-circuit in factory._try_backend." },

  { id: "CI-84", layer: "P1", category: "Summariser resilience",
    name: "Persist path survives Vertex-refactor: _model_name compat shim",
    steps: "1. Submit any appointment (Tamil or English name)\n2. Wait 10s for background summarisation\n3. Check log for '[GEMINI WARN] ... has no attribute _model_name'\n4. Verify GrievanceSummaryRecord row exists with gemini_model_used populated",
    expected: "NO 'has no attribute _model_name' error in log; DB row exists with gemini_model_used = primary model name (e.g. 'gemini-2.5-flash')",
    status: "pass", actual: "Verified on Railway",
    notes: "Regression for prod appointment 430 after ca5d82a Vertex-first refactor. Fixed by _model_name @property on GrievanceSummarisationService + PetitionExtractionService returning self._bundle.primary_model." },

  { id: "CI-85", layer: "P1", category: "Referral form — behavior",
    name: "Invalid mobile → red inline hint under mobile field (not just top banner)",
    steps: "1. Open /referral in Tamil mode\n2. Fill valid name + shared-by + 5-word reason + slot\n3. Type '971022517' (9 digits) in mobile\n4. Try to submit",
    expected: "Hint 'Enter a valid 10-digit mobile...' under the mobile field turns RED, submit is blocked, mobile field is focused. NO generic 'பதிவு தோல்வி' banner without explanation.",
    status: "pass", actual: "Verified on Railway",
    notes: "USER-REPORTED. Fixed by adding _mobileOk() + mobileHint div + client-side submit guard." },

  { id: "CI-86", layer: "P1", category: "Referral form — behavior",
    name: "Slot chips never leak remaining capacity ('N மீதம்' / 'N left')",
    steps: "1. Open /referral, pick a date with partially-booked slots\n2. Inspect each open slot chip",
    expected: "Available slots show ONLY the time range (no 'N மீதம்' / 'N left' text). Past slots still say 'முடிந்தது' / 'Passed', full slots say 'நிரம்பியது' / 'Full'.",
    status: "pass", actual: "Verified on Railway",
    notes: "USER-REQUESTED: don't reveal office capacity to citizens." },

  { id: "CI-87", layer: "P1", category: "Referral form — behavior",
    name: "Backend validation errors surface the SPECIFIC reason (not generic 'Booking failed')",
    steps: "1. /referral in Tamil mode\n2. Paste ~5000 chars into 'சந்திப்பின் காரணம்' (server max is 500)\n3. Fill other fields validly, pick slot, submit",
    expected: "Banner shows 'காரணம் அதிகபட்சம் 500 எழுத்துகள் மட்டுமே அனுமதிக்கப்படும்.' (or English equivalent), reasonHint turns red. NOT a bare 'பதிவு தோல்வி' with no explanation. Live counter under reason shows '5000 / 500' in red before submit.",
    status: "pass", actual: "Verified on Railway",
    notes: "USER-REPORTED: FastAPI validation returns {detail: [...]} but frontend read {error: ...}. Fixed via _humanErrorFromResponse mapper + maxlength on all text fields + reasonCount live counter." },

  { id: "CI-88", layer: "P1", category: "Upload / AI",
    name: "QR intake form — backend errors show specific reason (form.jinja2 parity)",
    steps: "1. Complete QR intake up to submit step\n2. Trigger any backend validation failure (huge description, blank required, etc.)\n3. Observe error surface",
    expected: "showOtpFieldError shows a specific localized message (e.g. 'Field can be at most N characters.'). NOT '[object Object]' and NOT a bare 'Submission failed.'",
    status: "pass", actual: "Verified on Railway",
    notes: "form.jinja2 had the same bug — `error.detail || copy.submitError` treated an array as a string. Fixed with same detail[0] type-based mapper as referral form." },

  { id: "CI-89", layer: "P1", category: "Upload / AI",
    name: "Citizen document iframe preview renders (not 'blocked:other')",
    steps: "1. Portal → Tickets → open a ticket with a PDF upload (e.g. TKN2026082300006)\n2. Inspect the drawer's document preview + DevTools Network tab",
    expected: "PDF renders inside the drawer's <iframe>. Network row for /dashboard/api/files/... shows 200 (not 'blocked:other'). Response headers on the file: X-Frame-Options: SAMEORIGIN, Content-Security-Policy contains 'frame-ancestors ...'.",
    status: "pass", actual: "PASS on Railway after cache-disabled reload — user confirmed 'now working'.",
    notes: "USER-REPORTED. Fixed by scoping the middleware's XFO DENY + frame-ancestors 'none' to skip /dashboard|events|minister|department/api/files/*." },

  { id: "CI-90", layer: "P1", category: "Cross-cutting UX",
    name: "QR success page auto-downloads receipt PNG on load",
    steps: "1. Complete a QR-scan submission end-to-end (any citizen, any language)\n2. Land on /form/success?token=...\n3. Wait ~1s and check the browser's /Downloads folder",
    expected: "File 'grievance-TKN<token>.png' auto-saves. Filename contains ONLY the token (NEVER the citizen's name). The Download button in the top-right of the card still works for manual re-save.",
    status: "pass", actual: "Verified on Railway",
    notes: "USER-REQUESTED (option 3 of the CITZ-13 revisit): auto-download but with token-only filename so shared/kiosk devices don't leak identity." },

  { id: "CI-91", layer: "P1", category: "Cross-cutting UX",
    name: "Referral success page auto-downloads receipt PNG + shows Download button",
    steps: "1. Complete a valid /referral submission\n2. Wait for the success box to appear\n3. Watch /Downloads (auto) and try the visible 'Download receipt' button",
    expected: "File 'referral-REF<token>.png' auto-saves. Manual Download button in the success box also produces the same PNG. Both filenames token-only (no cleartext citizen name in the filename).",
    status: "pass", actual: "Verified on Railway",
    notes: "USER-REQUESTED: parity with QR success." },

  // -------------------------------------------------------------------------
  // Phase 2 — PA Petition Review  (portal /ai-review)
  // -------------------------------------------------------------------------
  // One case per meaningful signal, no per-variant micro-cases. Regressions
  // from Phase 1 (iframe preview, filename XSS, dedup appointment loss,
  // FOR UPDATE lock) are pulled forward as focused checks. Route:
  // /ai-review (legacy URL — the portal code labels it "Petition Review").

  { id: "PR-01", layer: "P2", category: "Access",
    name: "RBAC — pa_admin loads, dept_officer redirects",
    steps: "1. Log in as pa_admin (admin-office) → /ai-review\n2. Log in as dept_officer → /ai-review",
    expected: "pa_admin sees the list. dept_officer redirected to /tickets (per _no_dept_officer gate).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-02", layer: "P2", category: "Access",
    name: "Unauth / tampered session → clean login redirect",
    steps: "1. Wipe or corrupt dash_session cookie\n2. Load /ai-review",
    expected: "302 to /auth/login; no traceback; no data leaked",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-03", layer: "P2", category: "List",
    name: "Default list = AWAITING_REVIEW only",
    steps: "1. Seed rows in SCHEDULED / AWAITING_REVIEW / REVIEWED\n2. Load /ai-review",
    expected: "Only AWAITING_REVIEW rows appear. Empty-state is friendly when count is zero.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-04", layer: "P2", category: "List",
    name: "Filter + search + sort work",
    steps: "1. Apply category filter → verify\n2. Search by name / mobile last-4 / token → verify\n3. Switch to urgency sort → verify order (CRITICAL > HIGH > MED > LOW)",
    expected: "Each control narrows the list correctly. Newest-first default has an id tie-break (PERF-08). Clear-all restores.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-05", layer: "P2", category: "List",
    name: "Pagination + counts match /counts endpoint",
    steps: "1. Seed >25 rows\n2. Load page 1, then page 2\n3. Compare visible total to GET /dashboard/api/appointments/counts",
    expected: "Page 2 shows next 25 (no dupes). Counts match exactly (no IST/UTC drift). Fresh submission appears after the polling interval.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-06", layer: "P2", category: "Drawer",
    name: "Drawer opens on click + deep-link",
    steps: "1. Click a row → verify drawer + URL update\n2. Open /ai-review?ticket=<id> in a fresh tab\n3. Close via X + Esc",
    expected: "Both entry points open the drawer with the right row. X and Esc close it. Browser back closes it too.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-07", layer: "P2", category: "Drawer",
    name: "Overview panel — name, masked mobile, badges",
    steps: "1. Open drawer\n2. Scan the OVERVIEW panel",
    expected: "Name / masked mobile (******3210) / constituency / district present. Category + priority (colour-coded) + ministry pills reflect GSR.",
    status: "pass", actual: "Verified on Railway", notes: "Mobile mask regression" },

  { id: "PR-08", layer: "P2", category: "Drawer",
    name: "Bilingual summary + key details render (no mojibake)",
    steps: "1. Open a drawer with Tamil summary_ta + key_details_ta populated\n2. Toggle language",
    expected: "Tamil renders in Noto Serif Tamil, English in Inter. No ???. Bullets render as bullets.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-09", layer: "P2", category: "Drawer",
    name: "PDF iframe + audio playback work",
    steps: "1. Open a drawer with a PDF upload → verify iframe renders (not blocked:other)\n2. Open one with an audio upload → play + seek",
    expected: "PDF iframe: XFO SAMEORIGIN + frame-ancestors 'self' honoured (CI-89 regression). Audio: Range requests supported, seek works, duration finite on WebM/Opus.",
    status: "pass", actual: "Verified on Railway", notes: "CI-89 iframe fix regression, PERF-audio Range" },

  { id: "PR-10", layer: "P2", category: "Triage",
    name: "Approve → Ticket created, status flips REVIEWED",
    steps: "1. Open a drawer\n2. Click Approve\n3. Verify tickets table + appointment row",
    expected: "New Ticket with correct ticket_number (TKN<year><ord>), status=OPEN, appointment_id linked. Appt.status → REVIEWED. Row leaves the AWAITING_REVIEW list.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-11", layer: "P2", category: "Triage",
    name: "Approve triggers SMS + activity log",
    steps: "1. Approve a drawer\n2. Tail Railway logs\n3. Open the resulting ticket's activity",
    expected: "spawn_bg(_notify) log line present. Activity row: action_type='created', user='pa_admin', payload has {token, appointment_id}.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-12", layer: "P2", category: "Triage",
    name: "Approve is idempotent (double-click safe)",
    steps: "1. Rapidly click Approve twice\n2. Check tickets table",
    expected: "One ticket only. Button disabled during in-flight submit. No 500.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-13", layer: "P2", category: "Triage",
    name: "Dismiss + Restore round-trip",
    steps: "1. Dismiss with reason 'duplicate submission'\n2. Verify row leaves default list\n3. Open DISMISSED filter → Restore\n4. Row returns to AWAITING_REVIEW",
    expected: "Status transitions cleanly both ways. Activity log records dismiss (with reason) + restore.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-14", layer: "P2", category: "Edits",
    name: "Edit citizen name / category / priority / ministry persists",
    steps: "1. Change each field via the edit pencil; save; refresh drawer\n2. Verify filters reflect the change immediately (category / ministry / priority)",
    expected: "PATCH /details persists. Name update rehashes the blind-index. AI-inferred values overridden on save. No silent 500 on two-tab conflict — either overwrites cleanly or shows a 'refresh' message.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-15", layer: "P2", category: "Attachments",
    name: "PA adds attachment + caps honoured",
    steps: "1. Add a small PDF from the drawer → CITIZEN UPLOADS count +1\n2. Try 6MB file → expect reject\n3. At 10 attachments → try one more → expect reject",
    expected: "Uploads succeed and preview inline. 5MB size cap + 10-file total cap enforced with a clean human message.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-16", layer: "P2", category: "Attachments",
    name: "Filename XSS still safe from the drawer path (CITZ-02 regression)",
    steps: "1. Upload a PDF renamed to '<script>alert(1)</script>.pdf' via the PA drawer\n2. Inspect the chip + file preview title",
    expected: "Filename escaped everywhere. No alert dialog. No console error.",
    status: "pass", actual: "Verified on Railway", notes: "CITZ-02 regression via drawer surface" },

  { id: "PR-17", layer: "P2", category: "Signatory dedup",
    name: "/similar returns candidates, Approve-with-signatories merges",
    steps: "1. Open drawer → GET /api/appointments/{id}/similar\n2. Approve-with-signatories → target an existing ticket",
    expected: "Similar list is category+district-blocked and similarity-scored. Merge attaches current appt as signatory of target; no new Ticket row.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-18", layer: "P2", category: "Signatory dedup",
    name: "Merge preserves BOTH appointments (CI-61 regression)",
    steps: "1. Reproduce CI-61 setup: same doc, two phones, both AWAITING_REVIEW\n2. Approve the first, then Approve-with-signatories the second into the first's ticket\n3. Verify both appointments still linked",
    expected: "Neither appointment disappears. The reported bug 'appointment gone after convert' stays fixed via the merge path too.",
    status: "pass", actual: "Verified on Railway", notes: "PRIMARY dedup regression check" },

  { id: "PR-19", layer: "P2", category: "Signatory dedup",
    name: "Concurrent merge — FOR UPDATE lock prevents dup",
    steps: "1. Two browsers open the same drawer\n2. Both click Approve-with-signatories on the same target within 1s",
    expected: "One wins. The other gets a clean 'already merged' message. No duplicate signatory row. No partial state.",
    status: "pass", actual: "Verified on Railway", notes: "CORR-06 FOR UPDATE lock" },

  { id: "PR-20", layer: "P2", category: "Comments",
    name: "Comment adds (English + Tamil)",
    steps: "1. POST /comment with an English string → reload activity\n2. Post a Tamil comment 'மீண்டும் அழைக்கவும்' → reload",
    expected: "Both persist. Both render correctly in the activity feed (no ???, no codec err — the comment path is DB-only, not Gemini).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-21", layer: "P2", category: "UX",
    name: "Error toasts polished across the review surface",
    steps: "1. Trigger 4 failures: 5MB+ attachment, network offline mid-approve, backend 500, invalid edit\n2. Screenshot each toast",
    expected: "Every message is user-friendly. Zero tracebacks / 'gemini-2.5-flash' / raw HTTP codes. Routed through businessMessage() (errors.ts).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "PR-22", layer: "P2", category: "UX",
    name: "Mobile viewport (375px) — drawer usable",
    steps: "1. Resize to 375x812\n2. Open a drawer; try Approve + Edit + Add attachment",
    expected: "Drawer scales / becomes a full-screen sheet. All actions reachable. No horizontal body scroll.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // -------------------------------------------------------------------------
  // Phase 3 — Tickets + Association Review  (post-approval lifecycle)
  // -------------------------------------------------------------------------
  // TK-* covers /tickets (approved petitions in their working state).
  // AR-* covers /association-review (parallel review flow for association
  // submissions, mints tickets via mint_ticket_from_association).
  // T3-* covers cross-cutting UX shared by both surfaces.

  // ============================================================
  // Tickets — /tickets
  // ============================================================
  { id: "TK-01", layer: "P3", category: "Tickets — Access",
    name: "RBAC — pa_admin sees all, dept_officer sees only their dept",
    steps: "1. Log in as pa_admin → /tickets\n2. Log in as dept_officer → /tickets",
    expected: "pa_admin: full ticket list across every dept. dept_officer: only tickets routed to their department; other rows never surface.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "TK-02", layer: "P3", category: "Tickets — List",
    name: "Status tabs partition correctly (Open / Assigned / Forwarded / Resolved / Closed)",
    steps: "1. Click each status tab in turn\n2. Verify row set + counts",
    expected: "Each tab shows only its status. Rows never appear on the wrong tab. Terminal tabs (Resolved/Closed) don't show OPEN or FORWARDED rows.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "TK-03", layer: "P3", category: "Tickets — List",
    name: "Filter + search + sort — pill counts follow the current filter (3f0df68 regression)",
    steps: "1. Apply priority=high → verify Open pill narrows with list\n2. Search by ticket number / citizen name → verify\n3. Sort by created / due-date / priority → verify order",
    expected: "Pill counts = visible list count for the same tab (no stable-universe mismatch). SLA-breached chip also narrows with the filter (already WYSIWYG per 0cde4ed).",
    status: "pass", actual: "Verified on Railway",
    notes: "Regression for 3f0df68 pill-count parity (aligns tickets with appointments + ai-review)" },

  { id: "TK-04", layer: "P3", category: "Tickets — Drawer",
    name: "Drawer overview: badges + source-specific detail block",
    steps: "1. Open a citizen-petition ticket → verify priority/dept/status badges + AI summary\n2. Open an association-minted ticket → verify AssociationDetail block appears (rep name, ministry, docs)",
    expected: "Citizen tickets show petition summary + key details. Association tickets additionally show source_kind='association' detail card (a4bacc9).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "TK-05", layer: "P3", category: "Tickets — Triage",
    name: "Assign requires only dept (no due-date coupling) — 2d1ee54 regression",
    steps: "1. Open an OPEN ticket with no due-date set\n2. Pick a dept, DON'T touch due-date\n3. Click Assign",
    expected: "Assign button enables as soon as a dept is picked. Save routes to dept + logs 'routed'. Previous bug: button stayed disabled without a due-date.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "TK-06", layer: "P3", category: "Tickets — Triage",
    name: "Due-date + priority live-save on non-OPEN tickets (decc4f4 regression)",
    steps: "1. Open an association-auto-forwarded ticket (status=FORWARDED_TO_DEPT)\n2. Change priority\n3. Pick a due-date",
    expected: "Both fields save immediately (canEditSla path). Prior bug: everything was disabled because canEdit gated on status===open.",
    status: "pass", actual: "Verified on Railway",
    notes: "Also implicitly verifies AR-06 auto-forward chain" },

  { id: "TK-07", layer: "P3", category: "Tickets — Lifecycle",
    name: "Dept accept → assign locks; Resolve → Reopen round-trip",
    steps: "1. As dept_officer, accept a forwarded ticket → accepted_at set\n2. Verify PA drawer shows accepted chip, assign dropdown gone\n3. Dept resolves → status=RESOLVED\n4. PA reopens → status=REOPENED",
    expected: "accepted_at persists. Status transitions cleanly both ways. Activity log records accept / resolve / reopen with actor + payload.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "TK-08", layer: "P3", category: "Tickets — Attachments",
    name: "Attachment upload from drawer + filename XSS safe",
    steps: "1. Upload a small PDF via ticket drawer → count +1\n2. Upload '<script>alert(1)</script>.pdf' → escaped in chip + preview title",
    expected: "Upload succeeds. Filename rendered as text everywhere. 5MB cap honoured.",
    status: "pass", actual: "Verified on Railway", notes: "CITZ-02 regression on ticket surface" },

  { id: "TK-09", layer: "P3", category: "Tickets — Attachments",
    name: "Dept can view ai_uploads/ PDFs for their tickets (cbc9c8c regression)",
    steps: "1. Log in as dept_officer, open a ticket derived from an AI upload\n2. Click the citizen's original PDF\n3. Verify iframe renders",
    expected: "PDF renders inline (200 OK). Cross-dept access still 403. Prior bug: /department/api/files/ai_uploads/… → 403 for legitimate access.",
    status: "pass", actual: "Verified on Railway",
    notes: "Regression for cbc9c8c (ai_uploads/ branch in _dept_authorize_file) + f40c2f6 (HTTPException import — 500→403 for legit denies)" },

  { id: "TK-10", layer: "P3", category: "Tickets — Comments",
    name: "PA + dept can comment; Tamil supported",
    steps: "1. PA adds English comment → visible in activity\n2. Dept adds Tamil comment 'மீண்டும் அழைக்கவும்' → renders correctly",
    expected: "Both comments persist with author + timestamp. Tamil no ??? no codec err.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "TK-11", layer: "P3", category: "Tickets — Drawer",
    name: "Drawer prev/next navigation (5c3bc5b regression)",
    steps: "1. Open a ticket drawer\n2. Use prev/next arrows (or keyboard)",
    expected: "Drawer swaps to sibling row without full-page reload. URL updates. Selection state moves.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // Association Review — /association-review
  // ============================================================
  { id: "AR-01", layer: "P3", category: "Assoc Review — Access",
    name: "RBAC — pa_admin only",
    steps: "1. Log in as pa_admin → /association-review\n2. Log in as dept_officer → /association-review",
    expected: "pa_admin loads normally. dept_officer redirected or 403 (dept has no association-review UI).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "AR-02", layer: "P3", category: "Assoc Review — List",
    name: "Default list + status filter partition",
    steps: "1. Load /association-review (default = AWAITING_REVIEW)\n2. Switch tabs — Awaiting / Approved / Rejected",
    expected: "Each tab shows only its status. Empty-state is friendly. Counts match visible rows.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "AR-03", layer: "P3", category: "Assoc Review — Drawer",
    name: "Drawer content — rep, ministry, extraction, uploaded documents",
    steps: "1. Open a submission with 2+ documents\n2. Scan the drawer",
    expected: "Representative name + phone + org, chosen ministry, AssociationExtraction summary + key details, document previews render inline (iframe).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "AR-04", layer: "P3", category: "Assoc Review — Triage",
    name: "Ministry-driven decision — override + approve",
    steps: "1. Open a submission where AI ministry = 'other'\n2. Override to a real ministry via inline edit\n3. Approve → verify Ticket minted",
    expected: "Ministry edit persists on the row. Approve calls mint_ticket_from_association → Appointment + Ticket + GSR created. Redirect / drawer transitions to 'submitted' state.",
    status: "pass", actual: "Verified on Railway",
    notes: "Regression for 40a6f55 ministry-driven decision refactor" },

  { id: "AR-05", layer: "P3", category: "Assoc Review — Triage",
    name: "Non-school ministry → auto-forward chain (feeds TK-06)",
    steps: "1. Approve an association with ministry=health_medical_education\n2. Open the resulting Ticket in /tickets",
    expected: "Ticket exists with status=FORWARDED_TO_DEPT (auto-forwarded via forward_if_non_school). Dept officer can accept from their workspace. SLA fields still editable (see TK-06).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "AR-06", layer: "P3", category: "Assoc Review — Triage",
    name: "School ministry → stays OPEN for PA to assign",
    steps: "1. Approve an association with ministry=school_education_tamil_dev_info_publicity\n2. Open the resulting Ticket",
    expected: "Ticket exists with status=OPEN. Assign panel visible so PA can route to one of the 10 school departments. Contrast with AR-05.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "AR-07", layer: "P3", category: "Assoc Review — Dismiss",
    name: "Reject with reason + restore",
    steps: "1. Reject a submission with reason 'incomplete documentation'\n2. Verify status=REJECTED\n3. Restore back to AWAITING_REVIEW",
    expected: "Reason preserved on the row. Restore reverses cleanly. Activity log records both actions.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // ============================================================
  // Cross-cutting (both surfaces)
  // ============================================================
  { id: "T3-01", layer: "P3", category: "UX",
    name: "Polished error toasts across tickets + association review",
    steps: "1. Trigger 4 failures: 5MB+ attachment, network offline mid-approve, backend 500, invalid edit\n2. Screenshot each toast on both surfaces",
    expected: "Every message user-friendly. Zero tracebacks / raw HTTP codes / 'gemini-2.5-flash'. Routed through businessMessage() (errors.ts).",
    status: "pass", actual: "Verified on Railway", notes: "" },

  { id: "T3-02", layer: "P3", category: "UX",
    name: "Mobile viewport (375px) — both drawers usable",
    steps: "1. Resize to 375x812\n2. Open ticket drawer → try Assign / Comment / Add attachment\n3. Open association drawer → try Approve / Ministry override",
    expected: "Both drawers scale / go full-screen. All actions reachable with thumbs. No horizontal body scroll.",
    status: "pass", actual: "Verified on Railway", notes: "" },

  // -------------------------------------------------------------------------
  // Phase 4 — Events (voice + photo)
  // -------------------------------------------------------------------------
  // Covers the invitation-calendar surface: events_session auth, manual +
  // voice + photo add flows, EventPopup detail, list/filter/edit, and the
  // cross-cutting error polish that came out of the summariser incidents.
  // EV-* main flow, T4-* cross-cutting.

  { id: "EV-01", layer: "P4", category: "Events — Access",
    name: "Events login works with seeded events_reviewer credentials",
    steps: "1. Log in to /dashboard/login as admin-office (seeds event_reviewer role)\n2. Then log in to /events/login with the same credentials",
    expected: "Both logins succeed. events_session cookie set. No 401 / no 'unauthorized' with legitimate creds.",
    status: "pending", actual: "",
    notes: "Verifies events_auth.py real-user path (env-credential path was removed — see prior incident)" },

  { id: "EV-02", layer: "P4", category: "Events — Access",
    name: "Direct URL without events_session → clean redirect",
    steps: "1. Wipe events_session cookie\n2. Navigate to /events directly",
    expected: "Redirect to /events/login. No 500 / no blank page.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-03", layer: "P4", category: "Events — Add",
    name: "Manual event add (title / venue / date / note) → appears in list",
    steps: "1. Open events UI, click Add Event\n2. Fill title, venue, date, optional note\n3. Save",
    expected: "New row in list. All fields populated. No AI extraction path fired for manual entry.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-04", layer: "P4", category: "Events — Voice",
    name: "Tamil voice add → 200 OK, extraction runs (SDK ASCII fix regression)",
    steps: "1. Record a 20s Tamil voice describing an event\n2. Upload via voice add flow",
    expected: "200 OK. Extraction populates title_en / title_ta / venue / date. NO UnicodeEncodeError. NO 500 from the google-genai httpx header path.",
    status: "pending", actual: "",
    notes: "Regression for event_service.py _ascii_safe fix (voice-note ASCII scrub before Gemini call)" },

  { id: "EV-05", layer: "P4", category: "Events — Voice",
    name: "Tamil voice + Tamil note field → 200 OK",
    steps: "1. Same as EV-04\n2. Type Tamil text into the note field before upload",
    expected: "200 OK. Note preserved on the event row. No header-encoding crash.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-06", layer: "P4", category: "Events — Voice",
    name: "English voice add → extraction runs",
    steps: "1. Record 20s English voice describing an event\n2. Upload",
    expected: "Extraction returns English title / venue. Row created.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-07", layer: "P4", category: "Events — Photo",
    name: "Photo add — invitation card image → OCR extraction",
    steps: "1. Upload a photo of an invitation card\n2. Wait for extraction",
    expected: "title / venue / date extracted; row appears in list with source doc viewable inline.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-08", layer: "P4", category: "Events — Photo",
    name: "Blurry / non-invitation image → polished error (businessMessage)",
    steps: "1. Upload a random selfie / blurry image\n2. Watch EventPopup / error toast",
    expected: "User-friendly message ('could not read'). NO Python traceback. NO 'gemini-2.5-flash' / 'codec' strings.",
    status: "pending", actual: "",
    notes: "Regression for TECHNICAL regex + businessMessage() in EventPopup" },

  { id: "EV-09", layer: "P4", category: "Events — List",
    name: "Default list shows upcoming events",
    steps: "1. Load /events\n2. Verify default view",
    expected: "Upcoming events (date >= today) sorted by date ascending. Past events hidden or in a separate section.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-10", layer: "P4", category: "Events — List",
    name: "Date range filter + search by title/venue",
    steps: "1. Apply a date range → verify rows narrow\n2. Search by partial title / venue name",
    expected: "Both narrow the visible set correctly. Clear-all restores.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-11", layer: "P4", category: "Events — Detail",
    name: "EventPopup opens on row click with bilingual content",
    steps: "1. Click a Tamil-added event (has title_ta populated)\n2. Toggle language",
    expected: "Popup shows title / venue / note in the selected language via title_ta / venue_ta fields. No mojibake.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-12", layer: "P4", category: "Events — Detail",
    name: "Error field renders polished text (businessMessage regression)",
    steps: "1. Force an event to be in the error_message state (upload a bad file OR find a historically-failed event)\n2. Open EventPopup",
    expected: "error_message rendered via businessMessage() — user-friendly text, not raw 'UnicodeEncodeError: ascii codec can't encode...' or 'gemini-2.5-flash failed on all models'.",
    status: "pending", actual: "",
    notes: "Regression for 5bbbc1c EventPopup businessMessage() wiring + TECHNICAL regex" },

  { id: "EV-13", layer: "P4", category: "Events — Edit",
    name: "Edit event fields → persists",
    steps: "1. Open an existing event\n2. Edit title / venue / date\n3. Save; reload",
    expected: "Changes persist across reload. Activity log or last-updated stamp reflects the edit.",
    status: "pending", actual: "", notes: "" },

  { id: "EV-14", layer: "P4", category: "Events — Edit",
    name: "Delete event → gone from list",
    steps: "1. Delete an event (with confirmation)\n2. Verify list",
    expected: "Row removed. No orphan attachments left in storage (soft delete OK if that's the design).",
    status: "pending", actual: "", notes: "" },

  { id: "EV-15", layer: "P4", category: "Events — Edit",
    name: "Concurrent edit (two tabs) — clean last-write-wins",
    steps: "1. Open same event in two tabs\n2. Edit + save in tab A\n3. Edit + save in tab B without refresh",
    expected: "Second save overwrites cleanly OR clean 'this event was updated elsewhere' message. No silent 500 / no lost data.",
    status: "pending", actual: "", notes: "" },

  { id: "T4-01", layer: "P4", category: "UX",
    name: "All error toasts polished across the events surface",
    steps: "1. Trigger failures: 5MB+ audio, 5MB+ image, network offline mid-upload, backend 500, invalid extract\n2. Screenshot each toast",
    expected: "Every message user-friendly. Zero tracebacks / raw HTTP codes / 'gemini-*' / 'codec'. Routed through the businessMessage() polish path.",
    status: "pending", actual: "", notes: "" },

  { id: "T4-02", layer: "P4", category: "UX",
    name: "Mobile viewport (375px) — record voice + view event usable",
    steps: "1. Resize to 375x812\n2. Try the voice-add recorder\n3. Open EventPopup",
    expected: "Recorder buttons reachable. Popup scales / goes full-screen. No horizontal body scroll.",
    status: "pending", actual: "", notes: "" }
];
