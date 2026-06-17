# Module 1 Architecture - QR Generation & Validation

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CITIZEN SCHEDULER API                        │
│                         Module 1: QR System                          │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Display    │         │   Citizen    │         │   Frontend   │
│   Screen     │         │   Mobile     │         │   Form App   │
└──────┬───────┘         └──────┬───────┘         └──────▲───────┘
       │                        │                        │
       │ 1. Request QR          │ 2. Scan QR            │ 4. Redirect
       │                        │                        │
       ▼                        ▼                        │
┌─────────────────────────────────────────────────────────────────────┐
│                         FastAPI Application                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  GET /api/v1/qr/generate?venue_id=X                          │  │
│  │  ├─► QRService.generate_rotating_qr()                        │  │
│  │  │   ├─► TimestampSigner.sign(venue_id)                      │  │
│  │  │   ├─► SHA256(signature) → hash                            │  │
│  │  │   └─► INSERT INTO qr_logs (hash, venue, expires_at)       │  │
│  │  └─► Return {signature, verification_url, expires_at}        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  GET /api/v1/qr/verify?signature=X&device_fingerprint=Y      │  │
│  │  ├─► QRService.verify_qr_and_create_session()               │  │
│  │  │   ├─► TimestampSigner.unsign(signature, max_age)         │  │
│  │  │   ├─► SELECT FROM qr_logs WHERE hash = SHA256(sig)       │  │
│  │  │   ├─► Validate expiration & prevent replay               │  │
│  │  │   └─► INSERT INTO gatekeeper_sessions (token, fp)        │  │
│  │  └─► HTTP 307 Redirect → {FRONTEND_URL}?token={UUID}        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                             │
│  ┌────────────────────────┐    ┌────────────────────────────────┐  │
│  │      qr_logs           │    │   gatekeeper_sessions          │  │
│  ├────────────────────────┤    ├────────────────────────────────┤  │
│  │ id (PK)                │    │ id (PK)                        │  │
│  │ qr_signature_hash (UQ) │    │ session_token (UUID, UQ)       │  │
│  │ venue_id               │    │ device_fingerprint             │  │
│  │ created_at             │    │ is_used                        │  │
│  │ expires_at (IDX)       │    │ created_at                     │  │
│  └────────────────────────┘    │ expires_at (IDX)               │  │
│                                └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Request Flow Diagrams

### Flow 1: QR Code Generation

```
Display Screen                FastAPI                    Database
     │                           │                           │
     │  GET /generate            │                           │
     │  ?venue_id=venue_123      │                           │
     ├──────────────────────────►│                           │
     │                           │                           │
     │                           │  Sign payload with        │
     │                           │  TimestampSigner          │
     │                           │  (venue_123 + timestamp)  │
     │                           │                           │
     │                           │  Compute SHA-256 hash     │
     │                           │  of signature             │
     │                           │                           │
     │                           │  INSERT qr_logs           │
     │                           ├──────────────────────────►│
     │                           │                           │
     │                           │  ◄────────────────────────┤
     │                           │  Row inserted (id=1)      │
     │                           │                           │
     │  ◄────────────────────────┤                           │
     │  {                        │                           │
     │    signature: "venue_123.│                           │
     │      XYZ.abc",            │                           │
     │    verification_url: "...",                           │
     │    expires_at: "2024-...",│                           │
     │    venue_id: "venue_123"  │                           │
     │  }                        │                           │
     │                           │                           │
     │  Display QR Code          │                           │
     │  (encode verification_url)│                           │
     │                           │                           │
```

### Flow 2: QR Code Verification & Session Creation

```
Citizen Mobile            FastAPI                    Database              Frontend
     │                       │                           │                     │
     │  Scan QR Code         │                           │                     │
     │  GET /verify          │                           │                     │
     │  ?signature=...       │                           │                     │
     │  &device_fp=...       │                           │                     │
     ├──────────────────────►│                           │                     │
     │                       │                           │                     │
     │                       │  Unsign & validate        │                     │
     │                       │  timestamp (max_age=300s) │                     │
     │                       │                           │                     │
     │                       │  Compute signature hash   │                     │
     │                       │                           │                     │
     │                       │  SELECT FROM qr_logs      │                     │
     │                       │  WHERE hash = ?           │                     │
     │                       │  FOR UPDATE               │                     │
     │                       ├──────────────────────────►│                     │
     │                       │                           │                     │
     │                       │  ◄────────────────────────┤                     │
     │                       │  QR found, not expired    │                     │
     │                       │                           │                     │
     │                       │  Check for existing       │                     │
     │                       │  session (replay attack)  │                     │
     │                       ├──────────────────────────►│                     │
     │                       │                           │                     │
     │                       │  ◄────────────────────────┤                     │
     │                       │  No active session        │                     │
     │                       │                           │                     │
     │                       │  INSERT gatekeeper_       │                     │
     │                       │  sessions (UUID token)    │                     │
     │                       ├──────────────────────────►│                     │
     │                       │                           │                     │
     │                       │  ◄────────────────────────┤                     │
     │                       │  Session created          │                     │
     │                       │  token=uuid-abc-123       │                     │
     │                       │                           │                     │
     │  ◄────────────────────┤                           │                     │
     │  HTTP 307 Redirect    │                           │                     │
     │  Location: {FRONTEND} │                           │                     │
     │  ?token=uuid-abc-123  │                           │                     │
     │                       │                           │                     │
     │  Browser follows      │                           │                     │
     │  redirect             │                           │                     │
     ├───────────────────────────────────────────────────────────────────────►│
     │                       │                           │                     │
     │                       │                           │  ◄──────────────────┤
     │                       │                           │  Validate token     │
     │                       │                           │  Load form          │
     │                       │                           │                     │
```

## Security Architecture

### 1. Cryptographic Signing (itsdangerous)

```python
# Signing Process
payload = "venue_123"
timestamp = current_unix_timestamp()
signature = HMAC-SHA256(SECRET_KEY, payload + timestamp)
signed_token = f"{payload}.{timestamp}.{signature}"

# Verification Process
parts = signed_token.split('.')
payload, timestamp, signature = parts[0], parts[1], parts[2]

# Verify signature
expected_sig = HMAC-SHA256(SECRET_KEY, payload + timestamp)
if signature != expected_sig:
    raise BadSignature()

# Verify timestamp
if (current_time - timestamp) > max_age:
    raise SignatureExpired()
```

### 2. Replay Attack Prevention

```
┌─────────────────────────────────────────────────────────────┐
│  Defense Layer 1: Unique Signature Hashing                  │
│  ─────────────────────────────────────────────────────────  │
│  • SHA-256 hash of signature stored in qr_logs              │
│  • UNIQUE constraint on qr_signature_hash column            │
│  • Prevents duplicate QR generation                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Defense Layer 2: Time-Based Expiration                     │
│  ─────────────────────────────────────────────────────────  │
│  • Cryptographic expiration (itsdangerous max_age)          │
│  • Database expiration (expires_at column)                  │
│  • Dual validation for defense in depth                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Defense Layer 3: Session Deduplication                     │
│  ─────────────────────────────────────────────────────────  │
│  • Check for existing active session by device_fingerprint  │
│  • Prevent multiple sessions from same QR scan              │
│  • Row-level locking (SELECT FOR UPDATE)                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Defense Layer 4: Single-Use Enforcement                    │
│  ─────────────────────────────────────────────────────────  │
│  • is_used flag in gatekeeper_sessions                      │
│  • Mark token as used after form submission (Module 2)      │
│  • Prevent token reuse across multiple submissions          │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema Design

### Indexing Strategy

```sql
-- qr_logs table
CREATE TABLE qr_logs (
    id BIGSERIAL PRIMARY KEY,
    qr_signature_hash VARCHAR(255) UNIQUE NOT NULL,  -- Index 1: Unique
    venue_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL                     -- Index 2: Expiration
);

CREATE INDEX idx_qr_logs_expires_at ON qr_logs(expires_at);
CREATE INDEX idx_venue_expires ON qr_logs(venue_id, expires_at);

-- gatekeeper_sessions table
CREATE TABLE gatekeeper_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),  -- Index 1: Unique
    device_fingerprint VARCHAR(255) NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL                                  -- Index 2: Expiration
);

CREATE INDEX idx_sessions_expires_at ON gatekeeper_sessions(expires_at);
CREATE INDEX idx_fingerprint_created ON gatekeeper_sessions(device_fingerprint, created_at);
```

### Query Performance

| Query Type                    | Index Used              | Complexity |
|-------------------------------|-------------------------|------------|
| Verify QR signature           | qr_signature_hash (UQ)  | O(1)       |
| Validate session token        | session_token (UQ)      | O(1)       |
| Cleanup expired QRs           | expires_at              | O(log n)   |
| Cleanup expired sessions      | expires_at              | O(log n)   |
| Check device replay           | idx_fingerprint_created | O(log n)   |
| Venue-based QR queries        | idx_venue_expires       | O(log n)   |

## Async/Await Architecture

### Connection Pool Management

```python
# Engine Configuration
engine = create_async_engine(
    DATABASE_URL,
    pool_size=20,        # Persistent connections
    max_overflow=10,     # Burst capacity
    pool_pre_ping=True,  # Health checks
    pool_recycle=3600    # 1-hour refresh
)

# Total capacity: 30 concurrent connections
# Supports ~3000 req/s on modern hardware
```

### Transaction Lifecycle

```python
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()  # Auto-commit on success
        except Exception:
            await session.rollback()  # Auto-rollback on error
            raise
        finally:
            await session.close()  # Always cleanup
```

## Performance Characteristics

### Expected Throughput

| Metric                  | Value          | Notes                        |
|-------------------------|----------------|------------------------------|
| QR Generation Rate      | 1000-2000/s    | CPU-bound (signing)          |
| QR Verification Rate    | 500-1000/s     | DB-bound (SELECT + INSERT)   |
| Avg Response Time (gen) | 5-10ms         | Without DB contention        |
| Avg Response Time (ver) | 15-30ms        | Includes DB round-trips      |
| Connection Pool Size    | 30             | 20 base + 10 overflow        |
| Max Concurrent Requests | 1000+          | Async I/O multiplexing       |

### Scalability Considerations

1. **Horizontal Scaling**: Stateless API allows multiple instances behind load balancer
2. **Database Scaling**: Read replicas for verification queries (future)
3. **Caching**: Redis for hot QR signatures (future optimization)
4. **CDN**: Static QR images can be cached at edge (future)

## Error Handling Strategy

```
┌─────────────────────────────────────────────────────────────┐
│  HTTP 400 Bad Request                                        │
│  ─────────────────────────────────────────────────────────  │
│  • Invalid venue_id format                                   │
│  • Expired QR signature                                      │
│  • Tampered signature (BadSignature)                         │
│  • Replay attack detected                                    │
│  • Active session already exists                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  HTTP 404 Not Found                                          │
│  ─────────────────────────────────────────────────────────  │
│  • QR signature not found in database                        │
│  • Forged or invalid QR code                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  HTTP 500 Internal Server Error                             │
│  ─────────────────────────────────────────────────────────  │
│  • Database connection failure                               │
│  • Transaction deadlock                                      │
│  • Unexpected exception                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  HTTP 307 Temporary Redirect                                 │
│  ─────────────────────────────────────────────────────────  │
│  • Successful QR verification                                │
│  • Session token created                                     │
│  • Redirect to frontend form                                 │
└─────────────────────────────────────────────────────────────┘
```

## Future Enhancements

### Module 2: Form Submission
- Session token validation
- Form data persistence
- Appointment slot allocation

### Module 3: Notifications
- SMS/Email confirmation
- Reminder scheduling
- Status updates

### Module 4: Analytics
- QR scan metrics
- Venue utilization tracking
- Session conversion rates

### Module 5: Admin Dashboard
- Real-time monitoring
- Venue management
- User analytics
