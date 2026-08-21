# VPA Pre-Prod Test Plan

Human-executable + automated tests for the pre-production audit fixes.
Every test maps to a finding ID in `VPA-Pre-Prod-Audit.xlsx`; the
mapping in `Automated coverage` below is the authoritative list of what
`pytest tests/test_pre_prod_fixes.py` proves in code, and the
`Manual UI test cases` section is what a human needs to execute after
deploy since we can't drive a real browser in the fix session.

**Run automated first, then manual after deploy to staging.**

---

## Automated coverage — `tests/test_pre_prod_fixes.py`

Run:
```bash
cd backend && ./env/bin/python -m pytest tests/test_pre_prod_fixes.py -v
```

Expected: **38 passed**.

| Test class | Findings covered | What it proves |
|------------|------------------|----------------|
| `TestValidators`               | CITZ-04                    | `clean_name` / `clean_mobile` reject XSS / whitespace-only / digit-only / bad country codes; accept Tamil block; normalise `+91 98765 43210` → `9876543210` |
| `TestIstHelpers`               | CORR-07, 08, 09            | `ist_now() − now_utc() ≈ 5h30m`; `ist_today()` matches IST calendar day; `now_utc()` returns naive datetime |
| `TestMobileMasking`            | AUTH-18                    | `_mask_mobile('9876543210')` → `'******3210'`; short / None → `'***'` |
| `TestConstantTimeCreds`        | AUTH-08                    | Both wrong-user and wrong-password branches always evaluate — no short-circuit |
| `TestVerifyPasswordConstantTime` | AUTH-09                  | `verify_password(x, None)` returns False (didn't short-circuit); real hash still verifies |
| `TestSpawnBg`                  | CORR-01, 02                | Task pinned in `_BG_TASKS` while running, discarded when done; raised exceptions logged (not swallowed asyncio warning) |
| `TestCryptoNoSilentBase64`     | SEC-03                     | Legacy base64 no longer decoded transparently — raw returned + WARN logged |
| `TestGeminiTransientClassification` | CORR-11               | Retry classifier keys on exception class name AND status_code; 404 is non-transient |
| `TestActivityAction`           | CORR-27                    | Both legacy aliases (`_EventType`, `TicketEventType`) resolve to the new unified enum; all predecessor members covered |
| `TestAlembicEnvImports`        | SCHEMA-04                  | All 9 previously-missing models now importable — env.py `--autogenerate` won't emit spurious DROP TABLE |
| `TestProdReadyGates`           | CFG-03, 04, AUTH-17        | `assert_production_ready` refuses: DEBUG+remote DB, placeholder/short SECRET_KEY, missing ENCRYPTION_KEY, COOKIE_SECURE=false, localhost CORS in prod, default staff creds |
| `TestIntakeCookieResolve`      | CITZ-01                    | Cookie preferred over query; query fallback works; both empty → None |

Plus the existing 27 auth/minister/petition-merge tests continue to pass.

---

## Manual UI test cases — execute on staging after deploy

### CITZEN — QR intake (T-INTAKE-\*)

**T-INTAKE-01** (CITZ-01, CITZ-16) — QR scan → intake form, cookie flow + iOS autofill
1. On an iPhone Safari, scan the printed QR code.
2. **Expect:** URL bar shows `/form/choose?t=1` — no `?token=<uuid>`.
3. Tap "Petition" → **Expect:** `/form?mode=petition` — still no token in URL.
4. Fill name + mobile, tap "Send OTP".
5. When the SMS arrives, iOS should surface a "From Messages: 123456"
   AutoFill chip above the first OTP box.
6. Tap the chip → **Expect:** all 6 boxes fill at once.

**T-INTAKE-02** (CITZ-02) — file-badge XSS proof
1. On the intake form, tap "Add files".
2. Choose a file on your device renamed to `x" onerror=alert(1) x.png`
   (or with `<script>alert(1)</script>` in the name).
3. **Expect:** the badge shows the filename as **literal text** (`x"
   onerror=alert(1) x.png`). No alert box. Inspect DevTools → the alt
   attribute contains `&quot;` not a live `"`.

**T-INTAKE-03** (CITZ-04) — server-side name validation via curl
```bash
# Should return 400 with the citizen-facing message
curl -F 'session_token=00000000-0000-0000-0000-000000000000' \
     -F 'name=<img src=x>' \
     -F 'mobile_number=9876543210' \
     -F 'constituency=Chennai' \
     -F 'otp_code=123456' \
     -F 'grievance_category=other' \
     https://<staging>/api/v1/appointments/submit
```
**Expect:** HTTP 400, body `{"detail":"Name must be 1-150 chars..."}`.

**T-INTAKE-04** (CITZ-08) — screen-reader lang toggle
1. Enable VoiceOver / TalkBack on the phone.
2. Load `/form?token=...`, screen reader reads in Tamil phonetics.
3. Tap the "English" language button.
4. **Expect:** Same content re-read using English phonetics (not
   Tamil-phonemes-of-English-words). DevTools → `<html>` element `lang`
   attribute is now `en`.

**T-INTAKE-05** (CITZ-12) — slot picker no longer hammers backend
1. Open the slot picker on the form.
2. Open browser DevTools → Network tab.
3. Wait 60 seconds — count `/scheduling/slots/available` requests.
4. **Expect:** ≤4 requests (≈ one every 20s). Switch to another tab
   for 60s → no new requests during that window.

**T-INTAKE-06** (CITZ-13, CITZ-15) — success page behaviour
1. Complete a petition submission.
2. On the success page: **Expect:** NO file auto-downloads to /Downloads.
3. Tap "Download Card" → downloads the PNG.
4. Tap browser back → **Expect:** form page shows fresh (no error page
   about session-used).

### CITIZEN — Referral (T-REFERRAL-\*)

**T-REFERRAL-01** (CITZ-03) — rate limit + required mobile
```bash
# 6 submits in 10s from the same IP; the 6th must be 429
for i in {1..6}; do
  curl -X POST https://<staging>/api/v1/referral/submit \
       -F 'd=<today-token>' -F 'name=Test' -F 'referred_by=Test' \
       -F 'reason=Meeting the minister for my request please' \
       -F 'slot_id=1' -F 'mobile=9876543210'
  echo "---"
done
```
**Expect:** 5x 201/409, then 1x 429 "Too many requests".

**T-REFERRAL-02** (CITZ-03) — mobile now required
```bash
# Empty mobile → 400
curl -X POST https://<staging>/api/v1/referral/submit \
     -F 'd=<today-token>' -F 'name=Test' -F 'referred_by=Test' \
     -F 'reason=Meeting the minister' -F 'slot_id=1' -F 'mobile='
```
**Expect:** HTTP 400, `Please enter a valid 10-digit Indian mobile number...`.

**T-REFERRAL-03** (CITZ-06) — screen reader on referral form
1. Open `/form/referral?d=<today-token>`, enable screen reader.
2. Tab through fields.
3. **Expect:** Each field announces its label (Full Name, Mobile Number,
   Number of Persons, Shared By, Reason). No "edit, edit, edit" nameless
   announcements.

### PA PORTAL (T-PORTAL-\*)

**T-PORTAL-01** (PORT-01, PORT-08) — QR page loads cleanly, no leaked scripts
1. Login as super_admin, navigate to `/crowd-qr`.
2. **Expect:** QR renders.
3. Navigate to `/referrals`, back to `/crowd-qr`, back to `/referrals`.
4. DevTools → Elements → `document.querySelectorAll("script[src*=jsdelivr]").length`
   → **Expect: 1** (was accumulating: 4-5 after the same navigation).

**T-PORTAL-02** (PORT-02) — clear-all-filters actually clears search
1. On `/tickets`, type "abc" in search.
2. Immediately tap "Clear all filters" (within 300ms of the last keystroke).
3. **Expect:** search box is empty AND stays empty. The list shows
   unfiltered results. No re-appearance of "abc" 300ms later.

**T-PORTAL-03** (PORT-05) — visibility-gated polling
1. Login, navigate to `/ai-uploads`.
2. Start uploading a batch (rows are QUEUED/PROCESSING).
3. Open DevTools → Network, filter by `list_aggregates`.
4. Wait 30s → count requests: **Expect ~7-10** (every 3s while visible).
5. Switch to another browser tab; wait 60s.
6. Come back → **Expect** the count during those 60s hidden was 0-1
   (was 20 before the fix), with a single fetch on visibilitychange.

**T-PORTAL-04** (PORT-13) — no console.error leaks
1. Login to `/tickets`.
2. Force a 500: temporarily break the DB (stop postgres, or point
   DATABASE_URL to a bad host). Reload `/tickets`.
3. **Expect:** a red toast "Couldn't load tickets." — NO SQL text /
   stack trace / raw error in the browser console.

**T-PORTAL-05** (PORT-07) — no dead activity fetches on appointment drawer
1. Login as PA, navigate to `/appointments`.
2. Open DevTools → Network, filter by `activity`.
3. Click any appointment row → **Expect: 0** activity requests
   (was: 1 on open, +1 on every status change).

### DEPARTMENT / MINISTER — RBAC gates (T-RBAC-\*)

**T-RBAC-01** (AUTH-01) — dept file server row-level scope
1. Login as a dept_officer for "education".
2. Get any storage key belonging to a "health" ticket via the health
   dept's storage_url in the DB.
3. Try `GET /department/api/files/attachments/<health-key>` from the
   education session.
4. **Expect:** 403. Previously returned the bytes.

**T-RBAC-02** (AUTH-02, AUTH-03) — auditor cannot cancel appointments
1. Login as an auditor.
2. Attempt `POST /api/v1/scheduling/admin/cancel-all-scheduled?target_date=...`.
3. **Expect:** 403 "Requires role: super_admin | pa".
4. Same for `/api/v1/referral/admin/cancel-all-bookings`.

**T-RBAC-03** (AUTH-05) — dept_officer locked out of ai-uploads
1. Login as dept_officer.
2. Attempt `GET /dashboard/api/ai-uploads/aggregates`.
3. **Expect:** 403.

**T-RBAC-04** (AUTH-10) — push subscribe rejects arbitrary endpoints
1. Login as an events reviewer.
2. POST `/events/api/push/subscribe` with body:
   `{"endpoint": "http://169.254.169.254/", "keys": {"p256dh": "x", "auth": "y"}}`.
3. **Expect:** 422 "endpoint host is not a recognised browser-push service".

**T-RBAC-05** (AUTH-11) — auditor cannot mutate tickets
1. Login as auditor.
2. `PATCH /dashboard/api/tickets/1` with `{"priority": "critical"}`.
3. **Expect:** 403.

**T-RBAC-06** (AUTH-12) — minister file passthrough scoped
1. Login as minister.
2. `GET /minister/api/files/attachments/nonsense-key-abcdef123`.
3. **Expect:** 403 "Not authorized to access this file."
4. Same for a real key that isn't referenced by any Appointment,
   Ticket, AiUpload, Proposal, or Association row.

### PROD SAFETY — startup gates (T-STARTUP-\*)

**T-STARTUP-01** (CFG-03) — DEBUG+remote DB refused
```bash
# Deliberately misconfigure staging env
DEBUG=True DATABASE_URL=postgresql+psycopg://u:p@<prod-host>:5432/x \
  ./env/bin/python -c "
import src.main
from src.core.config import assert_production_ready, settings
try:
    assert_production_ready(settings)
    print('BAD: should have raised')
except RuntimeError as e:
    print('OK refused:', e)
"
```

**T-STARTUP-02** (CFG-01) — SECRET_KEY placeholder refused in prod
Same shape as above but with `DEBUG=False SECRET_KEY=CHANGE_ME__foo`.

**T-STARTUP-03** (INTG-19) — MinIO unreachable fails boot in prod
1. Set `FILE_STORAGE_ENDPOINT` to a bad URL, `DEBUG=False`.
2. Start the app → **Expect:** process exits with
   "storage bucket check failed at boot: ..."
3. Same with `DEBUG=True` → **Expect:** starts with an ERROR log
   (dev-friendly).

### PERFORMANCE — spot checks (T-PERF-\*)

**T-PERF-01** (PERF-17) — responses are gzipped
```bash
curl -s -o /dev/null -w "%{http_code} size=%{size_download} enc=%header{content-encoding}\n" \
     -H "Accept-Encoding: gzip" \
     -H "Cookie: dash_session=..." \
     https://<staging>/api/appointments
```
**Expect:** `200 size=<smaller than uncompressed> enc=gzip`.

**T-PERF-02** (PERF-18) — /api/venues cache header
```bash
curl -sI -H "Cookie: dash_session=..." https://<staging>/api/venues | grep -i cache
```
**Expect:** `Cache-Control: private, max-age=300, stale-while-revalidate=60`.

**T-PERF-03** (PERF-08) — pagination stability
1. Bulk-create 30 tickets in the same second (script or `for i in ...`).
2. `GET /api/tickets?page=1&page_size=10` and `page=2` twice.
3. **Expect:** the 20 IDs across page 1+2 don't repeat; page 2 doesn't
   miss any. Repeat page 1 five times → same IDs every time.

**T-PERF-04** (PERF-02) — composite index used
```sql
EXPLAIN ANALYZE SELECT * FROM ticket
 WHERE department='education' AND status_id IN (1,2,3)
 ORDER BY created_at DESC LIMIT 25;
```
**Expect:** plan uses `ix_ticket_dept_status_created`, no Sort node.

### SECURITY HEADERS (T-SEC-\*)

**T-SEC-01** (SEC-01) — CSP + Frame + Permissions headers
```bash
curl -sI https://<staging>/appointments | grep -E "(X-Frame-Options|Content-Security-Policy|Permissions-Policy|X-Content-Type-Options|Referrer-Policy)"
```
**Expect:** all five headers present with the values from `main.py`.

**T-SEC-02** (SEC-01) — clickjacking refused
1. Create an HTML file:
   ```html
   <iframe src="https://<staging>/appointments" width="800" height="600"></iframe>
   ```
2. Serve it locally, open in browser.
3. **Expect:** iframe is blank (browser refuses due to
   `X-Frame-Options: DENY` / `frame-ancestors 'none'`).

---

## Post-deploy runbook

After the deploy lands on staging, execute in this order:

1. **T-STARTUP-01/02/03** — the app must refuse to boot when misconfigured
2. **T-SEC-01/02** — headers land correctly on every response
3. **T-RBAC-01..06** — no role escalation across sessions
4. **T-INTAKE-01/02/03** — citizen intake preserves data integrity
5. **T-REFERRAL-01/02** — referral abuse defenses hold
6. **T-PORTAL-01..05** — staff surfaces don't regress
7. **T-PERF-01..04** — performance improvements measurable

Any failure blocks production promotion. Sign-off requires all 40+ tests
green (38 automated + rest manual).

---

## Known Won't Fix items (context)

See `VPA-Pre-Prod-Audit.xlsx` Won't Fix column for reasoning per row.
Not "we forgot" — deliberately deferred:
  - Big data migrations (SCHEMA-05/06) — need staged rollout
  - Historical migration bugs (SCHEMA-07/08/11/15/18/19) — already applied, damage done or none
  - Big frontend refactors (PORT-04 focus trap, PERF-10 build_appointment_row split)
  - Whole-flow rewrites (CITZ-07 offline, CITZ-09 idempotency, CORR-13/16 async chains)
  - The one you explicitly reverted: CFG-05 / AUTH-07 rate-limit master switch
