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

# Create all tables
alembic upgrade head

# Verify tables were created
python check_all_tables.py
```

### 3. Static Assets
Ensure these directories exist:
- `backend/assets/` - Static assets (e.g., TN-logo.jpeg)
- `backend/uploads/` - File upload storage (will be created automatically)
- `backend/templates/` - Jinja2 templates

### 4. Security Checklist
- [ ] Change default `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`
- [ ] Generate strong `SECRET_KEY` (use: `python -c "import secrets; print(secrets.token_urlsafe(32))"`)
- [ ] Generate strong `ENCRYPTION_KEY` (use: `python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"`)
- [ ] Set proper CORS origins in production
- [ ] Enable HTTPS/SSL certificates
- [ ] Set up firewall rules (allow only necessary ports)

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

1. **Tables not created**
   - Run `alembic upgrade head` again
   - Check database connection string
   - Verify PostgreSQL is running

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
