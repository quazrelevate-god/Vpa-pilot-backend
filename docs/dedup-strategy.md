# Deduplication — what shipped

> Layered defence-in-depth against duplicate submissions across the three
> intake pipelines. Every layer is deterministic and testable; no ML,
> no vector search, no external services. The reviewer is always the
> final authority — no auto-merge, no auto-refuse of possibly-legitimate
> re-submissions.

**Status:** live in prod as of commit range `f7bdb1a..1c82450` (see
[Commit history](#commit-history) at the bottom).

**Coverage matrix:**

| Pipeline | Ingress phone-window | Layer 1A file hash | Layer 1B fingerprint | Layer 2 Find Similar | Drawer pill |
|---|:-:|:-:|:-:|:-:|:-:|
| **Petition** — QR form | ✅ `ONE_PETITION_PER_DAY` (pre-existing) | N/A (typed form) | (via petition_merge_service on approve) | ✅ existing petition_merge_service | (existing) |
| **Petition** — AI upload | N/A (no phone at intake) | ✅ | (via petition_merge_service on approve) | ✅ existing petition_merge_service | (existing) |
| **Proposal** — public form | ✅ `ONE_PROPOSAL_PER_DAY` | N/A (form path) | ✅ | ✅ | ✅ |
| **Proposal** — AI upload | N/A (no phone) | ✅ | ✅ | ✅ | ✅ |
| **Association** — AI upload only | N/A (no form) | ✅ | ✅ | ✅ | ✅ |

---

## The four layers, top to bottom

The system stacks four independent checks, each catching a different flavour
of duplicate. Each layer is cheap on its own, and together they cover the
common cases with the reviewer as the final backstop.

### Layer 1 — Ingress phone-window (24h)

**Where:** at form submit, BEFORE any storage write, BEFORE any Gemini call.

- **Petition (QR form):** `ONE_PETITION_PER_DAY` env flag, default `True`.
  A phone that already submitted a petition today gets HTTP 409 with an
  EN/TA "please try tomorrow" message. Existed before this dedup work; used
  as the model for the new proposal-side guard.
  - Code: [`backend/src/services/appointment_service.py`](../backend/src/services/appointment_service.py)
    (search for `ONE_PETITION_PER_DAY`)
- **Proposal (public form):** `ONE_PROPOSAL_PER_DAY` env flag, default `True`.
  Same pattern — `Citizen.mobile_index` blind HMAC lookup within a 24-hour
  window. Message includes EN + TA strings so the applicant-facing page can
  render the right locale.
  - Code: [`backend/src/services/proposal_service.py:create_submission`](../backend/src/services/proposal_service.py)
  - Config: `backend/src/core/config.py` (both flags)

**Why it's the first line of defence:** deterministic, no false positives
(same phone in same day = almost always a retry), and it never touches
storage/Gemini so it costs nothing when it fires. Env-gated so QA can
disable in dev to iterate.

**What it does NOT catch:** different phones from the same person, or the
same person coming back tomorrow. Those layers below handle it.

---

### Layer 1A — File hash at AI upload intake (HARD REFUSE)

**Where:** `ai_upload_service.create_batch` at upload time.

- Every uploaded file's SHA-256 is computed BEFORE it lands in MinIO.
- Lookup against `ai_uploads.file_hash` (indexed column, migration 057).
- Two skip cases:
  1. Hash matches an earlier `ai_uploads` row → response `skipped[]` entry
     tags `reason: "duplicate_file"` + carries the original batch id +
     ticket number so the toast can say "already in batch X, ticket Y".
  2. Same hash appears twice within the SAME upload batch → tagged
     `reason: "duplicate_in_batch"` + carries the earlier filename. Closes
     the loophole where two identical files in the same POST would both
     flush before we could see each other via the DB.

Skipped files never write to storage. Response body grew to include:

```json
{
  "batch_id": "...",
  "count": 12,          // successfully created
  "items": [...],
  "skipped": [
    {"filename": "..pdf", "reason": "duplicate_file",
     "original_upload_id": 123, "original_batch_id": "...",
     "original_ticket_number": "TKT-2026-00023"}
  ],
  "skipped_count": 1
}
```

**Why hard-refuse (not soft-flag) at Layer 1A:** exact byte-for-byte match
= the same file. There's no legitimate reason to accept it a second time;
Gemini would extract the same brief, we'd get a duplicate ticket, and the
reviewer would waste a decision. The UX (toast telling the PA which
ticket the file already lives on) is more useful than a silent duplicate.

**What it catches:** drag-same-folder-twice, forwarded PDF that's already
been uploaded, re-uploaded batch after an error, exact re-scans that
produce identical bytes.

**What it does NOT catch:** re-scanned physical page (bytes differ),
edited PDF that's semantically identical, translations of the same
document. Those are Layer 1B / Layer 2 territory.

Code: [`backend/src/services/ai_upload_service.py:create_batch`](../backend/src/services/ai_upload_service.py)

---

### Layer 1B — Post-extraction fingerprint (SOFT FLAG, 90-day window)

**Where:** immediately after Gemini extraction completes, in each
pipeline's worker.

- **Proposal:** `fingerprint = sha1( org_name | title | problem_statement )`
  - Applied in `proposal_service._process_one` after `svc.extract(...)`
- **Association:** `fingerprint = sha1( association_name | association_ask )`
  - Applied in `association_service.create_from_extraction`
- Both use the SAME normalisation helper: lowercase, strip
  punctuation/whitespace runs, keep Latin + Tamil + digits.
- Lookup: any earlier row (excluding self) with the same fingerprint whose
  `created_at >= now() - 90 days`. Match sets:
  - `is_duplicate = True`
  - `duplicate_of_id = <earlier_row.id>` (BigInteger, NOT a FK — hard
    delete of the original doesn't cascade this away; API tolerates the
    dangling case gracefully).

**Never auto-refuses.** A slightly-edited legitimate re-submission must
still be reviewable. The drawer surfaces the flag as an amber
"Suspected duplicate of X" pill; the reviewer decides.

**Fingerprint properties verified via a probe matrix:**

| Variant | Same fingerprint? |
|---|---|
| Baseline | — |
| Trailing period / exclamation | ✅ same |
| ALL CAPS | ✅ same |
| Leading / trailing whitespace | ✅ same |
| Doubled internal spaces | ✅ same |
| Punctuation between every word | ✅ same |
| Tamil script version of same content | ❌ different (correct — different fingerprint per script) |
| Same name, different ask | ❌ different |
| Different name, same ask | ❌ different |

The 90-day window is a compromise: catches quarterly re-submissions and
forwarded-around copies; misses "same union files every anniversary"
type cases (which is probably fine — policy environment shifts within a
year).

**Why soft (not hard):** deterministic exact-fingerprint hit is a
STRONG signal but not certain — a template letter that many bodies
copy verbatim would produce identical fingerprints from different
sources. Hard-refuse would silently drop legitimate submissions. The
drawer pill lets the reviewer confirm.

Code:
- [`backend/src/services/proposal_service.py`](../backend/src/services/proposal_service.py) — search `_proposal_fingerprint`
- [`backend/src/services/association_service.py`](../backend/src/services/association_service.py) — search `_association_fingerprint`

---

### Layer 2 — Reviewer-triggered Find Similar (fuzzy)

**Where:** on-demand from the drawer, when the reviewer clicks the
"Find similar" button in the header or opens a Layer-1B-flagged row.

- **Endpoints:**
  - `GET /api/v1/admin/proposals/{id}/similar`
  - `GET /api/v1/admin/associations/{id}/similar`
- **Bucketing:**
  - Proposal → same desk (category).
  - Association → same category + district (NULL-tolerant — unknown-
    district source only matches other unknown-district candidates, so a
    Chennai body never sweeps up a Madurai one).
- **Scoring:** trigram Jaccard on the normalised ask/problem_statement.
  Same normalisation helper as Layer 1B.
- **Response shape:**
  ```json
  {
    "source": { "id": 19, "association_name": "...", "category": "action_required", ... },
    "candidates": [
      { "id": 18, "association_name": "...", "score": 0.839, "status": "AWAITING_REVIEW", ... }
    ],
    "reason": null
  }
  ```
  `reason` is populated with a human-readable message when
  `candidates` is empty ("No similar associations found in this
  category / district.", "No extracted ask yet to compare against.").

**Performance:**
- Column projection: SELECT only the scoring + display columns and
  extract the ask fields directly from JSONB in SQL — a full row load
  with `extraction_json` blobs would push per-request payloads past
  2 MB and time the endpoint out at 30 s.
- Safety cap: 500 candidates per scan, ordered newest-first.
  Measured wall time: ~2.0 s at 500 rows (fine for a manual click).
  If a bucket ever holds thousands, pg_trgm + GIN is the right next
  step — documented inline where the cap is set.

**Why fuzzy (not exact-fingerprint) at Layer 2:** the deterministic
layers already caught the obvious cases. Layer 2 catches reworded
pitches, minor edits, translation drift — matches Layer 1B missed
because the fingerprint doesn't collide on cosmetic changes to the
text.

Code:
- Proposal: [`backend/src/services/proposal_service.py:find_similar_proposals`](../backend/src/services/proposal_service.py)
- Association: [`backend/src/services/association_service.py:find_similar_associations`](../backend/src/services/association_service.py)

---

## Drawer UX

The reviewer sees the dedup state in the drawer's HEADER row, alongside
the status / AI-triage pills. No scrolling required to notice a
suspected duplicate.

- **When Layer 1B pre-flagged the row (`is_duplicate=true`):**
  - Amber pill in the header: **"Suspected duplicate of X"**.
  - Pill is a BUTTON — clicking scrolls to the Duplicate Check section
    and expands the panel.
  - The Layer-2 scan **auto-fires on drawer open** so the count badge
    (e.g. "…முன்னணி 1") appears next to the pill without a click.
- **When Layer 1B did NOT flag the row:**
  - A neutral "Find similar" button sits next to the AI-triage pill in
    the same header row.
  - Scan runs only on click — no cost to opening unrelated drawers.
- **Panel body:** Section 7 (association) / Section 8 (proposal),
  titled **Duplicate check**. Shows loading spinner → candidates with
  amber score pill (e.g. "84%") + name + metadata line +
  "Open →" link that opens the candidate in a new tab.
- **Dangling `duplicate_of_id`** (deleted original) → API returns 200
  with `duplicate_of_name=null`; pill degrades to just "Suspected
  duplicate" (no "of undefined"). Verified with a seeded FK to 99999.

State is lifted to the drawer component so the header pill + section
body always agree — one source of truth for loading/candidates.

Code:
- [`PA portal/frontend/src/app/(dashboard)/proposal-review/_lib/ProposalDrawer.tsx`](../PA%20portal/frontend/src/app/(dashboard)/proposal-review/_lib/ProposalDrawer.tsx) — search `SimilarProposalsPanel`
- [`PA portal/frontend/src/app/(dashboard)/association-review/_lib/AssociationDrawer.tsx`](../PA%20portal/frontend/src/app/(dashboard)/association-review/_lib/AssociationDrawer.tsx) — search `SimilarAssociationsPanel`

---

## Schema — migration 057

Additive, indexed, backwards-compat (every column nullable or defaulted).

```
ai_uploads:
  + file_hash         VARCHAR(64)     nullable, indexed

proposal_submissions:
  + dedup_fingerprint VARCHAR(40)     nullable, indexed
  + is_duplicate      BOOLEAN         NOT NULL DEFAULT false
  + duplicate_of_id   BIGINT          nullable, indexed  (NOT a FK)

association_submissions:
  + dedup_fingerprint VARCHAR(40)     nullable, indexed
  + is_duplicate      BOOLEAN         NOT NULL DEFAULT false
  + duplicate_of_id   BIGINT          nullable, indexed  (NOT a FK)
```

**Why `duplicate_of_id` is NOT a foreign key:** we hard-delete rows in
some maintenance paths (see `migrate_associations_from_petitions.py`).
An FK would either block those deletes or `SET NULL` the flag away
silently. Plain BigInteger + graceful null-name handling in the API is
the pragmatic pick.

**Config flags** (`backend/src/core/config.py`):
```
ONE_PETITION_PER_DAY: bool = True     # pre-existing
ONE_PROPOSAL_PER_DAY: bool = True     # new
```

**Migration file:** `backend/alembic/versions/057_dedup_columns.py`

---

## What this deliberately does NOT do

- **No auto-merge.** Layer 2 shows candidates; the reviewer decides.
  The existing `petition_merge_service` on the petition side offers
  explicit merge; the association / proposal sides don't have merge
  yet (each row is its own decision record).
- **No ML / vector search.** Trigram Jaccard + fingerprint sha1 —
  cheap, deterministic, debuggable, no external service.
- **No cross-pipeline dedup.** A proposal isn't checked against
  associations; the classifier routes documents to the correct
  pipeline before extraction. Cross-pipeline would add surface area
  for zero real benefit.
- **No auto-refuse on Layer 1B / Layer 2.** Only Layer 1A
  (byte-identical file) and Layer 1 (same-phone-in-24h) hard-refuse.
  Everything else is a hint for the reviewer.

---

## Known limitations & future work

- **Same-second race on Layer 1B.** Two Gemini extractions completing in
  the same second could both flag each other (or neither) depending on
  transaction interleaving. In practice extractions serialize through
  a single-worker queue per surface, so real-world probability is very
  low. Not tested; documented for future hardening.
- **Layer 2 perf ceiling.** 500 candidates per scan capped at ~2 s in
  Python. Beyond ~1000-2000 rows per bucket, migrate to pg_trgm + a
  GIN index and do the fuzzy match in the database. The 500-row cap
  ordered newest-first keeps the most actionable candidates surfaced
  until then.
- **Association `suggested_department`.** Layer 1B fingerprint is
  content-only (name + ask). If two identical asks come from
  different bodies in the same district, they will collide. This is
  usually desirable (probably a template letter passing around) — but
  the reviewer should sanity-check the association_name in the pill.
- **Fingerprint window is 90 days.** Configurable per call (`_DEDUP_WINDOW_DAYS`
  in each service) but not env-driven yet — if the office wants a
  different window in prod, promote to a `settings.` field.
- **Layer 1B is content-only.** Doesn't consider org / phone /
  representative. A single body legitimately submitting several
  distinct proposals stays uncollided (different titles / problem
  statements → different fingerprints).

---

## Commit history

Layer 1 batch:
- **`f7bdb1a`** `feat(dedup): Layer 1 dedup across AI upload + proposal form + association`
  - Migration 057, models, Layer 1A (file hash), Layer 1 (proposal
    phone-window), Layer 1B (fingerprint), drawer pills.

Layer 2 batch:
- **`9919816`** `feat(dedup): Layer 2 — reviewer-triggered Find Similar on both surfaces`
  - `find_similar_*` services + endpoints + basic drawer panel.

Edge-case + UX follow-up:
- **`1c82450`** `fix(dedup-ux): Find Similar in header + auto-scan when Layer 1B flagged + perf cap + JSONB-in-SQL column selection`
  - Header-placed button, auto-scan on 1B-flagged rows, dangling-FK
    graceful degrade verified, 500-row perf cap, JSONB-in-SQL column
    projection.

---

## Quick reference — where to look

| Concern | File |
|---|---|
| Migration | `backend/alembic/versions/057_dedup_columns.py` |
| ORM columns | `backend/src/models/ai_upload_models.py`, `proposal_models.py`, `association_models.py` |
| Layer 1A | `backend/src/services/ai_upload_service.py:create_batch` |
| Layer 1 phone-window (proposal) | `backend/src/services/proposal_service.py:create_submission` |
| Layer 1B fingerprint (proposal) | `backend/src/services/proposal_service.py` search `_proposal_fingerprint` |
| Layer 1B fingerprint (association) | `backend/src/services/association_service.py` search `_association_fingerprint` |
| Layer 2 (proposal) | `backend/src/services/proposal_service.py:find_similar_proposals` |
| Layer 2 (association) | `backend/src/services/association_service.py:find_similar_associations` |
| Layer 2 endpoints | `backend/src/api/v1/proposal_review.py`, `association_review.py` (`/similar` routes) |
| Config flags | `backend/src/core/config.py` — `ONE_PETITION_PER_DAY`, `ONE_PROPOSAL_PER_DAY` |
| Drawer UX (proposal) | `PA portal/frontend/src/app/(dashboard)/proposal-review/_lib/ProposalDrawer.tsx` |
| Drawer UX (association) | `PA portal/frontend/src/app/(dashboard)/association-review/_lib/AssociationDrawer.tsx` |
| Frontend API wrappers | `.../_lib/proposalApi.ts`, `.../_lib/associationApi.ts` (`findSimilar*`) |
| Petition-side merge (pre-existing) | `backend/src/services/petition_merge_service.py` |
