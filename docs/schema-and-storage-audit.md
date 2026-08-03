# Schema & MinIO Storage — Deep Audit

**Companion to** [production-go-live-review.md](./production-go-live-review.md) — that document flagged schema and storage issues briefly; this one goes deep on both.
**Scope:** every SQLAlchemy model, every migration, and every call into `storage_service`. Vertex-specific columns/config are out of scope per standing rule.

The verdict up front: the schema is *working* — it holds 3000+ live rows, migrations chain cleanly through 044, and the encryption model is thoughtful. But it's carrying real technical debt from an unfinished v1→v2 cutover, and the storage layer is missing several production-grade guards (orphan cleanup, at-rest encryption, connection re-use). None of this stops launch; it will bite in month 1–6 unless someone on the maintenance team is holding the whole picture.

---

## 1. Schema — Findings

### S-1. PK type incoherence (`Integer` vs `BigInteger`)
`Citizen.id`, `Appointment.id`, `AppointmentAttachment.id`, `AppointmentSlot.id`, `ReferralBooking.id`, and `MLA.id` are 32-bit `Integer` (max 2.1B). Everything else — `Activity`, `AiUpload`, `Ticket`, `OTPVerification`, `Login`, `ProposalSubmission`, `AssociationSubmission`, `InvitationEvent`, `GrievanceSummaryRecord` — is 64-bit `BigInteger`. Files: [appointment_models.py:103, :138, :278](../backend/src/models/appointment_models.py#L103) etc.

The tell that it's an oversight, not a decision: **`AppointmentAttachment` has both** `appointment_id: Integer` (FK to `appointment.id`) and `ticket_id: BigInteger` (FK to `ticket.id`) in the same row. One table can't decide which world it lives in.

At current volume (3000/year), the 2.1B ceiling on `Integer` is a non-issue for decades — but the inconsistency will trip anyone joining these tables outside the ORM (analytics queries, one-off scripts, a BI tool). And the migration from Int → BigInt is a `pg_repack`-style dance you don't want to run under load.

**Recommendation:** if you're going to fix it, fix it before the tables get very big. If you're not, put a comment on `Citizen` and `Appointment` explicitly stating the decision so the next dev doesn't second-guess it.

### S-2. Unfinished v1→v2 schema bridge
Migration `025_v2_normalized_schema_cutover.py` was the big cut. It landed the normalised lookup tables (`admin_lookup`, `status_id`/`priority_id`/`category_id` FK columns) but **left the original VARCHAR columns in place as "bridge columns"**:

- `Appointment.status` (VARCHAR) + `Appointment.status_id` (BigInt FK) — [appointment_models.py:207–212](../backend/src/models/appointment_models.py#L207)
- `Appointment.grievance_category` (`category` VARCHAR) + `Appointment.category_id` (BigInt FK) — [line 204, 214](../backend/src/models/appointment_models.py#L204)

Comments explicitly acknowledge this: `# Bridge column — v1 services still write this; v2 uses status_id`. That means every write has to keep both in sync, and every read has to pick a side. Analytics might read the VARCHAR while the workflow flips the id. This is a landmine that grows every month it isn't finished.

**Recommendation:** either finish the cutover (retire the VARCHAR columns, one migration per column, guarded by a code sweep) or explicitly retire the v2 ids as YAGNI and drop them. Do not ship handoff with both alive — the next dev will not have the context to keep them consistent.

### S-3. Encryption boundary is inconsistent across tables
[`Citizen.encrypted_name`](../backend/src/models/appointment_models.py#L105) is Fernet. [`GrievanceSummaryRecord.name_en` / `name_ta`](../backend/src/models/grievance_summary_record.py) hold the *same names, plaintext*. A malicious DB read of the summary table bypasses the encryption entirely.

Same pattern:
- `Appointment.encrypted_grievance` (Fernet) vs `Appointment.encrypted_transcript` (Fernet). ✓ consistent.
- `Citizen.encrypted_mobile` (Fernet, blind-indexed via `mobile_index` HMAC) vs `ProposalSubmission.email_enc` + `phone_enc` (Fernet, `phone_index`). ✓ consistent.
- `Appointment.encrypted_name_ta` (Fernet, per-appointment PA-entered Tamil name) — encrypted here but the same Tamil name in `GrievanceSummaryRecord.name_ta` is plaintext. Contradiction.

Also: **`Citizen.encrypted_name` uses `Text`**, **`Citizen.encrypted_mobile` uses `String(512)`**. Both are Fernet ciphertext; both should be `Text` (Fernet output length is `≈ 4/3 × plaintext + overhead`, unbounded).

**Recommendation:** decide the PII policy explicitly — one row in a design doc — and enforce it everywhere. Either encrypt the GsR name columns and add a matching `_index` for search, or document why the summary copy is redacted-by-Gemini-and-therefore-safe.

### S-4. No CHECK constraints on enum-like VARCHARs
Every "enum" column is a bare `VARCHAR` with the valid values only enforced in Python:

- `Ticket.priority` (`VARCHAR(20)`, migration 031 widened from 5) — flagged in main review.
- `Appointment.status` (`VARCHAR(20)`) — `TICKET_STATUSES` tuple lives in [appointment_models.py:21](../backend/src/models/appointment_models.py#L21) but Postgres never checks.
- `Appointment.summary_status` / `Appointment.transcript_status` — free-text.
- `AiUpload.status`, `ProposalSubmission.status`, `AssociationSubmission.status`, `InvitationEvent.status` — all free-text.
- `Login.role`, `UserRole.role`.

A typo in application code writes an invalid value, no CI/CD catches it, and the analytics dashboard silently drops those rows because its WHERE clause filters on known values. This is exactly the "silent data corruption at 6 months in" pattern.

**Recommendation:** add a `CHECK (status IN (...))` constraint on each — a one-migration change per table, and Postgres refuses bad writes at the door. Better yet, promote each to a real enum table (`ticket_status` with FKs), which also gives you translations and metadata for free.

### S-5. Missing partial index for the STT drain loop
[`Appointment.summary_pending` partial index exists at line 269](../backend/src/models/appointment_models.py#L269): `WHERE summary_status IN ('PENDING','PROCESSING')`. The courtesy STT drain loop runs the same query shape on `transcript_status` every 5 minutes ([main.py:305](../backend/src/main.py#L305)) but there's **no matching partial index on `transcript_status`**. At current volume, a full-table scan is cheap; at 6-figure appointments, this loop becomes a bottleneck and floods pg_stat_statements.

**Recommendation:** add a partial index on `(transcript_status)` where `transcript_status IN ('PENDING','PROCESSING')` — one migration, immediate perf improvement, no downside.

### S-6. No `deleted_at` — everything is a hard delete
The cascade rules on `Citizen → Appointment → Ticket → Attachment` are `ondelete='CASCADE'`. Delete a citizen (super-admin does this, e.g. GDPR-equivalent request) and every downstream row is gone permanently. No audit trail of the deletion, no undo, no way to answer "who deleted appointment #4321 and when".

For a Minister's office with real audit obligations (RTI queries look backward months later), this is a policy risk. Compare to the existing `Activity` table pattern — you already have a unified audit log, but deletions bypass it.

**Recommendation:** add `deleted_at: DateTime | None` on `Appointment`, `Ticket`, `ProposalSubmission`, `AssociationSubmission`, `InvitationEvent`. Change every application read to filter `WHERE deleted_at IS NULL`. Change delete endpoints to `UPDATE ... SET deleted_at = now()`. Emit an Activity row for the deletion. A background job hard-deletes rows older than N days if legal ever requires it.

### S-7. `ONE_PETITION_PER_DAY` has a TOCTOU race window
[appointment_service.py:466–474](../backend/src/services/appointment_service.py#L466) — `SELECT COUNT` then `INSERT`. Two concurrent submits from the same mobile in the same second slip through: both see count=0, both insert. The OTP flow narrows the window (each submit needs its own valid OTP), and rate limiting narrows it further, but it's still open.

**Recommendation:** enforce at the DB — add a partial UNIQUE index `(citizen_id, DATE(created_at)) WHERE status != 'CANCELLED'`. Postgres rejects the second insert with an integrity error the code can turn into the same HTTP 409. Then the Python check becomes an early-friendly-message optimisation, not the correctness gate.

### S-8. Attachment MinIO orphans on cascade delete
`Citizen → Appointment → AppointmentAttachment` cascades DB-side. **`storage_service.delete_file` is not called anywhere in this path** — the DB rows are gone but the MinIO objects live forever. Same for `Ticket → TicketAttachment`, `ProposalSubmission → documents` (JSONB, so worse — the pointer is lost with the row), `InvitationEvent → image_path`.

Only two call sites clean up:
- [ai_upload_service.py:963](../backend/src/services/ai_upload_service.py#L963) — batch delete flow
- [event_service.py:927](../backend/src/services/event_service.py#L927) — event delete

Every other delete strands objects. At 3000/year with an average 5 attachments each, MinIO grows by ~15k objects/year uncleanable.

**Recommendation:** hook the ORM `before_delete` event on `AppointmentAttachment` / `TicketAttachment` / `InvitationEvent` / `ProposalSubmission` to call `delete_file` (wrapped in `asyncio.to_thread`). Or, if you adopt soft-delete (S-6), schedule a nightly job that reconciles: for every soft-deleted row with `deleted_at < now() - N days`, `delete_file` on the attachment then hard-delete.

### S-9. Waiting-queue denormalization is race-prone
`Appointment.queue_position` (Integer) and `waiting_since` (DateTime) are on the main table. Every write that changes queue order has to rewrite N rows. Under concurrent walk-in submissions this is either serialised (slow) or racy (queue positions collide).

The `WAITING → CALLED → IN_MEETING` state machine appears to work correctly today at low volume; at scale this is where the queue "loses" a citizen.

**Recommendation:** either serialise the queue transitions behind an advisory lock (`pg_advisory_xact_lock(queue_venue_hash)`) or move the queue into a dedicated `waiting_queue(id, appointment_id, position, entered_at)` table that can be reasoned about atomically. Don't leave this to hope-and-hot-path.

### S-10. `Text` used everywhere instead of `String(N)` for size-bounded fields
Grep the models — `Text` is used for `encrypted_grievance`, `encrypted_name`, `encrypted_transcript`, `encrypted_name_ta`, `storage_url`, `original_filename`. Fernet ciphertext (`encrypted_*`) legitimately needs `Text` (unbounded). But `storage_url` and `original_filename` should be bounded (`String(500)` / `String(255)`), since a `Text` column allows a hostile client to jam gigabytes in there.

**Recommendation:** cap `storage_url` at 500 and `original_filename` at 255. Validate at the app boundary too (existing sanitiser already limits — just belt-and-braces).

---

## 2. Schema — Optimizations

### O-1. Composite indexes for hot dashboard queries
Analytics filter on combinations like `(status, created_at)`, `(ministry, district, created_at)`, `(priority, status, assigned_to)`. Current model has *per-column* indexes on `status`, `created_at`, `ministry`, `district`. Postgres can bitmap-and these, but a matching composite index is materially faster on the specific query.

Run this in production to see what the planner actually chooses:
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... -- your hottest analytics query
```
If you see `Bitmap Heap Scan` reading a lot of buffers, that's your candidate.

Likely wins:
- `CREATE INDEX ON ticket (status, assigned_to, created_at DESC)`
- `CREATE INDEX ON grievance_summary_records (ministry, district, created_at DESC) WHERE is_latest`
- `CREATE INDEX ON appointment (status, source, created_at DESC)`

### O-2. Consider table partitioning at 6-figure row counts
Not today. But `Appointment`, `Ticket`, and `Activity` will grow monotonically. At ~50k appointments (~15 years at current pace, but sooner if adoption grows), monthly `RANGE PARTITION` on `created_at` becomes worth it — analytics queries prune to one partition, retention/deletion is a `DROP PARTITION`.

**Recommendation:** not a launch task; add to the "reconsider at 50k rows" runbook item.

### O-3. `extraction_json` (JSONB) — index the fields you query
Both `ProposalSubmission.extraction_json` and `AssociationSubmission.extraction_json` are JSONB. If the review dashboard ever filters on nested fields (`extraction_json->>'title'`, priority, category), add a GIN index on the whole column or expression indexes on the hot fields.

### O-4. `NUMERIC` for money / hours; not `Float`
Not currently observed as a bug, but if any future column stores currency (cost estimates in proposals?) use `Numeric(12, 2)`, never `Float`. Same for cumulative counters. Add to the code-review checklist.

### O-5. `pg_stat_statements` + `auto_explain`
Enable both in production Postgres. `pg_stat_statements.max = 10000`, `track = all`. The first month of production data tells you your actual hot queries, not our guesses. Zero code changes.

---

## 3. Schema — Alternative approaches

### A-1. Finish v1→v2 (S-2) — my strongest recommendation
Every week you carry both columns compounds. A three-hour focused session — one migration per bridge column, guarded by a codebase sweep — retires the debt. Do it before handoff or the next dev inherits the choice of "fix or leave alone" without the context to decide.

### A-2. Promote enum columns to real enum tables (S-4)
Instead of `Ticket.priority: VARCHAR(20)` with an application-side tuple, add a `ticket_priority` table: `(id, key, label_en, label_ta, sort_order, is_active)`, and `Ticket.priority_id BIGINT FK`. Benefits:
- Postgres enforces validity.
- Translations live with the data.
- Adding "P0.5" is a row insert, no migration.
- Analytics group-by is faster on int than varchar.

Same shape for status, category, ministry, closure_reason. You already have `admin_lookup` half-doing this — finish it.

### A-3. Adopt soft-delete + Activity coverage as first-class (S-6)
Every mutation on a first-class entity (`Appointment`, `Ticket`, `Proposal`, `Association`, `Login`) writes to `Activity`. Deletions become `UPDATE deleted_at`. Reads filter `WHERE deleted_at IS NULL`. A dashboard "show deleted" flag exposes them to super_admin. This is the pattern audited government systems converge on — worth adopting once, not per-table.

### A-4. Alembic autogenerate + a type check in CI
44 migrations by hand is a lot. Alembic's `--autogenerate` compares the ORM against the DB and drafts a migration. Combined with `mypy` on the models, drift is caught at PR time. Costs a day to set up, saves the maintenance team many.

### A-5. Consider CDC → analytics warehouse (long-term)
Analytics queries run on the same Postgres that serves live traffic. At scale this becomes contention. `pg_bench`-y today; a problem in 6 months at 10× volume. When it hurts: enable logical replication → a read replica or a small warehouse (Metabase + DuckDB is enough for a Minister's office). Not a launch task; a "when the dashboard gets slow" task.

---

## 4. MinIO Storage — Findings

### T-1. `boto3` client not memoized
[storage_service.py:19–40](../backend/src/services/storage_service.py#L19) — `_get_client()` builds a fresh client on **every call**. Every `save_file`, `get_file_bytes`, `head_object`, `delete_file` re-parses config and re-negotiates the HTTPS session.

The client is thread-safe and cheap to hold long-term.

**Recommendation:** wrap in `functools.lru_cache(maxsize=1)`. One line, measurable p95 improvement on the dashboard file-server hot path (which fetches 5–20 objects per page load).

### T-2. `head_bucket` + `create_bucket` on every write
[storage_service.py:65–68](../backend/src/services/storage_service.py#L65) — every `save_file` does a HEAD round-trip to check the bucket exists, and creates it on 404. Once the bucket exists (day 1), this HEAD is pure overhead on the critical path of every upload.

**Recommendation:** move the bucket-exists check to a startup handler (in `main.py`). Fail loudly if the bucket can't be reached at boot. `save_file` then just does `put_object`.

### T-3. `delete_file` isn't `asyncio.to_thread`'d at ai_upload_service:963
[ai_upload_service.py:963](../backend/src/services/ai_upload_service.py#L963) — `if r.storage_url and delete_file(r.storage_url):` — blocking boto3 inside an async handler. Under bulk batch delete (N files), the event loop stalls for `N × network_rtt`.

Every other caller (event_service, proposal, appointment) correctly uses `asyncio.to_thread`. This is the one that got missed.

**Recommendation:** `await asyncio.to_thread(delete_file, r.storage_url)`. One-line fix.

### T-4. Orphaned MinIO objects on cascade delete
Same finding as S-8 from the schema side, viewed from storage: **the DB and MinIO are not consistent** on delete. Every path that deletes an attachment-owning row (except two — ai_upload batch delete and event delete) leaves the MinIO objects forever.

**Recommendation:** SQLAlchemy `before_delete` event on the attachment models that fires `delete_file` (see S-8). Belt-and-braces: a nightly reconciliation job (`SELECT storage_url FROM attachments UNION SELECT storage_url FROM ticket_attachments ... EXCEPT SELECT key FROM minio_ls()`) that reports drift.

### T-5. No server-side encryption on the bucket
The DB holds Fernet-encrypted PII. MinIO holds the raw uploaded files — PDFs, images, audio — which often contain the *same* PII in unencrypted form (Aadhaar photocopies, address proofs, handwritten grievances, voice recordings naming people/places). A stolen MinIO backup gives an attacker what the DB encryption is meant to protect.

**Recommendation:** enable MinIO server-side encryption at the bucket level (`mc encrypt set sse-s3 <bucket>`). Zero code changes. Every subsequent write is encrypted at rest. For files already present, run `mc mirror --encrypt-key` once to re-write them. Ops task, not code.

For higher assurance: client-side encryption in `save_file` (using the same Fernet key as the DB) — the app writes ciphertext, MinIO stores ciphertext, decryption happens at read. Downside: browsers can't ever stream directly from MinIO (which was already true here anyway, since everything is proxied). Upside: MinIO breach = zero PII loss.

### T-6. Content-type from browser is trusted
Every `save_file(..., content_type=mime)` passes through the browser-supplied MIME. A malicious client can upload an `.exe` as `image/jpeg`. The download endpoint then serves it as an image — modern browsers usually catch this with `X-Content-Type-Options: nosniff` (which you correctly set), but it's still a category-typo waiting to bite.

**Recommendation:** server-side sniff with `python-magic` (libmagic bindings) or `filetype` (pure Python). Reject if the sniffed type is not in the allow-list. Log the (declared, sniffed) mismatch for security review.

### T-7. File-key predictability varies by service
| Service | Key template | Random bits | Verdict |
|---|---|---|---|
| Event | `events/{token_hex(16)}{ext}` | 128 | ✓ safe |
| Proposal | `proposals/{tracking_ref}/{token_hex(6)}_{safe}` | 48 + tracking randomness | ✓ safe |
| AI upload | `ai_uploads/{batch_id}/{token_hex(6)}_{safe}` | 48 + batch_id | ✓ safe |
| Appointment audio | `attachments/{token_number}/audio_{yyyymmdd_hhmmss}_{token_hex(4)}.webm` | 16 | ⚠ token_number is date-derived; 16 bits is guessable |
| Appointment file | `attachments/{folder_id}/{safe_filename}` | depends on folder_id — verify | ? |

Today it doesn't matter — no path exposes MinIO directly, all reads go through the authenticated `/api/files/*` route. But defense-in-depth: if MinIO ever gets its own presigned URL flow (see T-9) or its bucket policy is misconfigured, key predictability becomes the whole security model.

**Recommendation:** standardise on 32 random hex chars (128 bits) for every attachment. Zero downside; consistent story for the security review.

### T-8. All files streamed through the backend app
Every download is proxied through FastAPI → app bandwidth doubles (upload IN + download OUT for the same file). At today's volume this is fine (dashboard file server: maybe 100 GB/month). At 10×, the app becomes the bottleneck; a horizontal scale-out doesn't help because the traffic is inherently sequential per file.

**Recommendation:** for large files (audio ≥ 5 MB), issue short-TTL presigned MinIO URLs and redirect the client. Keeps auth in-band (only authenticated callers get URLs) but offloads bandwidth. Requires ops to expose MinIO on an internet-reachable hostname with proper TLS — worth doing before file volume becomes painful, not after.

### T-9. No lifecycle policy on the bucket
MinIO supports lifecycle rules: "delete objects tagged `orphan` older than 30 days", "transition to cold storage after 90 days". Nothing configured. Every file lives forever, on hot storage, forever.

**Recommendation:** three rules in `mc ilm add`:
1. Delete anything under `tmp/` older than 24 h.
2. Transition anything under `events/` older than 1 year to cold storage.
3. Delete anything tagged `deleted` (paired with S-6 soft-delete) older than 90 days.

### T-10. No client-side retries on MinIO transient errors
boto3 has its own retry (`Config(retries={'max_attempts': 3})`) but the default `Config` in [storage_service.py:33](../backend/src/services/storage_service.py#L33) doesn't set it. On a MinIO restart or a transient network blip, the upload just fails.

**Recommendation:** add `retries={'max_attempts': 5, 'mode': 'standard'}` to the botocore Config. boto3 does exponential backoff for you.

---

## 5. Storage — Optimizations

### O-6. Memoize the boto3 client (see T-1)
Single biggest win, one-line change.

### O-7. Batch delete instead of per-object
When `delete_file` is called N times in a loop, that's N round-trips. `delete_objects` (plural) takes up to 1000 keys per request. Rework the ai_upload batch-delete + any future GC job to batch.

### O-8. Read-through cache for hot images (Minister's office logo, brand assets)
Static assets in `backend/assets/brand/` are served from local disk (fast) — good. If any brand image ever moves into MinIO, put nginx in front with a `proxy_cache` so MinIO isn't hit on every load.

### O-9. Multipart upload for large files
`put_object` uploads the whole blob in one HTTP request. For audio recordings up to 300 s (potentially 5–20 MB), a multipart upload with parallel parts is 2–4× faster on slow office uplinks. `boto3.s3.transfer.TransferConfig(multipart_threshold=5*1024*1024)` + `upload_fileobj` — minor refactor.

---

## 6. Storage — Alternative approaches

### B-1. Presigned URLs for downloads (T-8)
Trades a small amount of complexity for large bandwidth savings and horizontal scale. Auth stays in-band (the app issues URLs only to authenticated callers; TTL is 5 min); the actual byte transfer bypasses FastAPI.

### B-2. Client-side encryption of PII uploads (T-5, stronger)
Encrypt at `save_file` boundary, decrypt at `get_file_bytes`. MinIO holds ciphertext only. Cost: no browser-direct streaming, but you're not doing that anyway. Benefit: MinIO breach = zero data loss.

### B-3. Move all durable-worker file writes into a dedicated worker pool
Right now file writes and Gemini calls share the same async runtime. A slow MinIO stalls the request handler. Split the responsibilities: request handlers only enqueue; a dedicated worker pool (or the Arq/Celery migration from the main review) does the file write + AI extraction. Cleaner failure boundaries.

### B-4. CDN in front of MinIO for public assets
Not today — nothing is public. If any surface ever exposes citizen-facing images (a public proposal gallery? a Minister press page?), fronting MinIO with a CDN is table stakes at scale.

### B-5. WORM (Write-Once, Read-Many) for legal-hold files
MinIO supports object locking. If any file becomes legally sensitive (a proposal under formal review, an approved appointment record with audit obligations), locking it prevents delete-under-orphan-cleanup and delete-by-mistake. Consider tagging + lock policy tied to the DB workflow state.

---

## 7. Prioritised action plan

Aligned with the main review's 30-day plan:

| Week | Deliverable | Effort |
|---|---|---|
| **Pre-launch** | T-3 (async wrap on ai_upload delete), T-5 (enable MinIO SSE — ops), S-7 (add UNIQUE partial index for one-petition-per-day) | ½ day |
| **Week 1** | T-1 (memoize client), T-2 (startup bucket check), T-10 (boto3 retries), S-5 (transcript partial index) | 1 day |
| **Week 2** | S-8 / T-4 (before_delete cleanup on attachments), T-9 (lifecycle policy — ops) | 2 days |
| **Week 3** | S-4 (CHECK constraints on enum columns), O-1 (composite indexes from `pg_stat_statements` findings) | 2 days |
| **Week 4** | S-6 / A-3 (soft-delete + Activity coverage) — start with `Appointment` and `Ticket` | 3 days |
| **Month 2+** | S-2 / A-1 (finish v1→v2 cutover), A-2 (enum tables), A-4 (Alembic autogenerate in CI) | 1 week |

---

## 8. Post-launch code-review checklist

Print this and pin it next to the whoever's approving PRs — every one of these has bitten this codebase before:

- [ ] New table? PK is `BigInteger`, always.
- [ ] New encrypted column? Column type is `Text`, and there's a matching HMAC `_index` if you query by it.
- [ ] New enum-shaped column? Has a `CHECK` or a lookup-table FK.
- [ ] New timestamp column? `datetime.now(timezone.utc)`, never `datetime.utcnow()`.
- [ ] New `save_file` call site? Wrapped in `asyncio.to_thread`, key uses ≥ 128 bits of randomness, content-type is server-sniffed.
- [ ] New DELETE endpoint on an attachment-owning entity? `delete_file` is called too.
- [ ] New durable worker? `_ensure_worker` + `recover_stale` + `asyncio.wait_for` timeout on the external call.
- [ ] New auth-gated endpoint? A test in `test_auth.py` asserts unauth is rejected.
- [ ] New env var? Required in prod (no `Optional`), documented in the deploy runbook.
- [ ] New migration? `down_revision` chained, no destructive `ALTER` without a backup, backfill script (if needed) committed alongside.

---

## Appendix — What I verified vs inferred

- **Verified with file reads:** every S-* finding on `appointment_models.py`, `crypto.py`, `storage_service.py`. The 4 attachment-owning services' `delete_file` call sites confirmed via grep + spot-checks at [ai_upload_service.py:943](../backend/src/services/ai_upload_service.py#L943), [event_service.py:927](../backend/src/services/event_service.py#L927). The ONE_PETITION_PER_DAY race confirmed by reading [appointment_service.py:466–474](../backend/src/services/appointment_service.py#L466).
- **Inferred:** row-count growth estimates (based on 3000+/year memory note), workshop time estimates. The Alembic autogenerate suggestion assumes the current models are the source of truth — if there's uncommitted drift between models and DB, that would need reconciling first.
