-- v2 schema migration — all decided tables (otp_verification through attachments).
-- Run against clean mla_scheduler_v2 on local Postgres only.
-- DO NOT run against Railway.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. verification → otp_verification (rename table + columns to v1 names)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE verification RENAME TO otp_verification;
ALTER TABLE otp_verification RENAME COLUMN hashed_otp TO hashed_otp_code;
ALTER TABLE otp_verification RENAME COLUMN attempts TO attempts_count;
ALTER TABLE otp_verification RENAME COLUMN is_verified TO is_used;
ALTER TABLE otp_verification ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE otp_verification ADD COLUMN IF NOT EXISTS token_assigned BIGINT;
CREATE INDEX IF NOT EXISTS ix_otp_verification_token_assigned ON otp_verification(token_assigned);
-- v2: activity table needs a JSONB payload for structured change events
-- (frontend renders from/to arrows from it). Original v2 lumped everything into
-- 'message' but the PA portal expects structured data.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS payload JSONB;

-- Enforce OTP → gatekeeper session link (drops auto-gen default; app must pass it)
ALTER TABLE otp_verification ALTER COLUMN session_token DROP DEFAULT;
ALTER TABLE otp_verification
    ADD CONSTRAINT otp_verification_session_token_fkey
    FOREIGN KEY (session_token) REFERENCES gatekeeper(session_token) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. gatekeeper — no changes (keep v2 as-is)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. citizens — no changes (keep v2 as-is, identity_index stays)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. mla — add v1 profile columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE mla ADD COLUMN IF NOT EXISTS constituency VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE mla ADD COLUMN IF NOT EXISTS contact_mobile VARCHAR(15);
ALTER TABLE mla ADD COLUMN IF NOT EXISTS contact_email VARCHAR(100);
ALTER TABLE mla ADD COLUMN IF NOT EXISTS office_address TEXT;
ALTER TABLE mla ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. availability — no changes (keep v2 lean)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. slots — rename columns to v1 names + add slot_number, status
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE slots RENAME COLUMN total_slots TO max_capacity;
ALTER TABLE slots RENAME COLUMN slots_booked TO booked_count;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS slot_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. appointment — add decided columns + bridge status string
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES admin(id);
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS encrypted_grievance TEXT;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS queue_position INTEGER;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMP;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS summary_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS summary_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS summary_claimed_at TIMESTAMP;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS encrypted_name_ta TEXT;
-- Persistent citizen intent (a meeting request stays a meeting request even
-- after slot_id is released into the waiting queue).
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS schedule_meeting BOOLEAN NOT NULL DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. ticket — rename forwarded_to, add bridge + lifecycle columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE ticket RENAME COLUMN forwarded_to TO forwarded_to_dept;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'open';
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS priority VARCHAR(5);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS assigned_to_pa VARCHAR(100);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMP;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS forwarded_by VARCHAR(100);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS forwarded_notes TEXT;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS closure_reason VARCHAR(40);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMP;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();
-- Department routing (from main's ticketing Phase 1-5)
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS department VARCHAR(60);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(100);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_ticket_department ON ticket(department);

-- Ticket resolution/progress attachments
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id                BIGSERIAL PRIMARY KEY,
    ticket_id         BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
    kind              VARCHAR(20) NOT NULL DEFAULT 'resolution',
    storage_url       TEXT NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    file_size_bytes   INTEGER NOT NULL DEFAULT 0,
    original_filename VARCHAR(255),
    uploaded_by       VARCHAR(100),
    created_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. attachments — rename columns to v1 names, add mime_type + created_at
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE attachments RENAME COLUMN url TO storage_url;
ALTER TABLE attachments RENAME COLUMN type TO attachment_type;
ALTER TABLE attachments RENAME COLUMN file_size TO file_size_bytes;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. qr_logs, admin, login, activity — no changes (keep v2 as-is)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. SKIP: slot_bookings, reschedule_logs, appointment_events, ticket_events
--     → appointment.slot_id covers booking link
--     → activity table replaces all audit log tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. grievance_summary_records — CREATE (v1 structure)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS grievance_summary_records (
    id                    BIGSERIAL PRIMARY KEY,
    appointment_id        BIGINT NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
    is_latest             BOOLEAN NOT NULL DEFAULT true,
    priority              VARCHAR(20) NOT NULL,
    category              VARCHAR(50) NOT NULL,
    department            VARCHAR(60) NOT NULL DEFAULT 'other',
    secondary_departments JSONB NOT NULL DEFAULT '[]',
    headline              VARCHAR(150) NOT NULL,
    summary               TEXT NOT NULL,
    citizen_ask           TEXT NOT NULL,
    priority_reason       TEXT,
    key_details           JSONB NOT NULL,
    attachment_notes      TEXT,
    headline_ta           VARCHAR(200) NOT NULL,
    summary_ta            TEXT NOT NULL,
    citizen_ask_ta        TEXT NOT NULL,
    priority_reason_ta    TEXT,
    key_details_ta        JSONB NOT NULL,
    attachment_notes_ta   TEXT,
    audio_transcript      TEXT,
    audio_stt_latency_ms  INTEGER,
    gemini_model_used     VARCHAR(60) NOT NULL,
    gemini_latency_ms     INTEGER,
    created_at            TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_gsr_appointment_latest ON grievance_summary_records(appointment_id, is_latest);
CREATE INDEX IF NOT EXISTS ix_gsr_priority ON grievance_summary_records(priority);
CREATE INDEX IF NOT EXISTS ix_gsr_category ON grievance_summary_records(category);
CREATE INDEX IF NOT EXISTS ix_gsr_department ON grievance_summary_records(department);
CREATE INDEX IF NOT EXISTS ix_gsr_created_at ON grievance_summary_records(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. ai_uploads — CREATE (v1 structure)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_uploads (
    id                 BIGSERIAL PRIMARY KEY,
    batch_id           VARCHAR(40) NOT NULL,
    original_filename  VARCHAR(300) NOT NULL,
    storage_url        TEXT NOT NULL,
    mime_type          VARCHAR(100) NOT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    extracted_name     VARCHAR(200),
    extracted_name_ta  VARCHAR(200),
    extracted_mobile   VARCHAR(20),
    grievance_category VARCHAR(50),
    priority           VARCHAR(20),
    forced_category    VARCHAR(50),
    summary_json       JSONB,
    error_message      TEXT,
    appointment_id     BIGINT REFERENCES appointment(id) ON DELETE SET NULL,
    ticket_id          BIGINT REFERENCES ticket(id) ON DELETE SET NULL,
    ticket_number      VARCHAR(20),
    created_at         TIMESTAMP NOT NULL DEFAULT now(),
    processed_at       TIMESTAMP,
    reviewed_at        TIMESTAMP,
    reviewed_by        VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS ix_ai_uploads_status ON ai_uploads(status);
CREATE INDEX IF NOT EXISTS ix_ai_uploads_batch ON ai_uploads(batch_id);
CREATE INDEX IF NOT EXISTS ix_ai_uploads_created ON ai_uploads(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. referral tables — CREATE (v1 structure)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS referral_availability (
    id         SERIAL PRIMARY KEY,
    date       DATE NOT NULL,
    start_time TIME NOT NULL DEFAULT '11:00',
    end_time   TIME NOT NULL DEFAULT '13:00',
    status     VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by VARCHAR(100),
    CONSTRAINT uq_referral_date UNIQUE (date)
);
CREATE INDEX IF NOT EXISTS ix_referral_availability_date ON referral_availability(date);

CREATE TABLE IF NOT EXISTS referral_slots (
    id              SERIAL PRIMARY KEY,
    availability_id INTEGER NOT NULL REFERENCES referral_availability(id) ON DELETE CASCADE,
    slot_number     INTEGER NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    max_capacity    INTEGER NOT NULL DEFAULT 6,
    booked_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_referral_slots_availability ON referral_slots(availability_id);
CREATE INDEX IF NOT EXISTS ix_referral_slots_status ON referral_slots(status);

CREATE TABLE IF NOT EXISTS referral_bookings (
    id                   SERIAL PRIMARY KEY,
    slot_id              INTEGER NOT NULL REFERENCES referral_slots(id) ON DELETE CASCADE,
    token_number         BIGINT NOT NULL,
    name                 TEXT NOT NULL,
    mobile               VARCHAR(512),
    num_persons          INTEGER NOT NULL DEFAULT 1,
    referred_by          VARCHAR(200) NOT NULL,
    reason               VARCHAR(500) NOT NULL,
    status               VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    scheduled_date       DATE NOT NULL,
    scheduled_start_time TIME NOT NULL,
    scheduled_end_time   TIME NOT NULL,
    created_at           TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_referral_bookings_slot_id ON referral_bookings(slot_id);
CREATE INDEX IF NOT EXISTS ix_referral_bookings_date ON referral_bookings(scheduled_date);
CREATE UNIQUE INDEX IF NOT EXISTS ix_referral_bookings_token ON referral_bookings(token_number);

COMMIT;
