// Source of truth for the QA test set.
// Edit statuses here as tests run; open dashboard.html to see the current state.
// Statuses: pending | running | pass | fail | blocked | skipped
//
// After editing, run `python3 qa/sync-xlsx.py` to regenerate test-cases.xlsx.

window.META = {
  project: "Manu — VPA Petition Desk",
  environment: "Railway (testing)",
  gitSha: "6fda89b",
  updated: "2026-08-22",
  activeLayer: "P1 — Citizen Intake"
};

window.LAYERS = [
  {
    key: "P1",
    label: "Phase 1 — Citizen Intake",
    surface: "Jinja2 citizen pages (form, referral, upload, voice, QR)",
    order: 1,
    active: true
  },
  { key: "P2", label: "Phase 2 — PA Petition Review",       order: 2, active: false },
  { key: "P3", label: "Phase 3 — Tickets / Association Review", order: 3, active: false },
  { key: "P4", label: "Phase 4 — Events (voice + photo)",   order: 4, active: false },
  { key: "P5", label: "Phase 5 — Executive / Dept / Minister", order: 5, active: false },
  { key: "P6", label: "Phase 6 — Cross-cutting sanity",     order: 6, active: false }
];

// -------------------------------------------------------------------------
// Phase 1 — Citizen Intake  (comprehensive; edge cases included)
// -------------------------------------------------------------------------
window.TEST_CASES = [
  // ============================================================
  // A. Referral form — happy paths (5)
  // ============================================================
  { id: "CI-01", layer: "P1", category: "Referral form — happy",
    name: "Submit English referral on desktop",
    steps: "1. Open /referral (desktop viewport)\n2. Fill name (English), 10-digit mobile, complaint\n3. Submit",
    expected: "200 OK + reference token shown; row visible in crowd table",
    status: "pending", actual: "", notes: "" },

  { id: "CI-02", layer: "P1", category: "Referral form — happy",
    name: "Submit Tamil referral on desktop",
    steps: "1. Open /referral, toggle Tamil\n2. Fill Tamil name + mobile + Tamil complaint\n3. Submit",
    expected: "200 OK + Tamil reference token; Tamil chars preserved end-to-end (no mojibake, no ???)",
    status: "pending", actual: "", notes: "" },

  { id: "CI-03", layer: "P1", category: "Referral form — happy",
    name: "Submit English referral on mobile viewport",
    steps: "1. Resize to 375x812\n2. Fill valid form\n3. Submit",
    expected: "Layout intact, form usable with thumbs, submit succeeds",
    status: "pending", actual: "", notes: "" },

  { id: "CI-04", layer: "P1", category: "Referral form — happy",
    name: "Submit Tamil referral on mobile viewport",
    steps: "1. 375x812 + Tamil toggle\n2. Fill Tamil form\n3. Submit",
    expected: "Tamil font renders on mobile, form submits, ref token in Tamil",
    status: "pending", actual: "", notes: "" },

  { id: "CI-05", layer: "P1", category: "Referral form — happy",
    name: "Language toggle mid-form preserves data",
    steps: "1. Fill 50% of form in English\n2. Toggle to Tamil\n3. Verify inputs still there",
    expected: "Values persist; labels swap; no reset",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // B. Field validation — mobile (5)
  // ============================================================
  { id: "CI-06", layer: "P1", category: "Validation — mobile",
    name: "Letters/symbols in mobile field rejected",
    steps: "1. Type 'abcdefghij', '####', '9876@1234'\n2. Attempt submit each",
    expected: "Inline error 'valid 10-digit mobile'; submit blocked",
    status: "pending", actual: "", notes: "" },

  { id: "CI-07", layer: "P1", category: "Validation — mobile",
    name: "Short mobile (<10 digits) rejected",
    steps: "1. Type '98765'\n2. Attempt submit",
    expected: "Inline error; submit blocked",
    status: "pending", actual: "", notes: "" },

  { id: "CI-08", layer: "P1", category: "Validation — mobile",
    name: "Long mobile (>10 digits) rejected",
    steps: "1. Type '98765432109'\n2. Attempt submit",
    expected: "Inline error OR silent truncation with warning; submit blocked",
    status: "pending", actual: "", notes: "" },

  { id: "CI-09", layer: "P1", category: "Validation — mobile",
    name: "Mobile with country-code prefix ('+91 98765...')",
    steps: "1. Type '+919876543210'\n2. Submit",
    expected: "Either strip prefix silently and accept, OR clean error asking for 10 digits",
    status: "pending", actual: "", notes: "Design decision — must not silently save '+91' inside stored mobile" },

  { id: "CI-10", layer: "P1", category: "Validation — mobile",
    name: "Mobile with spaces / dashes / brackets",
    steps: "1. Type '98765 43210', '98765-43210', '(987)654-3210'\n2. Submit",
    expected: "Either normalize and accept, OR clean error",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // C. Field validation — name (4)
  // ============================================================
  { id: "CI-11", layer: "P1", category: "Validation — name",
    name: "Empty name rejected",
    steps: "1. Leave name blank\n2. Submit",
    expected: "Inline required-field error",
    status: "pending", actual: "", notes: "" },

  { id: "CI-12", layer: "P1", category: "Validation — name",
    name: "Whitespace-only name rejected",
    steps: "1. Type '     '\n2. Submit",
    expected: "Rejected (trimmed to empty); not saved as blank row",
    status: "pending", actual: "", notes: "" },

  { id: "CI-13", layer: "P1", category: "Validation — name",
    name: "Very long name (300 chars) handled",
    steps: "1. Paste 300-char name\n2. Submit valid form",
    expected: "Either accepted (truncated w/ warning) or clean length error; no 500",
    status: "pending", actual: "", notes: "" },

  { id: "CI-14", layer: "P1", category: "Validation — name",
    name: "Name with emoji / mixed script / RTL / control chars",
    steps: "1. Try 'ராம் 🙏', 'راماكشوان', 'Ram\\n\\rKumar'\n2. Submit each",
    expected: "Emoji/Unicode preserved OR stripped consistently; no crash; no chars break downstream drawer",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // D. Field validation — complaint (4)
  // ============================================================
  { id: "CI-15", layer: "P1", category: "Validation — complaint",
    name: "Empty complaint rejected",
    steps: "1. Fill name+mobile, leave complaint blank\n2. Submit",
    expected: "Inline required-field error",
    status: "pending", actual: "", notes: "" },

  { id: "CI-16", layer: "P1", category: "Validation — complaint",
    name: "10,000-char complaint",
    steps: "1. Paste 10000 chars into complaint\n2. Submit",
    expected: "Accepted (truncated w/ warning) OR clean length error; no 500; DB row not corrupted",
    status: "pending", actual: "", notes: "" },

  { id: "CI-17", layer: "P1", category: "Validation — complaint",
    name: "HTML / <script> injection in complaint body",
    steps: "1. Paste '<script>alert(1)</script><img src=x onerror=alert(2)>'\n2. Submit\n3. View in PA portal drawer",
    expected: "Rendered as escaped text everywhere — no dialog, no console error, no HTML executed",
    status: "pending", actual: "", notes: "XSS regression" },

  { id: "CI-18", layer: "P1", category: "Validation — complaint",
    name: "Complaint = only newlines / control chars",
    steps: "1. Type '\\n\\n\\n\\r\\r'\n2. Submit",
    expected: "Rejected as empty (after trim)",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // E. Referral form — session / behavior / security (5)
  // ============================================================
  { id: "CI-19", layer: "P1", category: "Referral form — behavior",
    name: "Mobile field REQUIRED on mobile viewport (CITZ-03)",
    steps: "1. 375x812\n2. Try to submit without mobile\n3. Try with valid mobile",
    expected: "Blocked with inline error; passes when filled",
    status: "pending", actual: "", notes: "CITZ-03 Critical fix" },

  { id: "CI-20", layer: "P1", category: "Referral form — behavior",
    name: "CSRF token — form has one; spoofed request rejected",
    steps: "1. Inspect form for CSRF hidden input\n2. Replay POST via curl without token\n3. Replay with wrong token",
    expected: "Legit form works; spoof/replay → 403",
    status: "pending", actual: "", notes: "" },

  { id: "CI-21", layer: "P1", category: "Referral form — behavior",
    name: "Session expiry mid-form → clean re-init",
    steps: "1. Open form\n2. Wait for session to expire (or manually clear cookie)\n3. Submit",
    expected: "Redirect to fresh session / polite message; no 500",
    status: "pending", actual: "", notes: "" },

  { id: "CI-22", layer: "P1", category: "Referral form — behavior",
    name: "Browser back after submit → no duplicate row",
    steps: "1. Submit valid form\n2. Press browser back\n3. Press submit again",
    expected: "Either idempotent (same ref) or clean 'already submitted' guard; no duplicate crowd row",
    status: "pending", actual: "", notes: "" },

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
    status: "pending", actual: "", notes: "" },

  { id: "CI-25", layer: "P1", category: "Upload — file types",
    name: "PDF multi-page (5+) → extraction runs",
    steps: "1. Upload 5-page petition PDF\n2. Wait",
    expected: "Extraction handles multi-page (concat or first-page best-effort); ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-26", layer: "P1", category: "Upload — file types",
    name: "Small JPEG (<500KB) → OCR runs",
    steps: "1. Upload small photo of petition\n2. Wait",
    expected: "OCR extracts fields; ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-27", layer: "P1", category: "Upload — file types",
    name: "Large JPEG with EXIF rotation",
    steps: "1. Take portrait photo on phone (EXIF orientation flag set)\n2. Upload",
    expected: "Server auto-rotates before OCR; extraction reads text upright",
    status: "pending", actual: "", notes: "" },

  { id: "CI-28", layer: "P1", category: "Upload — file types",
    name: "PNG upload accepted",
    steps: "1. Upload a PNG screenshot of petition text\n2. Wait",
    expected: "Same extraction flow; ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-29", layer: "P1", category: "Upload — file types",
    name: "HEIC (iPhone) upload",
    steps: "1. Take iPhone photo saved as .heic\n2. Upload from iOS Safari",
    expected: "Either server transcodes and extracts, OR clean 'please convert to JPEG' error",
    status: "pending", actual: "", notes: "iOS default format — must not silently fail" },

  // ============================================================
  // G. Upload — file types REJECTED (4)
  // ============================================================
  { id: "CI-30", layer: "P1", category: "Upload — rejected types",
    name: "Password-protected PDF → clean reject",
    steps: "1. Encrypt a PDF with a password\n2. Upload",
    expected: "Clean 'cannot read encrypted PDF' UI message; no traceback",
    status: "pending", actual: "", notes: "" },

  { id: "CI-31", layer: "P1", category: "Upload — rejected types",
    name: "Corrupted PDF (truncated bytes) → clean reject",
    steps: "1. Truncate a PDF at 512 bytes\n2. Upload",
    expected: "Clean 'file damaged' UI message; no server 500; no partial ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-32", layer: "P1", category: "Upload — rejected types",
    name: "Dangerous MIME types (docx, exe, svg, zip)",
    steps: "1. Try uploading .docx, .exe, .zip, .svg one by one",
    expected: "All rejected client-side AND server-side; no bypass by renaming .exe to .pdf",
    status: "pending", actual: "", notes: "SVG can carry JS — must be rejected" },

  { id: "CI-33", layer: "P1", category: "Upload — rejected types",
    name: "0-byte file",
    steps: "1. `touch empty.pdf`\n2. Upload it",
    expected: "Clean 'file is empty' error; no crash",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // H. Upload — file sizes (3)
  // ============================================================
  { id: "CI-34", layer: "P1", category: "Upload — sizes",
    name: "5MB normal PDF processes cleanly",
    steps: "1. Upload a 5MB PDF\n2. Wait",
    expected: "Extraction completes within ~15s; ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-35", layer: "P1", category: "Upload — sizes",
    name: "20MB large PDF — processes or clean size error",
    steps: "1. Upload 20MB PDF\n2. Watch UI",
    expected: "Either succeeds within reasonable time OR clean 'file too large' message; no 500; no timeout",
    status: "pending", actual: "", notes: "" },

  { id: "CI-36", layer: "P1", category: "Upload — sizes",
    name: "100MB huge file → immediate rejection",
    steps: "1. Try to upload 100MB video/PDF\n2. Watch",
    expected: "Rejected client-side before upload starts OR server rejects with clean 413; no hang",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // I. Upload — filename edges (5)
  // ============================================================
  { id: "CI-37", layer: "P1", category: "Upload — filename",
    name: "<script>alert(1)</script>.pdf renders as text (CITZ-02)",
    steps: "1. Rename any PDF to that name\n2. Upload\n3. Watch filename chip in UI\n4. Also check PA portal drawer",
    expected: "Filename escaped everywhere; no alert dialog; no console XSS error",
    status: "pending", actual: "", notes: "CITZ-02 Critical XSS fix" },

  { id: "CI-38", layer: "P1", category: "Upload — filename",
    name: "Path traversal in filename (`../../etc/passwd`)",
    steps: "1. Rename to `../../etc/passwd.pdf`\n2. Upload\n3. Check server storage path",
    expected: "Stored under safe randomized/sanitized name; no directory traversal; no server file overwritten",
    status: "pending", actual: "", notes: "" },

  { id: "CI-39", layer: "P1", category: "Upload — filename",
    name: "Unicode Tamil filename preserved end-to-end",
    steps: "1. Rename to 'மனு.pdf'\n2. Upload\n3. Check filename display in citizen UI + PA drawer + doc download",
    expected: "Filename renders correctly in all three surfaces; download preserves Tamil",
    status: "pending", actual: "", notes: "" },

  { id: "CI-40", layer: "P1", category: "Upload — filename",
    name: "500-char filename handled",
    steps: "1. Rename to 500 chars + '.pdf'\n2. Upload",
    expected: "Truncated cleanly OR clean error; no DB constraint violation",
    status: "pending", actual: "", notes: "" },

  { id: "CI-41", layer: "P1", category: "Upload — filename",
    name: "Filename with quotes / backslash / percent",
    steps: "1. Try `pet\"'()%20file.pdf`\n2. Upload",
    expected: "Stored/displayed safely; no shell/SQL injection artifacts; URLs escape correctly",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // J. AI extraction — happy path (4)
  // ============================================================
  { id: "CI-42", layer: "P1", category: "AI extraction — happy",
    name: "English printed PDF → all fields extracted",
    steps: "1. Upload clean English petition PDF\n2. Open ticket in PA portal",
    expected: "Name, mobile, address, complaint populated; source doc viewable; confidence displayed",
    status: "pending", actual: "", notes: "" },

  { id: "CI-43", layer: "P1", category: "AI extraction — happy",
    name: "Tamil printed PDF → all fields, no mojibake",
    steps: "1. Upload clean Tamil petition PDF\n2. Open ticket in portal",
    expected: "Tamil name/complaint preserved (not ??? or garbled); font renders in drawer",
    status: "pending", actual: "", notes: "" },

  { id: "CI-44", layer: "P1", category: "AI extraction — happy",
    name: "JPEG petition → OCR extraction runs",
    steps: "1. Upload photo of petition\n2. Wait\n3. Check portal",
    expected: "OCR extracts (may be lower confidence); ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-45", layer: "P1", category: "AI extraction — happy",
    name: "Rotated image (90/180/270) auto-oriented",
    steps: "1. Upload a photo rotated 90 degrees\n2. Check extraction result",
    expected: "Text extracted correctly (server auto-rotates before OCR)",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // K. AI extraction — edge cases (7)
  // ============================================================
  { id: "CI-46", layer: "P1", category: "AI extraction — edges",
    name: "Blurry image → polished user error",
    steps: "1. Upload a completely blurry/motion-blur photo\n2. Watch UI",
    expected: "Polished 'could not read' message; NOT Python traceback, NOT 'codec error', NOT 'gemini-2.5-flash failed on all models'",
    status: "pending", actual: "", notes: "Verifies businessMessage() TECHNICAL regex" },

  { id: "CI-47", layer: "P1", category: "AI extraction — edges",
    name: "Random selfie / landscape (not a doc) → polished error",
    steps: "1. Upload a scenic photo with no text\n2. Watch UI",
    expected: "Polite 'no petition detected in image' style message; no traceback",
    status: "pending", actual: "", notes: "" },

  { id: "CI-48", layer: "P1", category: "AI extraction — edges",
    name: "Blank white page / paper → empty extraction",
    steps: "1. Upload a blank PDF or blank photo\n2. Watch UI",
    expected: "Empty result surfaced cleanly; either 'no text detected' or ticket in special empty state; no crash",
    status: "pending", actual: "", notes: "" },

  { id: "CI-49", layer: "P1", category: "AI extraction — edges",
    name: "Handwritten petition — best-effort or clean fallback",
    steps: "1. Upload photo of a handwritten petition\n2. Check portal",
    expected: "Either partial extraction with low confidence flag, OR clean 'handwriting not supported'; no silent success with garbage",
    status: "pending", actual: "", notes: "" },

  { id: "CI-50", layer: "P1", category: "AI extraction — edges",
    name: "Two petitions in one page/photo",
    steps: "1. Upload a photo containing 2 distinct petitions\n2. Check extraction",
    expected: "Either one extracted (dominant), OR user prompted to choose, OR two tickets created — behavior consistent and documented",
    status: "pending", actual: "", notes: "" },

  { id: "CI-51", layer: "P1", category: "AI extraction — edges",
    name: "Vertex fallback — primary fails, Vertex picks up",
    steps: "1. Temporarily break Gemini API key OR force upload during API outage\n2. Watch logs for Vertex retry",
    expected: "Log line 'Vertex AI backend ready ... creds=env-content' present at boot; on primary failure request routes through Vertex; ticket still created",
    status: "pending", actual: "",
    notes: "Verifies petition_extraction.py Vertex overload (commit 6fda89b)" },

  { id: "CI-52", layer: "P1", category: "AI extraction — edges",
    name: "Both models fail → polished error, no traceback",
    steps: "1. Force both Gemini + Vertex to fail (bad keys, network offline)\n2. Upload valid PDF",
    expected: "Polite 'extraction unavailable, please try again' message in UI; server logs the technical detail; no user-visible traceback",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // L. Voice upload (6)
  // ============================================================
  { id: "CI-53", layer: "P1", category: "Voice upload",
    name: "Tamil voice → 200 OK, no 500 (ASCII fix)",
    steps: "1. Record 20s Tamil complaint\n2. Upload via voice flow",
    expected: "200 OK, extraction runs, no UnicodeEncodeError from httpx headers",
    status: "pending", actual: "", notes: "Verifies event_service.py _ascii_safe fix" },

  { id: "CI-54", layer: "P1", category: "Voice upload",
    name: "Voice + Tamil text in note field → no header crash",
    steps: "1. Same as CI-53\n2. Add Tamil text into the note before upload",
    expected: "200 OK; note stored on ticket; Tamil preserved",
    status: "pending", actual: "", notes: "" },

  { id: "CI-55", layer: "P1", category: "Voice upload",
    name: "English voice → extraction runs",
    steps: "1. Record 20s English complaint\n2. Upload",
    expected: "Extraction returns English fields; ticket created",
    status: "pending", actual: "", notes: "" },

  { id: "CI-56", layer: "P1", category: "Voice upload",
    name: "Very short (1s) audio → clean short-input handling",
    steps: "1. Record 1s clip\n2. Upload",
    expected: "Either extracts short phrase OR clean 'too short' message; no crash",
    status: "pending", actual: "", notes: "" },

  { id: "CI-57", layer: "P1", category: "Voice upload",
    name: "Silence-only audio → empty extraction",
    steps: "1. Record 10s of silence\n2. Upload",
    expected: "Extraction returns empty; clean 'no speech detected' UI; no crash",
    status: "pending", actual: "", notes: "" },

  { id: "CI-58", layer: "P1", category: "Voice upload",
    name: "Corrupted audio file → clean rejection",
    steps: "1. Truncate an m4a to 200 bytes\n2. Upload",
    expected: "Clean 'audio file damaged' error; no 500; no partial ticket",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // M. Dedup & signatory (6)
  // ============================================================
  { id: "CI-59", layer: "P1", category: "Dedup & signatory",
    name: "Same doc, two different phones → both AWAITING_REVIEW",
    steps: "1. Phone A uploads doc.pdf, books appointment\n2. Phone B uploads same doc.pdf, books appointment",
    expected: "Two independent tickets, both AWAITING_REVIEW; both appointments visible",
    status: "pending", actual: "", notes: "Setup for CI-60/61" },

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
    notes: "USER-REPORTED BUG: 'appointment gone and not found in the petition too'" },

  { id: "CI-62", layer: "P1", category: "Dedup & signatory",
    name: "Same phone, DIFFERENT name → deduped by mobile (blind index)",
    steps: "1. Phone 9876543210 submits as 'Ram'\n2. Same phone submits as 'Ramesh'",
    expected: "Second recognized as same citizen (mobile blind index match); either updates name or flags conflict; no duplicate citizen row",
    status: "pending", actual: "", notes: "Verifies Fernet encryption + SHA-256 blind index" },

  { id: "CI-63", layer: "P1", category: "Dedup & signatory",
    name: "Same phone, case/whitespace variation in name",
    steps: "1. Submit as 'Ram Kumar'\n2. Submit as '  RAM KUMAR  '",
    expected: "Recognized as same citizen; name normalization consistent",
    status: "pending", actual: "", notes: "" },

  { id: "CI-64", layer: "P1", category: "Dedup & signatory",
    name: "Concurrent submissions of same doc (race)",
    steps: "1. Open two browser windows\n2. Upload same doc.pdf in both, submit within 1 second",
    expected: "Both persisted OR one wins with clean dedup; no orphan rows, no partial state, no double-commit",
    status: "pending", actual: "", notes: "Verifies CORR-06 signatory merge FOR UPDATE row-lock" },

  // ============================================================
  // N. Appointment booking (5)
  // ============================================================
  { id: "CI-65", layer: "P1", category: "Appointment",
    name: "View available slots for a department",
    steps: "1. Complete upload\n2. Reach appointment step\n3. Select department",
    expected: "Slot grid loads (uses /api/venues cache); shows next-N days; unavailable slots grayed",
    status: "pending", actual: "", notes: "Verifies PERF-18 Cache-Control on /api/venues" },

  { id: "CI-66", layer: "P1", category: "Appointment",
    name: "Book a slot → confirmation shown",
    steps: "1. Pick a slot\n2. Confirm booking",
    expected: "Confirmation page with time, department, QR/ref; appointment row in DB",
    status: "pending", actual: "", notes: "" },

  { id: "CI-67", layer: "P1", category: "Appointment",
    name: "No slots available → clean message",
    steps: "1. Pick a fully-booked department/day\n2. View slots",
    expected: "Empty-state 'no slots today, try tomorrow' message; not a blank grid",
    status: "pending", actual: "", notes: "" },

  { id: "CI-68", layer: "P1", category: "Appointment",
    name: "Concurrent booking of same slot (race)",
    steps: "1. Two browsers, both click same slot at same time",
    expected: "One wins, other gets clean 'slot just taken' error; no double-booking in DB",
    status: "pending", actual: "", notes: "" },

  { id: "CI-69", layer: "P1", category: "Appointment",
    name: "Book slot → convert-to-petition later → appointment survives",
    steps: "1. Book slot\n2. Convert ticket to petition in portal\n3. Check appointment still present on new petition",
    expected: "Appointment linked to petition; visible in citizen's confirmation and on portal drawer",
    status: "pending", actual: "", notes: "Related to CI-61 bug" },

  // ============================================================
  // O. Guards (2)
  // ============================================================
  { id: "CI-70", layer: "P1", category: "Guards",
    name: "One-per-day OFF → second submit allowed (testing mode)",
    steps: "1. Confirm ONE_PETITION_PER_DAY=false on Railway\n2. Same phone submits twice in same day",
    expected: "Both accepted; both tickets in queue",
    status: "pending", actual: "", notes: "Active test in current env" },

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
    status: "pending", actual: "", notes: "CITZ-01 Critical" },

  { id: "CI-73", layer: "P1", category: "Session / QR",
    name: "Direct hit to /citizen/upload without QR session → clean redirect",
    steps: "1. Wipe cookies\n2. Navigate directly to /citizen/upload",
    expected: "Redirect to landing OR 'session expired' page; not a 500, not a blank page, not a stack trace",
    status: "pending", actual: "", notes: "" },

  { id: "CI-74", layer: "P1", category: "Session / QR",
    name: "Tampered session cookie → clean rejection",
    steps: "1. Get a valid session cookie\n2. Change one char in devtools\n3. Reload",
    expected: "401 or clean redirect; polite message; no server 500",
    status: "pending", actual: "", notes: "" },

  { id: "CI-75", layer: "P1", category: "Session / QR",
    name: "Session expiry mid-upload → clean recovery",
    steps: "1. Start upload\n2. Manually expire session between file-select and submit\n3. Submit",
    expected: "Clean 'session expired, please re-scan QR' UI; upload not silently dropped",
    status: "pending", actual: "", notes: "" },

  { id: "CI-76", layer: "P1", category: "Session / QR",
    name: "Multiple browser tabs sharing session",
    steps: "1. Open citizen flow in tab A and tab B (same session cookie)\n2. Submit form in A\n3. Try to submit in B",
    expected: "Behavior consistent — either last-write-wins with cross-tab awareness, OR guarded and B is told 'already submitted'; no silent duplicate row",
    status: "pending", actual: "", notes: "" },

  // ============================================================
  // Q. Cross-cutting UX (6)
  // ============================================================
  { id: "CI-77", layer: "P1", category: "Cross-cutting UX",
    name: "All error toasts polished across citizen flow",
    steps: "1. Force errors: bad file type, huge file, expired session, network offline, bad OCR\n2. Screenshot every error toast",
    expected: "Zero tracebacks, zero 'gemini-2.5-flash', zero 'codec can't encode', zero HTTP status codes; only user-friendly text",
    status: "pending", actual: "", notes: "Regression net for TECHNICAL regex + businessMessage()" },

  { id: "CI-78", layer: "P1", category: "Cross-cutting UX",
    name: "Loading state during long AI extraction (>5s)",
    steps: "1. Upload a 10-page PDF that takes >5s to extract\n2. Watch UI",
    expected: "Spinner + progress copy visible whole time; no frozen screen; no spurious 'failed'",
    status: "pending", actual: "", notes: "" },

  { id: "CI-79", layer: "P1", category: "Cross-cutting UX",
    name: "Empty state on landing when no history",
    steps: "1. Fresh browser, first visit to citizen home\n2. Observe landing",
    expected: "Welcome/onboarding copy; no 'undefined' or broken layout",
    status: "pending", actual: "", notes: "" },

  { id: "CI-80", layer: "P1", category: "Cross-cutting UX",
    name: "iOS Safari safe-area / notch handling",
    steps: "1. Open in iOS Safari on iPhone with notch (or simulator)\n2. Check top bar and bottom action button",
    expected: "Content not hidden under notch or home indicator; scroll works",
    status: "pending", actual: "", notes: "" },

  { id: "CI-81", layer: "P1", category: "Cross-cutting UX",
    name: "Tamil font (Noto Serif Tamil) loads on all citizen pages",
    steps: "1. Visit /referral, /citizen/upload, appointment, confirmation in Tamil mode\n2. Inspect font-family used",
    expected: "Tamil text uses Noto Serif Tamil (not system fallback); no invisible boxes",
    status: "pending", actual: "", notes: "" },

  { id: "CI-82", layer: "P1", category: "Cross-cutting UX",
    name: "Print / share confirmation preview",
    steps: "1. On confirmation screen, use browser print preview and share sheet",
    expected: "Print-friendly layout; share (mobile) sheet includes reference token / QR",
    status: "pending", actual: "", notes: "" }
];
