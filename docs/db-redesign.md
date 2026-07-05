# Database Redesign — Blueprint

Status: **spec, awaiting sign-off**. No models or migrations written yet.
Target branch: `redesign/institutional-modern` (or a dedicated `redesign/db` branch).

## Locked decisions

| Decision | Choice |
|----------|--------|
| Engine | PostgreSQL + SQLAlchemy (async, psycopg3) + Alembic |
| Tenancy | **Single office** — no `tenant_id` (revisit later; retrofit is a known cost) |
| PII | **Fernet-encrypted** `name`/`mobile`; `(name, mobile)` uniqueness via deterministic HMAC blind index |
| AI summary | **Keep `grievance_summary_records`** (rich bilingual) as source of truth |
| Migration | **Data-preserving** Alembic migration (existing pilot data is moved, not dropped) |
| Ticket | **Normalized** (status/priority via `admin`, `assigned_to` via `login`) |

## Table inventory

**New / redesigned (13):** `admin`, `login`, `qr_logs`, `verification`, `gatekeeper`,
`citizens`, `mla`, `availability`, `slots`, `appointment`, `attachments`, `activity`, `ticket`

**Kept as-is:** `grievance_summary_records`, `ai_uploads`, `referral_availability`,
`referral_slots`, `referral_bookings`

**Dropped / absorbed:**
| Old table | Absorbed into |
|-----------|---------------|
| `appointment_events`, `ticket_events` | `activity` |
| `appointment_slots`, `slot_bookings` | `slots` (+ `appointment.slot_id`) |
| `mla_daily_availability` | `availability` |
| `otp_verifications` | `verification` |
| `gatekeeper_sessions` | `gatekeeper` |
| `reschedule_logs` | `activity` (reschedule = an activity row) |

---

## Table definitions

### admin  — status / priority lookup
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| entity | VARCHAR(30) NOT NULL | `appointment` \| `ticket` \| `petition` \| `priority` |
| name | VARCHAR(60) NOT NULL | the status/priority label |
| sort_order | INT NOT NULL DEFAULT 0 | display order |
| is_active | BOOLEAN NOT NULL DEFAULT true | |

Unique: `(entity, name)`. Index: `(entity)`.

### login  — users / RBAC
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| login_name | VARCHAR(100) NOT NULL UNIQUE | |
| password | VARCHAR(255) NOT NULL | **argon2/bcrypt hash**, never plaintext |
| scope | JSONB NOT NULL DEFAULT '{}' | permissions/roles object |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| created_at | TIMESTAMP NOT NULL | |

### qr_logs
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| venue | VARCHAR(100) NOT NULL | |
| signature | VARCHAR(255) NOT NULL UNIQUE | |
| created_at | TIMESTAMP NOT NULL | |
| expires_at | TIMESTAMP NOT NULL | index for cleanup |

### verification  — OTP
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| session_token | UUID NOT NULL DEFAULT gen_random_uuid() | |
| mobile_number | VARCHAR(15) NOT NULL | |
| hashed_otp | VARCHAR(64) NOT NULL | SHA-256, never plaintext |
| attempts | INT NOT NULL DEFAULT 0 | max 3 |
| is_verified | BOOLEAN NOT NULL DEFAULT false | |
| created_at | TIMESTAMP NOT NULL | added — needed |
| expires_at | TIMESTAMP NOT NULL | added — needed for expiry |

### gatekeeper
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| token | UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE | |
| device_fingerprint | VARCHAR(255) NOT NULL | |
| is_used | BOOLEAN NOT NULL DEFAULT false | single-use |
| created_at | TIMESTAMP NOT NULL | added |
| expires_at | TIMESTAMP NOT NULL | added |

> ⚠️ Proposing to keep `qr_signature_hash` (VARCHAR, nullable) here too — dropping it
> loses the "same QR can't be scanned twice on one device" protection. Veto if not wanted.

### citizens
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| encrypted_name | TEXT NOT NULL | Fernet |
| encrypted_mobile | VARCHAR(512) NOT NULL | Fernet |
| identity_index | VARCHAR(64) NOT NULL UNIQUE | HMAC of normalized `name|mobile` — enforces the combined uniqueness |
| created_at | TIMESTAMP NOT NULL | |

### mla
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| name | VARCHAR(200) NOT NULL | |
| is_active | BOOLEAN NOT NULL DEFAULT true | |

### availability
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| mla_id | INT NOT NULL → mla(id) | |
| date | DATE NOT NULL | |
| is_open | BOOLEAN NOT NULL DEFAULT true | |

Unique: `(mla_id, date)`.

### slots
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| availability_id | INT NOT NULL → availability(id) | |
| start_time | TIME NOT NULL | |
| end_time | TIME NOT NULL | |
| total_slots | INT NOT NULL | capacity |
| slots_booked | INT NOT NULL DEFAULT 0 | counter (replaces slot_bookings) |

### appointment
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| token_number | BIGINT NOT NULL UNIQUE | YYYYMMDDNNNNN |
| citizen_id | INT NOT NULL → citizens(id) | |
| slot_id | INT NULL → slots(id) | null if no meeting booked |
| status_id | BIGINT NOT NULL → admin(id) | entity='appointment' |
| priority_id | BIGINT NULL → admin(id) | entity='priority' |
| venue | VARCHAR(100) NULL | |
| num_persons | INT NOT NULL DEFAULT 1 | |
| category | VARCHAR(50) NULL | denormalized quick-filter |
| created_at | TIMESTAMP NOT NULL | |

> `appointment.summary` dropped — `grievance_summary_records` (kept) is the source of truth.

### attachments
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| url | TEXT NOT NULL | storage key/path |
| type | VARCHAR(20) NOT NULL | AUDIO \| IMAGE \| DOCUMENT \| VIDEO |
| appointment_id | BIGINT NULL → appointment(id) | |
| ticket_id | BIGINT NULL → ticket(id) | |
| file_size | INT NULL | bytes |

### activity  — unified audit log
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| appointment_id | BIGINT NULL → appointment(id) | |
| ticket_id | BIGINT NULL → ticket(id) | |
| user | VARCHAR(100) NOT NULL | login_name or 'system' |
| action_type | VARCHAR(40) NOT NULL | status_changed, rescheduled, comment, forwarded, ... |
| message | TEXT NULL | |
| created_at | TIMESTAMP NOT NULL | |

### ticket  (normalized)
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| ticket_number | VARCHAR(20) NOT NULL UNIQUE | TKT-YYYY-NNNNN |
| appointment_id | BIGINT NOT NULL UNIQUE → appointment(id) | 1:1 |
| status_id | BIGINT NOT NULL → admin(id) | entity='ticket' |
| priority_id | BIGINT NULL → admin(id) | entity='priority' |
| assigned_to | BIGINT NULL → login(id) | |
| forwarded_to | VARCHAR(60) NULL | department |
| notes | TEXT NULL | |
| reopen_count | INT NOT NULL DEFAULT 0 | |
| created_at | TIMESTAMP NOT NULL | |

---

## admin seed data

Seeded from existing enums, plus one new `department` group. Petitions ARE appointments,
so no separate `petition` status group.

| entity | source | names |
|--------|--------|-------|
| appointment | existing `Appointment.status` | SCHEDULED, WAITING, RESCHEDULED, AWAITING_REVIEW, REVIEWED, NOT_CAME |
| ticket | existing `TicketStatus` | open, triaged, assigned, in_progress, forwarded_to_dept, pending_citizen, resolved, closed, reopened |
| priority | existing `TicketPriority` | P0, P1, P2, P3 |
| category | existing `GrievanceCategory` | action_required, proposals, transfer_requests, pension_requests, school_admission, job_requests, rti, associations_unions, other, general, greetings, school_upgradation, invitation |
| ministry | existing `Department` enum (~34 rows) | rural_development_water_resources … school_education_tamil_dev_info_publicity … other (all enum values) |
| department | **NEW** — Education sub-directorates | see list below |

### New `department` seed (entity = 'department')

Names cleaned from the dictated list (typos fixed — veto any correction):

| # | name | note |
|---|------|------|
| 1 | Director of School Education | |
| 2 | Directorate of Private Schools | |
| 3 | Elementary Education | |
| 4 | Government Examinations | |
| 5 | Non-Formal and Adult Education | |
| 6 | Public Libraries | |
| 7 | State Council of Educational Research and Training (SCERT) | |
| 8 | Teacher Recruitment Board | "Requirement" → Recruitment |
| 9 | Tamil Nadu Education Service Corporation | "Serivce" → Service |
| 10 | Samagra Shiksha | "Samgara" → Samagra |

> Note: `ticket.forwarded_to` (currently VARCHAR) could become an FK to `admin`
> (a `ministry` or `department` row) for integrity. Default: keep it storing the
> admin id/name. Flag if you want it as a hard FK.

---

## Data-migration mapping (old → new)

| New table | Source | Transform |
|-----------|--------|-----------|
| admin | (seed) | insert the seed rows above; build name→id lookup for the rest |
| citizens | citizens | copy encrypted_name/mobile/created_at; **decrypt with Fernet key to recompute `identity_index` = HMAC(name\|mobile)** |
| mla | mlas | direct |
| availability | mla_daily_availability | is_open = (status=='ACTIVE') |
| slots | appointment_slots | total_slots=max_capacity, slots_booked=booked_count |
| appointment | appointments | status string → status_id via admin lookup; slot_id via slot_bookings; priority_id null (or from linked ticket) |
| ticket | tickets | status→status_id, priority→priority_id, assigned_to_pa→assigned_to via login lookup |
| activity | appointment_events + ticket_events + reschedule_logs | actor→user, event_type→action_type, note→message |
| verification | otp_verifications | hashed_otp_code→hashed_otp, attempts_count→attempts |
| gatekeeper | gatekeeper_sessions | direct (+ keep qr_signature_hash if approved) |
| attachments | appointment_attachments | storage_url→url, attachment_type→type |

## Migration-time risks to resolve

1. **`login` seeding.** There is no existing users table. `ticket.assigned_to` (was
   `assigned_to_pa` username strings) can't FK to `login` until login rows exist.
   Plan: seed `login` from the distinct `assigned_to_pa` values + the current
   dashboard/display credentials, then map. Rows that don't match → `assigned_to = NULL`.
2. **`identity_index` recompute** requires the Fernet key inside the migration to
   decrypt name+mobile. The migration must run with `ENCRYPTION_KEY` available.
3. **`petition` statuses** undefined (see seed table). Need the list, or I skip that entity.
4. Dropping `reschedule_logs` loses the structured old_slot/new_slot fields (they become
   a free-text `activity.message`). Acceptable?
