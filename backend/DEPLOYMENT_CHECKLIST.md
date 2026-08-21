# Production Deployment Checklist

## Database Tables
The following tables will be created by Alembic migrations (`alembic upgrade head`):

### QR & Session Management
- `qr_logs` - QR code generation and verification tracking
- `gatekeeper_sessions` - Session tokens after QR verification

### Appointment System
- `otp_verifications` - OTP generation and verification records
- `citizens` - Citizen information (encrypted PII)
- `appointments` - Appointment/petition submissions
- `appointment_attachments` - File uploads (images, documents, audio)

### AI Summarization
- `grievance_summary_records` - Gemini AI summarization results

**Total: 7 tables**

## Pre-Deployment Steps

### 1. Environment Variables (.env)
Ensure all required environment variables are set:

```bash
# Database
DATABASE_URL=postgresql+psycopg://user:password@host:port/dbname

# Security
SECRET_KEY=<generate-strong-random-key>
ENCRYPTION_KEY=<generate-32-byte-base64-key>

# QR Code
QR_EXPIRY_SECONDS=300
SESSION_EXPIRY_SECONDS=1800

# Frontend
FRONTEND_FORM_BASE_URL=https://yourdomain.com/form
SERVER_BASE_URL=https://yourdomain.com

# Gemini AI
GEMINI_API_KEY=<your-gemini-api-key>
GEMINI_PRIMARY_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite
GEMINI_FALLBACK_MODEL2=gemini-2.0-flash
GEMINI_SERVICE_TIER=priority

# APM Technologies SMS
APM_SMS_API_KEY=<your-apm-sms-api-key>

# Dashboard Auth
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<change-this-strong-password>

# MSG91 (Optional - if using MSG91 instead of APM)
MSG91_AUTH_KEY=
MSG91_DLT_TEMPLATE_ID=
MSG91_SENDER_ID=
```

### 2. Database Setup

```bash
# Install dependencies
pip install -r requirements.txt
```

**On a FRESH database** (no existing tables): the alembic chain starts at
migration `001` which references v1 tables that were never actually created
by alembic itself, so a bare `alembic upgrade head` will error with
`relation "appointments" does not exist`. Bootstrap first:

```bash
# 1. Build the base schema via the v2 create_all script (idempotent).
python scripts/init_v2_schema.py --db <your-db-name>

# 2. Apply the v2 rename SQL (renames slots columns to what the ORM expects).
psql -d <your-db-name> -f scripts/migrate_v2_final.sql

# 3. Mark alembic as up-to-date so it doesn't try to recreate the tables.
alembic stamp head

# 4. Any future migrations then apply cleanly.
alembic upgrade head
```

**On an existing production database** (already bootstrapped): just apply the
new migrations in the usual way. The defensive migration `060` idempotently
ensures the `slots` table has the current column names — safe to run either
way, no-op if already correct.

```bash
alembic upgrade head
```

Verify: `python verify_setup.py`

### 3. Static Assets
Ensure these directories exist:
- `backend/assets/` - Static assets (e.g., TN-logo.jpeg)
- `backend/uploads/` - File upload storage (will be created automatically)
- `backend/templates/` - Jinja2 templates

### 4. Security Checklist

**Enforced at startup** (app refuses to boot in DEBUG=False mode when any of
these are wrong — see `assert_production_ready` in `src/core/config.py`):

- [ ] `DEBUG=False`  (setting `DEBUG=True` while `DATABASE_URL` points at a
      remote host is ALSO refused, even in "dev" mode — silent-prod-fallback
      guard).
- [ ] Change default `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` (and
      `DISPLAY_*`, `MINISTER_*`, `EVENTS_*` — every credential still holding
      its shipped default blocks startup).
- [ ] `SECRET_KEY` — generate with `python -c "import secrets; print(secrets.token_hex(32))"`.
      Placeholders (`CHANGE_ME…`) and short values are refused.
- [ ] `ENCRYPTION_KEY` — generate with
      `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
      NEVER rotate mid-flight; existing PII becomes unreadable.
- [ ] `COOKIE_SECURE=true`  (session cookies get the Secure flag + HSTS).
- [ ] `CORS_ORIGINS` — set to the exact prod origin(s); any localhost entry
      is refused.

**Recommended (not startup-enforced)**:
- [ ] `RATE_LIMIT_ENABLED=true`  once the reverse proxy is confirmed to forward
      X-Forwarded-For. Off would leave login + OTP unthrottled — enable as soon
      as the proxy IP flow is verified so a shared-egress subnet doesn't
      self-DOS.

**Additional / out-of-band**:
- [ ] Enable HTTPS/SSL certificates in front of the app.
- [ ] Front MinIO with TLS — plaintext `http://` for `FILE_STORAGE_ENDPOINT`
      leaks every citizen upload over the wire.
- [ ] Set up firewall rules (allow only necessary ports).
- [ ] Set `SENTRY_DSN` — otherwise every prod error is silent.
- [ ] Confirm the GCP service-account JSON is mounted OUTSIDE the repo tree
      (`/etc/vpa/vertex.json`, ADC, or `GOOGLE_APPLICATION_CREDENTIALS`).

### 5. Production Server
```bash
# Run with Uvicorn (production)
uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4

# Or with Gunicorn + Uvicorn workers
gunicorn src.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### 6. Monitoring & Logging
- [ ] Set up application logging
- [ ] Monitor SMS delivery success rates
- [ ] Monitor Gemini AI API usage and costs
- [ ] Set up database backups
- [ ] Monitor disk space for uploads directory

### 7. Testing Before Go-Live
- [ ] Test QR code generation and scanning
- [ ] Test OTP flow (SMS delivery)
- [ ] Test form submission with attachments
- [ ] Test AI summarization
- [ ] Test dashboard login and status updates
- [ ] Test status update SMS notifications
- [ ] Verify all 7 database tables exist
- [ ] Test on mobile devices

## Post-Deployment

### Health Check Endpoints
- `GET /health` - Basic health check
- `GET /api/v1/qr/display?venue_id=main_office` - QR display page

### Dashboard Access
- Login: `https://yourdomain.com/dashboard/login`
- Default credentials: Check your `.env` file

### File Upload Limits
- Images: 5 MB per file
- Documents: 5 MB per file
- Audio: 10 MB per file

### Rate Limits
- OTP generation: 5 requests per minute per IP
- OTP verification: 5 requests per minute per IP
- Form submission: Standard rate limits apply

## Troubleshooting

### Common Issues

1. **Tables not created / `relation "appointments" does not exist`**
   - This is a fresh DB. `alembic upgrade head` alone does NOT create the
     v1 base tables (the chain starts at migration 001 which references
     them). See the "Database Setup — on a FRESH database" section above:
     run `scripts/init_v2_schema.py` + `scripts/migrate_v2_final.sql`
     first, then `alembic stamp head`, then normal upgrades.
   - Check database connection string
   - Verify PostgreSQL is running

1a. **500s on every slot query / `column "max_capacity" does not exist`**
   - Migration `060` handles this idempotently — run `alembic upgrade head`.
   - If that isn't an option, apply the rename directly:
     `ALTER TABLE slots RENAME COLUMN total_slots TO max_capacity;`
     `ALTER TABLE slots RENAME COLUMN slots_booked TO booked_count;`

2. **SMS not sending**
   - Check `APM_SMS_API_KEY` is set
   - Verify API key is valid
   - Check console logs for error messages

3. **AI summarization failing**
   - Check `GEMINI_API_KEY` is set
   - Verify API quota/billing
   - Check console logs for Gemini errors

4. **File uploads failing**
   - Ensure `uploads/` directory exists and is writable
   - Check disk space
   - Verify file size limits

## Database Schema

All tables use:
- `id` - Primary key (auto-increment integer)
- `created_at` - Timestamp (UTC)
- Proper indexes for performance
- Foreign key constraints for data integrity

Encrypted fields (using `ENCRYPTION_KEY`):
- `citizens.encrypted_name`
- `citizens.encrypted_mobile`
- `appointments.encrypted_grievance`

## Backup Strategy

Recommended backup schedule:
- Database: Daily full backup + hourly incremental
- Uploads directory: Daily backup
- Environment variables: Secure vault storage

## Support Contacts

For production issues:
- Database: Check PostgreSQL logs
- SMS Gateway: APM Technologies support
- AI Service: Google Gemini API support
