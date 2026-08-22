// Source of truth for the QA test set.
// Edit statuses here as tests run; open dashboard.html to see the current state.
// Statuses: pending | running | pass | fail | blocked | skipped
//
// After editing, run `python3 qa/sync-xlsx.py` to regenerate test-cases.xlsx.

window.META = {
  project: "Manu — VPA Petition Desk",
  environment: "Railway (testing)",
  gitSha: "f742c13",
  updated: "2026-08-23",
  activeLayer: "P2 — PA Petition Review"
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
  { key: "P3", label: "Phase 3 — Tickets / Association Review", order: 3, active: false },
  { key: "P4", label: "Phase 4 — Events (voice + photo)",       order: 4, active: false },
  { key: "P5", label: "Phase 5 — Executive / Dept / Minister",  order: 5, active: false },
  { key: "P6", label: "Phase 6 — Cross-cutting sanity",         order: 6, active: false }
];

// -------------------------------------------------------------------------
// Phase 1 — Citizen Intake  (VERIFIED — all pass except dedup group)
// -------------------------------------------------------------------------
// User confirmed on Railway: "everything is verified except dedup".
// Dedup group (CI-59..CI-64) stays pending — needs the specific
// same-doc/two-phone scenario played end-to-end to validate the
// reported bug fix and the FOR UPDATE lock.
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
    status: "pending", actual: "",
    notes: "Setup for CI-60/61. Awaiting focused end-to-end pass — reported-bug regression." },

  { id: "CI-60", layer: "P1", category: "Dedup & signatory",
    name: "Convert first (CI-59 ticket A) → appointment preserved",
    steps: "1. Portal → Petition Review → open A\n2. Convert to petition",
    expected: "Petition row created; A's appointment still linked; ticket advances",
    status: "pending", actual: "", notes: "" },

  { id: "CI-61", layer: "P1", category: "Dedup & signatory",
    name: "Convert second (CI-59 ticket B) — dedup preserves BOTH appointments (REPORTED BUG)",
    steps: "1. Open B (same doc as A, different phone)\n2. Convert to petition",
    expected: "Either merges into A's signatory list WITH B's appointment PRESERVED, OR creates B as separate petition. B's appointment must not vanish.",
    status: "pending", actual: "",
    notes: "USER-REPORTED BUG: 'appointment gone and not found in the petition too'. Focus of the dedup pass." },

  { id: "CI-62", layer: "P1", category: "Dedup & signatory",
    name: "Same phone, DIFFERENT name → deduped by mobile (blind index)",
    steps: "1. Phone 9876543210 submits as 'Ram'\n2. Same phone submits as 'Ramesh'",
    expected: "Second recognized as same citizen (mobile blind index match); either updates name or flags conflict; no duplicate citizen row",
    status: "pending", actual: "",
    notes: "Verifies Fernet encryption + SHA-256 blind index" },

  { id: "CI-63", layer: "P1", category: "Dedup & signatory",
    name: "Same phone, case/whitespace variation in name",
    steps: "1. Submit as 'Ram Kumar'\n2. Submit as '  RAM KUMAR  '",
    expected: "Recognized as same citizen; name normalization consistent",
    status: "pending", actual: "", notes: "" },

  { id: "CI-64", layer: "P1", category: "Dedup & signatory",
    name: "Concurrent submissions of same doc (race)",
    steps: "1. Open two browser windows\n2. Upload same doc.pdf in both, submit within 1 second",
    expected: "Both persisted OR one wins with clean dedup; no orphan rows, no partial state, no double-commit",
    status: "pending", actual: "",
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
  // Covers everything a PA does with an AWAITING_REVIEW appointment: the
  // list + filters, the drawer content, triage (approve → ticket, dismiss,
  // restore), manual edits (name/constituency/category/priority/ministry),
  // attachments, signatory merge / dedup, comments, and cross-cutting UX
  // (loading, mobile, polling, RBAC). Prefix "PR-".
  //
  // Route: /ai-review (legacy URL — the portal code / PR label refers to
  // it as "Petition Review" throughout).

  // ============================================================
  // A. Access / RBAC (4)
  // ============================================================
  { id: "PR-01", layer: "P2", category: "Access / RBAC",
    name: "pa_admin can load /ai-review",
    steps: "1. Log in as admin-office (pa_admin role)\n2. Navigate to /ai-review",
    expected: "Page loads; AWAITING_REVIEW list visible; no 403 / login redirect",
    status: "pending", actual: "", notes: "" },

  { id: "PR-02", layer: "P2", category: "Access / RBAC",
    name: "dept_officer redirected AWAY from /ai-review",
    steps: "1. Log in as a dept_officer account\n2. Try /ai-review directly",
    expected: "Redirect to /tickets (or 403); no AWAITING_REVIEW list visible; _no_dept_officer gate honoured",
    status: "pending", actual: "",
    notes: "Verifies dashboard.py _no_dept_officer dependency" },

  { id: "PR-03", layer: "P2", category: "Access / RBAC",
    name: "Unauthenticated → redirect to /auth/login",
    steps: "1. Wipe dash_session cookie\n2. Navigate to /ai-review",
    expected: "Clean 302 to /auth/login; no traceback; no data leaked",
    status: "pending", actual: "", notes: "" },

  { id: "PR-04", layer: "P2", category: "Access / RBAC",
    name: "Tampered dash_session cookie → 401 / login",
    steps: "1. Log in\n2. In devtools, change one char of the session cookie\n3. Reload /ai-review",
    expected: "Session invalidated; polite redirect / message; no server 500",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // B. List defaults & counts (4)
  // ============================================================
  { id: "PR-05", layer: "P2", category: "List & counts",
    name: "Empty state when no AWAITING_REVIEW rows",
    steps: "1. Fresh test env with zero AWAITING_REVIEW appointments\n2. Load /ai-review",
    expected: "Friendly empty-state ('All caught up' or similar); no undefined / broken layout; no error toast",
    status: "pending", actual: "", notes: "" },

  { id: "PR-06", layer: "P2", category: "List & counts",
    name: "Default list shows AWAITING_REVIEW only (not SCHEDULED / REVIEWED)",
    steps: "1. Seed appointments in SCHEDULED / AWAITING_REVIEW / REVIEWED\n2. Load /ai-review with default filter",
    expected: "Only AWAITING_REVIEW rows appear. SCHEDULED lives in /appointments; REVIEWED lives in Tickets.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-07", layer: "P2", category: "List & counts",
    name: "Counts bar matches /api/appointments/counts",
    steps: "1. Note the count pills at the top (Total / Today / This week / whatever the header shows)\n2. Compare to a direct GET /dashboard/api/appointments/counts response",
    expected: "Numbers match exactly. No off-by-one from timezone (IST vs UTC).",
    status: "pending", actual: "",
    notes: "Verifies IST/UTC drift fix (CORR-07/08/09)" },

  { id: "PR-08", layer: "P2", category: "List & counts",
    name: "Fresh submission appears after refresh/poll",
    steps: "1. Load /ai-review (note current count N)\n2. In another tab, submit a citizen petition\n3. Return to /ai-review; wait for the polling interval",
    expected: "New row appears without a full page reload; count → N+1",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // C. Filters (10)
  // ============================================================
  { id: "PR-09", layer: "P2", category: "Filters",
    name: "Category filter narrows list",
    steps: "1. Pick 'action_required' from Category filter\n2. Verify row set",
    expected: "Only action_required rows visible; count pill updates; URL reflects the filter",
    status: "pending", actual: "", notes: "" },

  { id: "PR-10", layer: "P2", category: "Filters",
    name: "Priority filter narrows list",
    steps: "1. Pick 'high' priority\n2. Verify",
    expected: "Only high-priority rows visible; empty-state if none",
    status: "pending", actual: "", notes: "" },

  { id: "PR-11", layer: "P2", category: "Filters",
    name: "Ministry filter narrows list",
    steps: "1. Pick a ministry\n2. Verify row set",
    expected: "Only rows for that ministry (from GrievanceSummaryRecord); rows without a GSR are excluded cleanly",
    status: "pending", actual: "", notes: "" },

  { id: "PR-12", layer: "P2", category: "Filters",
    name: "Submission date range filter",
    steps: "1. Set date_from = today, date_to = today\n2. Verify",
    expected: "Only appointments submitted today (IST) shown",
    status: "pending", actual: "", notes: "" },

  { id: "PR-13", layer: "P2", category: "Filters",
    name: "Appointment (meeting) date filter",
    steps: "1. Set appt_date_from / appt_date_to to tomorrow\n2. Verify",
    expected: "Only appointments with a scheduled slot tomorrow — filters on MLADailyAvailability.date, not created_at",
    status: "pending", actual: "", notes: "" },

  { id: "PR-14", layer: "P2", category: "Filters",
    name: "Venue filter (exact match on VenueRegistry.key)",
    steps: "1. Pick a venue\n2. Verify",
    expected: "Only rows whose Appointment.venue_id equals that key; historical rows for deactivated venues still match by key",
    status: "pending", actual: "", notes: "" },

  { id: "PR-15", layer: "P2", category: "Filters",
    name: "Search by citizen name (substring)",
    steps: "1. Type a citizen's name in search\n2. Verify",
    expected: "Rows whose decrypted citizen name contains the substring (case-insensitive)",
    status: "pending", actual: "", notes: "" },

  { id: "PR-16", layer: "P2", category: "Filters",
    name: "Search by mobile (last-4 or full number)",
    steps: "1. Search '3210' (last 4 of citizen mobile)\n2. Search full 10-digit mobile",
    expected: "Both find the citizen. Uses blind-index for full mobile; last-N substring against masked format for last-4.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-17", layer: "P2", category: "Filters",
    name: "Search by token number",
    steps: "1. Search 'TKN2026...' or bare digits\n2. Verify",
    expected: "Row with that token appears at top; other rows filtered out",
    status: "pending", actual: "", notes: "" },

  { id: "PR-18", layer: "P2", category: "Filters",
    name: "Clear-all filters resets to default",
    steps: "1. Apply 3+ filters\n2. Click Reset / Clear all",
    expected: "All filters removed; list returns to full AWAITING_REVIEW view; URL cleaned",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // D. Sort & pagination (3)
  // ============================================================
  { id: "PR-19", layer: "P2", category: "Sort & pagination",
    name: "Default sort (newest submissions first)",
    steps: "1. Load /ai-review (no sort override)\n2. Compare row order to created_at DESC",
    expected: "Newest at top; deterministic tie-break by id (PERF-08 fix)",
    status: "pending", actual: "",
    notes: "Verifies PERF-08 id tie-break on paginated ORDER BY" },

  { id: "PR-20", layer: "P2", category: "Sort & pagination",
    name: "Sort by urgency (CRITICAL > HIGH > MEDIUM > LOW)",
    steps: "1. Choose urgency sort\n2. Verify order",
    expected: "CRITICAL rows first, then HIGH, MEDIUM, LOW. Ties broken by created_at DESC + id.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-21", layer: "P2", category: "Sort & pagination",
    name: "Pagination — page 2 loads next set",
    steps: "1. Seed >25 AWAITING_REVIEW rows\n2. Load /ai-review; verify page 1\n3. Go to page 2",
    expected: "Page 2 has correct next-25; no duplicates; count / total consistent with counts endpoint",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // E. Drawer content (10)
  // ============================================================
  { id: "PR-22", layer: "P2", category: "Drawer content",
    name: "Drawer opens on row click; URL updates with token",
    steps: "1. Click any row\n2. Verify drawer + URL",
    expected: "Drawer slides in; URL updates with ?ticket=<id> or similar; browser back closes it",
    status: "pending", actual: "", notes: "" },

  { id: "PR-23", layer: "P2", category: "Drawer content",
    name: "Deep-link to a specific ticket opens the drawer",
    steps: "1. Open /ai-review?ticket=<id> directly in a fresh tab",
    expected: "Page loads with drawer already open on the specified row",
    status: "pending", actual: "", notes: "" },

  { id: "PR-24", layer: "P2", category: "Drawer content",
    name: "Citizen name / mobile (masked) / constituency / district all shown",
    steps: "1. Open a drawer\n2. Scan the OVERVIEW panel",
    expected: "All four fields present. Mobile shown as ******3210 (mask), not raw. Constituency / district reflect what was extracted / entered.",
    status: "pending", actual: "",
    notes: "Verifies mask_mobile helper — must never show raw mobile in drawer" },

  { id: "PR-25", layer: "P2", category: "Drawer content",
    name: "Category / priority / ministry badges render with correct colours",
    steps: "1. Open a drawer\n2. Screenshot the badge row",
    expected: "Category pill, priority pill (colour-coded LOW/MEDIUM/HIGH/CRITICAL), ministry pill. Values match GrievanceSummaryRecord.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-26", layer: "P2", category: "Drawer content",
    name: "AI summary text renders (English + Tamil, no mojibake)",
    steps: "1. Open a drawer where GrievanceSummaryRecord.summary_ta is populated\n2. Toggle language\n3. Verify Tamil renders in Noto Serif Tamil, English in Inter",
    expected: "Bilingual summary. No ??? or garbled bytes. Bullets render as bullets.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-27", layer: "P2", category: "Drawer content",
    name: "Key details bullets render",
    steps: "1. Open a drawer with key_details populated\n2. Scan the section",
    expected: "Bullet list of concrete evidence (dates, amounts, section citations, prior escalation)",
    status: "pending", actual: "", notes: "" },

  { id: "PR-28", layer: "P2", category: "Drawer content",
    name: "Citizen uploads section count matches attachments",
    steps: "1. Open a drawer\n2. Compare the 'CITIZEN UPLOADS N' chip to actual attachment count",
    expected: "N equals AppointmentAttachment row count; DOC / IMG / AUDIO badges reflect actual mime types",
    status: "pending", actual: "", notes: "" },

  { id: "PR-29", layer: "P2", category: "Drawer content",
    name: "PDF renders inline in iframe (regression for CI-89)",
    steps: "1. Open a drawer for a ticket with a PDF upload\n2. Verify the PDF renders inside the preview",
    expected: "Not 'blocked:other'. XFO SAMEORIGIN + frame-ancestors 'self' honoured. Same behaviour as CI-89 but exercised from Petition Review, not Tickets.",
    status: "pending", actual: "", notes: "Regression for iframe preview fix (commit 38a64bc)" },

  { id: "PR-30", layer: "P2", category: "Drawer content",
    name: "Audio playback works (native <audio> controls + seek)",
    steps: "1. Open a drawer for a ticket with a voice recording\n2. Play the audio; drag the seek bar",
    expected: "Native <audio> renders duration correctly (Range requests supported); seek jumps to arbitrary position; no infinite duration on WebM/Opus",
    status: "pending", actual: "",
    notes: "Verifies Range request handling in serve_stored_file" },

  { id: "PR-31", layer: "P2", category: "Drawer content",
    name: "Drawer closes via X button + Esc key",
    steps: "1. Open drawer\n2. Press Escape\n3. Reopen; click the X",
    expected: "Both close the drawer; URL cleaned; row loses selected state",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // F. Triage — Approve → Ticket (7)
  // ============================================================
  { id: "PR-32", layer: "P2", category: "Triage — Approve",
    name: "Approve creates a Ticket row",
    steps: "1. Open a drawer\n2. Click Approve\n3. Verify DB / Tickets tab",
    expected: "New row in tickets table; ticket.appointment_id = appt.id; ticket.status = OPEN",
    status: "pending", actual: "", notes: "" },

  { id: "PR-33", layer: "P2", category: "Triage — Approve",
    name: "Ticket number generated correctly (year-count)",
    steps: "1. Approve N appointments in a row\n2. Check ticket_number pattern",
    expected: "TKN<year><ordinal> format (e.g. TKN2026082300007). Monotonically increasing within the year; no gaps from failed inserts.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-34", layer: "P2", category: "Triage — Approve",
    name: "Appointment.status flips to REVIEWED",
    steps: "1. Approve a drawer\n2. Refetch the appointment",
    expected: "appt.status = 'REVIEWED'; visible in /appointments 'Reviewed' filter",
    status: "pending", actual: "", notes: "" },

  { id: "PR-35", layer: "P2", category: "Triage — Approve",
    name: "Drawer transitions to a 'Ticket created' success state",
    steps: "1. Approve\n2. Watch the drawer",
    expected: "Approve button becomes success chip / link to new ticket. Row disappears from AWAITING_REVIEW list (either optimistically or after refresh).",
    status: "pending", actual: "", notes: "" },

  { id: "PR-36", layer: "P2", category: "Triage — Approve",
    name: "SMS notification triggered on approve (visible in logs)",
    steps: "1. Approve a drawer with a citizen mobile\n2. Tail Railway logs for the SMS dispatch line",
    expected: "spawn_bg(_notify(kind='convert_to_petition', ...)) fires; log line 'SMS dispatched' or MSG91 stub log (no real send in test env)",
    status: "pending", actual: "", notes: "" },

  { id: "PR-37", layer: "P2", category: "Triage — Approve",
    name: "Activity log records 'created' event with actor + payload",
    steps: "1. Approve a drawer\n2. Open the activity log on the resulting ticket",
    expected: "Activity row: action_type='created', user='pa_admin', message references the token, payload has {token, appointment_id}",
    status: "pending", actual: "", notes: "" },

  { id: "PR-38", layer: "P2", category: "Triage — Approve",
    name: "Approve is idempotent — double-click doesn't create two tickets",
    steps: "1. Rapidly click Approve twice\n2. Check tickets table",
    expected: "One ticket only. Button disabled during in-flight submit. No 500. No orphan appointment status.",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // G. Triage — Dismiss (4)
  // ============================================================
  { id: "PR-39", layer: "P2", category: "Triage — Dismiss",
    name: "Dismiss requires a reason (or explicit confirmation)",
    steps: "1. Open a drawer\n2. Click Dismiss without a reason",
    expected: "Prompted for a reason OR confirmation modal. Cancel returns to drawer without change.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-40", layer: "P2", category: "Triage — Dismiss",
    name: "Dismissed appointment removed from default list, added to DISMISSED bucket",
    steps: "1. Dismiss a row\n2. Verify default list + DISMISSED filter",
    expected: "Row leaves the default (AWAITING_REVIEW) view; visible under a DISMISSED filter / status; appt.status = 'DISMISSED'",
    status: "pending", actual: "", notes: "" },

  { id: "PR-41", layer: "P2", category: "Triage — Dismiss",
    name: "Restore endpoint sends back to AWAITING_REVIEW",
    steps: "1. Open a DISMISSED row\n2. Click Restore",
    expected: "appt.status → 'AWAITING_REVIEW'; row reappears in default list; activity log records 'restored'",
    status: "pending", actual: "",
    notes: "Verifies /api/appointments/{id}/restore endpoint" },

  { id: "PR-42", layer: "P2", category: "Triage — Dismiss",
    name: "Activity log records dismiss + reason",
    steps: "1. Dismiss with reason 'duplicate submission'\n2. Open activity log",
    expected: "Activity row with action_type='dismissed', reason preserved in payload",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // H. Manual edits (6)
  // ============================================================
  { id: "PR-43", layer: "P2", category: "Manual edits",
    name: "Edit citizen name (PATCH /details) persists",
    steps: "1. Click edit pencil on citizen name\n2. Change name; save\n3. Refresh drawer",
    expected: "Name updated on citizen row (encrypted + blind-index rehashed). Drawer shows the new value.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-44", layer: "P2", category: "Manual edits",
    name: "Edit constituency persists",
    steps: "1. Edit constituency; save\n2. Refresh drawer",
    expected: "New value persisted on Appointment row",
    status: "pending", actual: "", notes: "" },

  { id: "PR-45", layer: "P2", category: "Manual edits",
    name: "Edit category persists + reflects in filter immediately",
    steps: "1. Change category from 'other' to 'action_required'\n2. Apply category=action_required filter",
    expected: "Row now included in the filtered list; category badge updated in the drawer",
    status: "pending", actual: "", notes: "" },

  { id: "PR-46", layer: "P2", category: "Manual edits",
    name: "Edit priority overrides AI-inferred value",
    steps: "1. AI set priority=MEDIUM; PA changes to HIGH\n2. Save; refresh",
    expected: "GrievanceSummaryRecord (or appt override field) shows HIGH; badge colour updated; sort-by-urgency respects the override",
    status: "pending", actual: "", notes: "" },

  { id: "PR-47", layer: "P2", category: "Manual edits",
    name: "Edit ministry persists + reflects in ministry filter",
    steps: "1. Change ministry to a different one; save\n2. Apply filter for the new ministry",
    expected: "Row appears in the new bucket, disappears from the old",
    status: "pending", actual: "", notes: "" },

  { id: "PR-48", layer: "P2", category: "Manual edits",
    name: "Edit conflict — two tabs — last-write-wins with clean UI",
    steps: "1. Open the same drawer in two tabs\n2. Edit + save in Tab A\n3. Edit + save in Tab B (without refreshing)",
    expected: "Second save either succeeds (overwrites) with a clear indicator, OR is rejected with a polite 'this ticket was updated elsewhere — refresh' message. No silent 500 / no lost data.",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // I. Attachments (3)
  // ============================================================
  { id: "PR-49", layer: "P2", category: "Attachments",
    name: "PA adds an attachment from drawer — uploads OK + count increments",
    steps: "1. Open a drawer\n2. Use the Add attachment control; upload a small PDF",
    expected: "POST /api/appointments/{id}/attachment succeeds; CITIZEN UPLOADS count +1; new chip visible; file preview works",
    status: "pending", actual: "", notes: "" },

  { id: "PR-50", layer: "P2", category: "Attachments",
    name: "Attachment respects 5MB size cap + 10-file total cap",
    steps: "1. Try uploading a 6MB file → expect reject\n2. When appt already has 10 attachments → try one more → expect reject",
    expected: "Clean 413 or client-side block with human message; server-side cap honoured; count never exceeds 10",
    status: "pending", actual: "", notes: "" },

  { id: "PR-51", layer: "P2", category: "Attachments",
    name: "Filename XSS (regression for CITZ-02) in Petition Review drawer",
    steps: "1. Upload a PDF renamed to '<script>alert(1)</script>.pdf' via PA drawer\n2. Inspect chip render",
    expected: "Filename escaped in drawer chip AND in file preview title. No alert dialog. No console error.",
    status: "pending", actual: "", notes: "CITZ-02 regression from the drawer surface" },

  // ============================================================
  // J. Dedup — signatory merge (5)
  // ============================================================
  { id: "PR-52", layer: "P2", category: "Signatory dedup",
    name: "Similar-cases endpoint returns close matches",
    steps: "1. Open a drawer\n2. GET /api/appointments/{id}/similar",
    expected: "Returns candidate AWAITING_REVIEW rows blocked by category + district, scored by normalized similarity",
    status: "pending", actual: "",
    notes: "Verifies /similar endpoint added for merge suggestions" },

  { id: "PR-53", layer: "P2", category: "Signatory dedup",
    name: "Approve-with-signatories merges into an existing petition",
    steps: "1. Open a drawer with a similar case\n2. Approve-with-signatories → target an existing ticket",
    expected: "Current appt merged as a signatory of the target ticket. No new Ticket row. Both citizens visible on the merged ticket's signatory list.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-54", layer: "P2", category: "Signatory dedup",
    name: "Merge preserves original citizen's appointment (Phase 1 CI-61 regression)",
    steps: "1. Follow the CI-61 scenario end-to-end via the merge flow\n2. Verify both appointments after merge",
    expected: "Both citizens' appointments remain linked. Neither disappears. USER-REPORTED bug from Phase 1 stays fixed via the Petition Review path too.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-55", layer: "P2", category: "Signatory dedup",
    name: "Concurrent merge (two PAs) — FOR UPDATE lock prevents ghost rows",
    steps: "1. Two PAs open the same drawer\n2. Both click Approve-with-signatories on the same target within 1s",
    expected: "One wins; the other gets a clean 'already merged / target updated' message. No duplicate signatory row. No partial state.",
    status: "pending", actual: "",
    notes: "Verifies CORR-06 FOR UPDATE row-lock on signatory merge" },

  { id: "PR-56", layer: "P2", category: "Signatory dedup",
    name: "Cross-department merge respects RBAC gate",
    steps: "1. As pa_admin scoped to Dept A, try to merge into a target that lives in Dept B\n2. Verify behavior",
    expected: "Either allowed with a warning, OR blocked with a clean 'target belongs to another department' message. Never a silent cross-department mutation.",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // K. Comments (2)
  // ============================================================
  { id: "PR-57", layer: "P2", category: "Comments",
    name: "PA can add a comment via drawer — persists + shows in activity log",
    steps: "1. Add a comment via /api/appointments/{id}/comment\n2. Reload the drawer / activity log",
    expected: "Comment stored; visible in the activity feed with author + timestamp",
    status: "pending", actual: "", notes: "" },

  { id: "PR-58", layer: "P2", category: "Comments",
    name: "Comment supports Tamil characters (no ??? or codec error)",
    steps: "1. Add a Tamil comment: 'மீண்டும் அழைக்கவும்'\n2. Reload",
    expected: "Tamil preserved end-to-end. No mojibake. No SDK ascii-in-header error (comment path is DB only, not Gemini — so no expected failure).",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // L. Cross-cutting UX (4)
  // ============================================================
  { id: "PR-59", layer: "P2", category: "Cross-cutting UX",
    name: "All error toasts polished across Petition Review",
    steps: "1. Trigger errors: 5MB+ attachment, network offline mid-approve, backend 500, invalid edit\n2. Screenshot each toast",
    expected: "Zero tracebacks. Zero 'gemini-2.5-flash'. Zero raw HTTP codes. All messages routed through businessMessage() (frontend errors.ts).",
    status: "pending", actual: "", notes: "" },

  { id: "PR-60", layer: "P2", category: "Cross-cutting UX",
    name: "Loading skeleton on drawer open (>200ms fetch)",
    steps: "1. Throttle network to 'Slow 3G' in devtools\n2. Open a drawer",
    expected: "Skeleton / spinner visible while fetching. No content flash. No blank white area.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-61", layer: "P2", category: "Cross-cutting UX",
    name: "Mobile viewport (375px) — drawer usable, no horizontal scroll",
    steps: "1. Resize to 375x812\n2. Open a drawer",
    expected: "Drawer either becomes a full-screen sheet or scales down. All actions reachable with thumbs. No horizontal scroll on body.",
    status: "pending", actual: "", notes: "" },

  { id: "PR-62", layer: "P2", category: "Cross-cutting UX",
    name: "Polling refresh — new petitions appear without full page reload",
    steps: "1. Load /ai-review; note current count\n2. In another tab / device, submit a new petition\n3. Wait for the polling interval",
    expected: "New row appears in the list; count updates. No full-page refresh needed. Drawer content preserved if open on a different row.",
    status: "pending", actual: "", notes: "" }
];
