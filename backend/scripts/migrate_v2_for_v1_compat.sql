-- Migration: make v2 database compatible with v1 ORM models
-- Run against mla_scheduler_v2 on local Postgres only.
-- DO NOT run against Railway.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. gatekeeper (was gatekeeper_sessions)
--    v1 ORM has venue_id nullable; v2 has it NOT NULL
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE gatekeeper ALTER COLUMN venue_id DROP NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. verification (was otp_verifications)
--    Column renames + add missing columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE verification RENAME COLUMN hashed_otp TO hashed_otp_code;
ALTER TABLE verification RENAME COLUMN attempts TO attempts_count;
ALTER TABLE verification ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. citizens
--    v2 has identity_index; v1 uses mobile_index + ward_or_region
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE citizens RENAME COLUMN identity_index TO mobile_index;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS ward_or_region VARCHAR(100);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. mla (was mlas)
--    v2 is lean; v1 has extra profile columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE mla ADD COLUMN IF NOT EXISTS constituency VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE mla ADD COLUMN IF NOT EXISTS contact_mobile VARCHAR(15);
ALTER TABLE mla ADD COLUMN IF NOT EXISTS contact_email VARCHAR(100);
ALTER TABLE mla ADD COLUMN IF NOT EXISTS office_address TEXT;
ALTER TABLE mla ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. availability (was mla_daily_availability)
--    v2 is lean; v1 has time fields, status, audit
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE availability ADD COLUMN IF NOT EXISTS start_time TIME DEFAULT '08:00';
ALTER TABLE availability ADD COLUMN IF NOT EXISTS end_time TIME DEFAULT '18:00';
ALTER TABLE availability ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE availability ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();
ALTER TABLE availability ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. slots (was appointment_slots)
--    Column renames + add missing columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE slots RENAME COLUMN total_slots TO max_capacity;
ALTER TABLE slots RENAME COLUMN slots_booked TO booked_count;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS slot_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE slots ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. appointment (was appointments)
--    v2 is very lean; v1 has 25+ columns. Rename existing + add missing.
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE appointment RENAME COLUMN token_number TO token_assigned;
ALTER TABLE appointment RENAME COLUMN venue TO venue_id;
ALTER TABLE appointment RENAME COLUMN category TO grievance_category;

-- Make status_id nullable during transition (v1 still writes string status)
ALTER TABLE appointment ALTER COLUMN status_id DROP NOT NULL;

ALTER TABLE appointment ADD COLUMN IF NOT EXISTS encrypted_grievance TEXT;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS encrypted_name TEXT;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS audio_recording_url TEXT;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS pre_floor_status VARCHAR(20);
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS schedule_meeting BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'qr_citizen';
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS scheduled_start_time TIME;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS scheduled_end_time TIME;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS appointment_slot_id INTEGER REFERENCES slots(id) ON DELETE SET NULL;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS queue_position INTEGER;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMP;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS priority_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS summary_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS summary_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointment ADD COLUMN IF NOT EXISTS summary_claimed_at TIMESTAMP;

-- Indexes the v1 ORM expects
CREATE INDEX IF NOT EXISTS ix_appointments_status ON appointment(status);
CREATE INDEX IF NOT EXISTS ix_appointments_scheduled_date ON appointment(scheduled_date);
CREATE INDEX IF NOT EXISTS ix_appointments_queue_position ON appointment(queue_position);
CREATE INDEX IF NOT EXISTS ix_appointments_waiting_since ON appointment(waiting_since);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. ticket (was tickets)
--    v2 is lean; v1 has many lifecycle columns. Keep v2's assigned_to (FK),
--    add v1's assigned_to_pa (VARCHAR) as separate column.
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE ticket ALTER COLUMN status_id DROP NOT NULL;
ALTER TABLE ticket RENAME COLUMN forwarded_to TO forwarded_to_dept;

ALTER TABLE ticket ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'open';
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS priority VARCHAR(5);
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS assigned_to_pa VARCHAR(100);
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

-- Indexes the v1 ORM expects
CREATE INDEX IF NOT EXISTS ix_tickets_status ON ticket(status);
CREATE INDEX IF NOT EXISTS ix_tickets_priority ON ticket(priority);
CREATE INDEX IF NOT EXISTS ix_tickets_assigned_to_pa ON ticket(assigned_to_pa);
CREATE INDEX IF NOT EXISTS ix_tickets_due_date ON ticket(due_date);
CREATE INDEX IF NOT EXISTS ix_tickets_forwarded ON ticket(forwarded_to_dept);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. attachments (was appointment_attachments)
--    Column renames + add missing
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE attachments RENAME COLUMN url TO storage_url;
ALTER TABLE attachments RENAME COLUMN type TO attachment_type;
ALTER TABLE attachments RENAME COLUMN file_size TO file_size_bytes;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. Create tables that don't exist in v2
-- ═══════════════════════════════════════════════════════════════════════════════

-- slot_bookings (junction: appointment ↔ slot)
CREATE TABLE IF NOT EXISTS slot_bookings (
    id             SERIAL PRIMARY KEY,
    slot_id        INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    appointment_id BIGINT  NOT NULL UNIQUE REFERENCES appointment(id) ON DELETE CASCADE,
    booked_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_slot_bookings_slot_id ON slot_bookings(slot_id);
CREATE INDEX IF NOT EXISTS ix_slot_bookings_appointment_id ON slot_bookings(appointment_id);

-- reschedule_logs (audit)
CREATE TABLE IF NOT EXISTS reschedule_logs (
    id                SERIAL PRIMARY KEY,
    appointment_id    BIGINT NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
    old_slot_id       INTEGER REFERENCES slots(id) ON DELETE SET NULL,
    new_slot_id       INTEGER REFERENCES slots(id) ON DELETE SET NULL,
    reason            VARCHAR(50) NOT NULL,
    reason_details    TEXT,
    rescheduled_by    VARCHAR(100),
    notification_sent BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reschedule_logs_appointment ON reschedule_logs(appointment_id);
CREATE INDEX IF NOT EXISTS ix_reschedule_logs_created_at ON reschedule_logs(created_at);

-- ticket_events (audit log per ticket)
CREATE TABLE IF NOT EXISTS ticket_events (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,
    actor      VARCHAR(100) NOT NULL,
    note       TEXT,
    payload    JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ticket_events_ticket_created ON ticket_events(ticket_id, created_at);

-- appointment_events (audit log per appointment)
CREATE TABLE IF NOT EXISTS appointment_events (
    id             BIGSERIAL PRIMARY KEY,
    appointment_id BIGINT NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
    event_type     VARCHAR(40) NOT NULL,
    actor          VARCHAR(100) NOT NULL,
    note           TEXT,
    payload        JSONB,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_appt_events_appt_created ON appointment_events(appointment_id, created_at);

-- grievance_summary_records
CREATE TABLE IF NOT EXISTS grievance_summary_records (
    id                    BIGSERIAL PRIMARY KEY,
    appointment_id        BIGINT NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
    is_latest             BOOLEAN NOT NULL DEFAULT true,
    urgency               VARCHAR(20) NOT NULL,
    category              VARCHAR(50) NOT NULL,
    department            VARCHAR(60) NOT NULL DEFAULT 'other',
    secondary_departments JSONB NOT NULL DEFAULT '[]',
    headline              VARCHAR(150) NOT NULL,
    summary               TEXT NOT NULL,
    citizen_ask           TEXT NOT NULL,
    urgency_reason        TEXT,
    key_details           JSONB NOT NULL,
    attachment_notes      TEXT,
    headline_ta           VARCHAR(200) NOT NULL,
    summary_ta            TEXT NOT NULL,
    citizen_ask_ta        TEXT NOT NULL,
    urgency_reason_ta     TEXT,
    key_details_ta        JSONB NOT NULL,
    attachment_notes_ta   TEXT,
    audio_transcript      TEXT,
    audio_stt_latency_ms  INTEGER,
    gemini_model_used     VARCHAR(60) NOT NULL,
    gemini_latency_ms     INTEGER,
    created_at            TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_gsr_appointment_latest ON grievance_summary_records(appointment_id, is_latest);
CREATE INDEX IF NOT EXISTS ix_gsr_urgency ON grievance_summary_records(urgency);
CREATE INDEX IF NOT EXISTS ix_gsr_category ON grievance_summary_records(category);
CREATE INDEX IF NOT EXISTS ix_gsr_department ON grievance_summary_records(department);
CREATE INDEX IF NOT EXISTS ix_gsr_created_at ON grievance_summary_records(created_at);

-- ai_uploads
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
    urgency            VARCHAR(20),
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

-- referral tables (separate booking flow)
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
