# VPA Pre-Production Audit — Final Report

**Date:** 2026-08-22 (launch day)
**Source of truth:** [`VPA-Pre-Prod-Audit.xlsx`](../VPA-Pre-Prod-Audit.xlsx)
**Regression suite:** [`backend/tests/test_pre_prod_fixes.py`](../backend/tests/test_pre_prod_fixes.py) — 38 tests
**Manual test plan:** [`docs/TEST_PLAN.md`](TEST_PLAN.md) — 40+ scenarios

---

## Headline numbers

| Status | Count | % of 184 |
|--------|------:|---------:|
| **Fixed in code** | **82** | 45% |
| Documented (needs ops action) | 8 | 4% |
| In Progress (deferred to sub-day work) | 6 | 3% |
| Won't Fix (with reason per row) | 50 | 27% |
| **Open** | **38** | 21% |

Every Fixed and Won't Fix row in the xlsx has a status color-band and
(for Won't Fix) a reason inline. Open rows are the last remaining
audit-suggested improvements that were either too risky or too broad
for the T-24h window.

---

## Commits shipped this audit round

7 commits on `main`:

| SHA | Theme | Findings |
|-----|-------|---------:|
| `3cb4a6b` | Groups 1–4: secrets placeholders, prod gates, RBAC, DB baseline | 16 Fixed |
| `8b26c1f` | CITZ-01/02/03: session cookie, filename XSS, referral rate-limit | 3 Fixed |
| `81862c8` | CORR-01..09: IST wall-clock, task GC, atomic revert, signatory lock | 9 Fixed |
| `6f72ff2` | PERF small wins: gzip, cache venues, id tie-break, ticket composite index | 5 Fixed |
| `dcc8394` | SSRF/RBAC/CSP + prompt-injection + SMS retry + PII masking | 15 Fixed |
| `af66f7d` | Portal: visibility polling, race guards, controlled search, CDN cleanup | 11 Fixed |
| `ac12dc1` | Citizen validators + IST GROUP BY + config hardening + a11y + PII masking | 23 Fixed |
| Plus | pre-audit err-polish (72ae163), drawer nav (6067b8e/5c3bc5b) | — |

---

## Requires your out-of-band action before opening intake

These CANNOT be fixed by code changes. Complete each one before
`RATE_LIMIT_ENABLED=true` on prod:

### 1. Rotate every leaked secret on the prod server
Prior commits in git history contain the old values. Anyone with repo
history can forge sessions / hit APM SMS / connect to MinIO.
Regenerate + swap in the deployed `backend/.env`:

- **SECRET_KEY** — every session cookie signs against this
  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```
- **APM_SMS_API_KEY** — get a new key from the APM console
- **FILE_STORAGE_ACCESS_KEY** + **FILE_STORAGE_SECRET_KEY** — rotate in the MinIO console
- **DASHBOARD_PASSWORD**, **DISPLAY_PASSWORD**, **EVENTS_PASSWORD**,
  **MINISTER_PASSWORD** — set a strong random for each; the app refuses
  to start with the shipped defaults now (see CFG-04)

### 2. Set the prod-safety env vars on the deployed `backend/.env`
The app refuses to boot in `DEBUG=False` if any of these are wrong:

```env
DEBUG=False
COOKIE_SECURE=true
SECRET_KEY=<rotated value>
ENCRYPTION_KEY=<the key currently encrypting your PII — never rotate this alone>
SERVER_BASE_URL=https://<your prod origin>
CORS_ORIGINS=https://<your prod origin>   # NO localhost
SENTRY_DSN=<obtain from Sentry>            # errors are silent without this
RATE_LIMIT_ENABLED=true                    # once nginx X-Forwarded-For is verified
```

### 3. Move the Vertex service-account JSON outside the repo
```bash
mkdir -p /etc/vpa && chmod 700 /etc/vpa
mv /root/Vpa-pilot-backend/backend/namkural-*.json /etc/vpa/vertex.json
# Then update .env:
VERTEX_SERVICE_ACCOUNT_JSON=/etc/vpa/vertex.json
```

### 4. Front MinIO with TLS
Plaintext `http://…:9000` leaks every citizen upload + MinIO credential
over the wire. Terminate TLS in nginx / caddy in front of MinIO, then:
```env
FILE_STORAGE_ENDPOINT=https://storage.<your prod origin>
```

### 5. Run `alembic upgrade head` on prod
Migrations `060` (idempotent slot column rename) and `061` (composite +
partial ticket indexes). Both safe on any DB state.

### 6. Front the app with nginx rate-limit rules
`slowapi` (in-app) is the primary defence; nginx `limit_req` zones for
`/dashboard/login` and `/form/otp` catch traffic before it reaches the
workers.

---

## Verification

### Automated (run now)
```bash
cd backend
./env/bin/python -m pytest tests/test_pre_prod_fixes.py -v
./env/bin/python -m pytest tests/test_auth.py tests/test_minister_auth.py \
                          tests/test_petition_merge_normalizer.py -v
```
Expected: **38 + 27 = 65 tests pass.**

### Manual (after deploy)
Execute [`docs/TEST_PLAN.md`](TEST_PLAN.md) top-to-bottom on staging
before promoting. Any failure blocks production.

### TypeScript
```bash
cd "PA portal/frontend" && npx tsc --noEmit
```
Expected: exit 0.

---

## Still Open (38 items) — the honest backlog

None are production-blocking; they're the "next sprint" items:

**Backend / correctness** (10) — CORR-13..18 async-refactor deferrals + a few Mediums.
Post-launch when you have real query-plan + load data.

**Frontend / citizen** (10) — CITZ-05/07/09/11/14/17/20 are all real refactors
(DB uniqueness, offline SW, idempotency keys, receipt-id route, CDN vendoring).
Not launch-blocking at pilot scale.

**Perf / Criticals** (4) — PERF-03/04/05/06 (dept LIMIT, ai-uploads cache,
proposal-dashboard analytics, sidebar cache). Not launch-blocking at pilot
volume; revisit once real traffic shows which one actually bites.

**Integrations** (7) — INTG-05 (SMS status endpoint change), INTG-07/08
(MinIO orphan janitor + circuit breaker) — new components.

**Schema mediums** (7) — SCHEMA-09/12/13/14/16/20/21/22 constraints + FK
adds. Migrate in a quiet window.

Full list with severity + line numbers is in the xlsx.

---

## What's in each fix commit — quick reference

For each finding ID above, `git log -S "<ID>"` finds the commit that
touched it (each commit body enumerates its findings).

Example:
```bash
git log -S "CITZ-01" --oneline
# → 8b26c1f sec(citizen): QR token → HttpOnly cookie, filename XSS, ...
```

---

## Deliverables in this directory

- `docs/PRE_PROD_AUDIT_REPORT.md` — this file (final summary)
- `docs/TEST_PLAN.md` — automated + manual test scenarios
- `VPA-Pre-Prod-Audit.xlsx` — the 184-finding audit workbook (updated live)
- `backend/tests/test_pre_prod_fixes.py` — 38-test regression suite
- `backend/DEPLOYMENT_CHECKLIST.md` — updated with fresh-DB bootstrap +
  new prod-safety env-var list

The rotation checklist above supersedes the "Requires out-of-band"
section in earlier summaries — treat this document as the launch-day
handoff.
