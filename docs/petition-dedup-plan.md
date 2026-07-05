# Petition deduplication — parked plan

Paused for field research. Pick this back up once we've watched real citizens
go through the QR → meeting → follow-up cycle and know:

1. **Do citizens actually write the token on the front page when told to?**
   (drives whether Layer 1 alone is enough)
2. **How often do they bring identical pages vs. genuinely more content?**
   (drives the "re-summarise only if new" rule)
3. **How often do they change name/mobile between QR and follow-up scan?**
   (drives the token-mismatch policy)

## The problem

A citizen QR-submits a partial petition → gets `TKN123456` → meets the
Minister → is asked to bring the complete document → PA staff bulk-scans it
via AI Uploads. Today that produces a **second** ticket, a second AI
summary, a second SMS chain, for the same grievance. We need dedup that:

- Doesn't false-positive on legitimately-new petitions from the same
  citizen (multiple grievances are fine).
- Doesn't waste a Gemini call when the "new" pages are just a photocopy of
  what we already have.
- Fails to a safe default (create-new-ticket) when signals conflict, so we
  never silently drop a citizen's petition into someone else's case.

## Scope for the first pass

**Layer 1 only** — token-on-page dedup. Deterministic. Defer Layer 2
(fuzzy mobile + content match) and Layer 3 (silent fingerprint audit)
until we see whether citizens use the token in practice.

## Layer 1 — token-on-page

### Citizen-facing change

- QR receipt / SMS after submission: prominently show the token with a
  one-line instruction:
  > **உங்கள் Token: TKN123456**
  > (இதனை மேலதிக பக்கங்கள் கொண்டு வரும்போது முதல் பக்கத்தின் மேல் எழுதவும்)
  >
  > **Your Token: TKN123456**
  > (If you bring more pages later, write this on the top of page 1.)

### AI Uploads flow change

On each uploaded file, before the current extraction call:

1. **Front-page-only OCR pass** — send just page 1 to Gemini (or a cheap
   local OCR) with a tight prompt: "Look at the top strip of this page.
   If you see a token in the form `TKN` followed by 4-7 digits, return
   just the digits. Return empty if none found or you are not confident."
2. If a token is found → **lookup path** (below).
3. If not → falls through to today's standard extract-and-create flow.

### Lookup path (token found)

- Fetch the appointment for the token. If it doesn't exist → treat as no
  token; fall through.
- Cross-check the extracted name + mobile from the new pages against the
  appointment's citizen. On mismatch → **do not merge** (see Q2 policy
  below); log `TOKEN_MISMATCH_REJECTED` event and fall through to normal
  create.
- Compare page counts (see rule below):
  - **New pages > current attachments** → attach + re-summarise
    (`RESUMMARISED_WITH_MORE_PAGES` event).
  - **New pages ≤ current attachments** → attach only
    (`PAGES_ADDED` event). No Gemini re-run. PA can click "Re-run AI" on
    the ticket if they eyeball a diff.
- In both cases: no new ticket, no new SMS to the citizen. The existing
  ticket carries the full history.
- The `AiUpload` row itself doesn't become its own appointment — it just
  points at the primary via `merged_into_appointment_id` for audit.

### Page counting rule

Count truthfully — an image is 1 page, a PDF is its embedded page count.
Rationale: the "more content" heuristic is a proxy for "new info". Same
count is USUALLY same content, but not always — hence the PA "Re-run AI"
escape hatch on the ticket.

## Open policy decisions (answer before coding)

- **Q1 — Ministry flip after re-summarisation.** If the enriched summary
  changes the ministry (e.g. transfer → energy), do we:
  - (a) auto re-route (unassign, follow new AI ministry),
  - (b) **keep current routing, flag the classification change to PA** *(recommended)*,
  - (c) freeze classification once a human has touched it?
- **Q2 — Token mismatch (name/mobile on new pages doesn't match the
  token's stored citizen).** Do we:
  - (a) refuse merge and create a new ticket,
  - (b) **queue for PA review with both records side-by-side** *(recommended)*,
  - (c) merge anyway and log a warning?

## Edge cases we've enumerated

### Should merge, naive dedup misses
- Citizen forgot to write the token → Layer 2 (mobile match) territory,
  deferred
- Different name script (Latin vs Tamil, initials vs full)
- Mobile differs between QR OTP and hand-written scan
- Multiple partial visits (scan → scan → scan for the same case)
- Time gap of days-to-weeks — still the same case

### Should NOT merge, naive dedup wrongly merges
- Same citizen, genuinely different grievance
- Two people from same school with near-identical petitions (each is
  a distinct petitioner)
- Association / union petition with many signatures (one ticket, not N)

### Token found, but something's off
- OCR typo (`TKN12345` → `TKN12354`)
- Photocopied someone else's slip (adversarial)
- Token appears in the *body* of the petition, referencing an old case —
  not the header
- Multiple tokens on one page (family bringing petitions for grandparent
  + self)
- Partial-match OCR (last digit unreadable) → treat as no token

### Content changes classification
- QR page looked like a transfer request → routed to School Ed
- Full doc reveals it's really about EB bills for staff quarters →
  ministry should be Energy
- Re-summarisation must be allowed to change ministry (see Q1)

### Race conditions
- Citizen QR submits at 10:00, walks in at 10:15 while original AI is
  still `PROCESSING`. Layer 1 lookup must include appointments in
  `PROCESSING` state, not just `DONE`.
- Two staff scan the same physical petition into AI Uploads back-to-back.
  Fingerprint (Layer 3, deferred) would catch it — for Layer 1 alone,
  token match on the second submission just merges into the first.

### Operational
- PA already edited the summary/category on the original ticket. Re-run
  must NOT clobber those overrides. Store PA overrides separately and
  re-apply after each AI run.
- Old `GrievanceSummaryRecord` stays with `is_latest=False` — this
  already works today; the timeline shows what changed.
- Citizen brings a *different* full petition (changed their mind about
  what to complain about) → PA sees divergence on re-summary, splits
  manually.

### Adversarial (low volume, non-zero)
- Deliberately writing a stranger's token to attach a bogus doc →
  name/mobile cross-check catches it (see Q2).
- Duplicate submission for gaming SLA or attention → Layer 3 fingerprint
  audit territory, deferred.

## Data-model impact (Layer 1 only)

- `AiUpload` gets `merged_into_appointment_id: int | null` — points at
  the primary appointment when this upload was absorbed instead of
  becoming its own ticket.
- No `parent_appointment_id` on `Appointment`. Kept simple: one
  appointment, many attachment rows, one summary that gets re-run when
  needed. Merges live on `AiUpload`, not `Appointment`.
- New ticket event types:
  - `PAGES_ADDED` — token match, attached only, no re-summary
  - `RESUMMARISED_WITH_MORE_PAGES` — token match, more pages, AI re-ran
  - `TOKEN_MISMATCH_REJECTED` — token found but citizen mismatch
  - `AI_RECLASSIFIED` (optional) — new AI run produced a different
    ministry / category from the previous run
- Blind-index on mobile already exists. Not used in Layer 1 lookup path;
  reserved for Layer 2 when we get there.

## Rough size estimate

- Front-page token OCR call: ~50 lines
- Merge-and-re-summarise path in `ai_upload_service._build_case`:
  ~80 lines (with the page-count rule + override preservation)
- `merged_into_appointment_id` column: 1 migration
- QR receipt + SMS token-instruction copy: ~20 lines across
  `form.jinja2` + `notification_adapter`
- PA "Re-run AI" ticket action: ~40 lines backend + 30 lines frontend
- New ticket event types + drawer rendering: ~20 lines each

Total: ~1 focused day of work once Q1 and Q2 are decided.

## What blocks starting

1. Field research: watch a real week of QR-to-follow-up, count how many
   citizens actually write the token when instructed.
2. Answer Q1 + Q2 policy questions above.
