# Citizen Scheduler API - Module 1: QR Generation & Validation

High-traffic citizen scheduler application with QR-based access control using pure PostgreSQL (no Redis, no Celery).

## Architecture Overview

### Technology Stack
- **Framework**: FastAPI (async/await)
- **Database**: PostgreSQL with psycopg driver
- **ORM**: SQLAlchemy 2.0 (async)
- **Security**: itsdangerous (cryptographic signing)
- **Server**: Uvicorn (ASGI)

### Module 1 Features
- ✅ Cryptographically signed QR code generation
- ✅ Time-based QR expiration (configurable TTL)
- ✅ Replay attack prevention
- ✅ Device fingerprint tracking
- ✅ Single-use session token generation
- ✅ Async/await non-blocking I/O throughout

## Project Structure

```
backend/
├── src/
│   ├── __init__.py
│   ├── main.py                    # FastAPI application entry point
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py              # Settings management (pydantic)
│   │   └── database.py            # SQLAlchemy async engine & session
│   ├── models/
│   │   ├── __init__.py
│   │   └── qr_models.py           # QRLog & GatekeeperSession models
│   ├── services/
│   │   ├── __init__.py
│   │   └── qr_service.py          # Business logic for QR lifecycle
│   └── api/
│       ├── __init__.py
│       └── v1/
│           ├── __init__.py
│           └── qr.py              # QR generation & verification routes
├── create_tables.py               # Database initialization script
├── requirements.txt               # Python dependencies
├── .env                          # Environment variables (gitignored)
└── .env.example                  # Example environment configuration
```

## Database Schema

### Table: `qr_logs`
Tracks generated QR codes with cryptographic signatures.

| Column              | Type         | Constraints           | Purpose                          |
|---------------------|--------------|----------------------|----------------------------------|
| id                  | BigInteger   | PRIMARY KEY          | Unique identifier                |
| qr_signature_hash   | String(255)  | UNIQUE, INDEXED      | SHA-256 hash of signature        |
| venue_id            | String(100)  | NOT NULL             | Venue/location identifier        |
| created_at          | DateTime     | NOT NULL             | Generation timestamp             |
| expires_at          | DateTime     | NOT NULL, INDEXED    | Expiration timestamp             |

**Indexes:**
- `qr_signature_hash` (unique) - O(1) signature verification
- `expires_at` - Efficient cleanup queries
- `idx_venue_expires` (composite) - Venue-based queries with expiration

### Table: `gatekeeper_sessions`
Manages ephemeral session tokens for form access.

| Column              | Type         | Constraints           | Purpose                          |
|---------------------|--------------|----------------------|----------------------------------|
| id                  | BigInteger   | PRIMARY KEY          | Unique identifier                |
| session_token       | UUID         | UNIQUE, DEFAULT      | PostgreSQL gen_random_uuid()     |
| device_fingerprint  | String(255)  | NOT NULL             | Browser/device fingerprint       |
| is_used             | Boolean      | DEFAULT FALSE        | Single-use enforcement           |
| created_at          | DateTime     | NOT NULL             | Creation timestamp               |
| expires_at          | DateTime     | NOT NULL, INDEXED    | Expiration timestamp             |

**Indexes:**
- `session_token` (unique) - O(1) token validation
- `expires_at` - Efficient cleanup queries
- `idx_fingerprint_created` (composite) - Security audit queries

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual configuration
```

**Required Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string (psycopg format)
- `SECRET_KEY`: Cryptographic secret (min 32 characters)
- `QR_EXPIRY_SECONDS`: QR code TTL (default: 300)
- `SESSION_EXPIRY_SECONDS`: Session token TTL (default: 1800)
- `FRONTEND_FORM_BASE_URL`: Frontend form URL for redirects

### 3. Create Database Tables

```bash
python create_tables.py
```

### 4. Run the Application

```bash
# Development mode (with auto-reload)
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Production mode
uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API Endpoints

### 1. Generate QR Code

**Endpoint:** `GET /api/v1/qr/generate`

**Query Parameters:**
- `venue_id` (required): Unique venue identifier (1-100 chars)

**Response:**
```json
{
  "signature": "venue_123.XYZ123.abc456",
  "verification_url": "/api/v1/qr/verify?signature=venue_123.XYZ123.abc456",
  "expires_at": "2024-01-15T10:30:00",
  "venue_id": "venue_123",
  "qr_expiry_seconds": 300
}
```

**Example:**
```bash
curl "http://localhost:8000/api/v1/qr/generate?venue_id=venue_123"
```

### 2. Verify QR Code

**Endpoint:** `GET /api/v1/qr/verify`

**Query Parameters:**
- `signature` (required): Signed token from QR code

**Headers Used (Automatic):**
- `User-Agent`: Browser/OS information
- `Accept-Language`: User's language preferences
- `Accept-Encoding`: Compression methods supported
- Client IP address (from request.client.host)

**Response:**
- HTTP 307 Redirect to: `{FRONTEND_FORM_BASE_URL}?token={session_uuid}`

**Example:**
```bash
curl -L "http://localhost:8000/api/v1/qr/verify?signature=venue_123.XYZ.abc"
```

**Note:** Device fingerprint is automatically generated server-side from request headers for enhanced security.

### 3. Health Check

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "healthy",
  "app_name": "Citizen Scheduler API",
  "version": "1.0.0"
}
```

## Security Features

### 1. Cryptographic Signing
- Uses `itsdangerous.TimestampSigner` with SECRET_KEY
- Tamper-proof signatures with embedded timestamps
- Automatic expiration validation

### 2. Replay Attack Prevention
- SHA-256 signature hashing for uniqueness
- Database-level unique constraints
- Session deduplication by device fingerprint

### 3. Time-Based Expiration
- Dual expiration checks (cryptographic + database)
- Configurable TTL for QR codes and sessions
- Indexed `expires_at` columns for efficient cleanup

### 4. Transaction Safety
- Async transactions with automatic rollback
- SELECT FOR UPDATE row-level locking
- Atomic session creation

## Performance Optimizations

### Database Connection Pool
- Pool size: 20 persistent connections
- Max overflow: 10 additional connections
- Pool pre-ping: Connection health checks
- Pool recycle: 1-hour connection refresh

### Indexes
- Unique indexes on signature hashes and tokens
- Composite indexes for common query patterns
- Expiration indexes for cleanup operations

### Async/Await
- Non-blocking I/O throughout the stack
- Async SQLAlchemy sessions
- Async route handlers

## Testing

```bash
# Run tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html
```

## API Documentation

Interactive API documentation available at:
- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc
- **OpenAPI JSON**: http://localhost:8000/api/openapi.json

## Production Deployment Checklist

- [ ] Change `SECRET_KEY` to cryptographically secure random value
- [ ] Set `DEBUG=False` in production
- [ ] Configure CORS `allow_origins` to specific domains
- [ ] Use environment-specific DATABASE_URL
- [ ] Set up database connection pooling limits
- [ ] Configure Uvicorn workers based on CPU cores
- [ ] Set up database backup strategy
- [ ] Implement log aggregation and monitoring
- [ ] Add rate limiting middleware
- [ ] Set up SSL/TLS termination
- [ ] Configure database cleanup cron jobs for expired records

## Future Enhancements (Module 2+)

- Form submission handling
- Appointment scheduling logic
- SMS/Email notifications
- Admin dashboard
- Analytics and reporting
- Multi-venue management

## License

Proprietary - All rights reserved
