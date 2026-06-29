# Quick Start Guide - Module 1

Get the QR Generation & Validation system running in 5 minutes.

## Prerequisites

- Python 3.10+
- PostgreSQL 14+ running locally or remotely
- pip package manager

## Step-by-Step Setup

### 1. Install Dependencies (2 minutes)

```bash
cd backend
pip install -r requirements.txt
```

Expected output: All packages installed successfully.

### 2. Configure Environment (1 minute)

Create `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
DATABASE_URL=postgresql+psycopg://your_user:your_password@localhost:5432/your_database
SECRET_KEY=generate-a-secure-random-key-min-32-characters-long
QR_EXPIRY_SECONDS=300
SESSION_EXPIRY_SECONDS=1800
FRONTEND_FORM_BASE_URL=http://localhost:3000/form
DEBUG=True
```

**Generate a secure SECRET_KEY:**
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. Create Database Tables (30 seconds)

```bash
alembic upgrade head
```

Expected output:
```
Starting database initialization...
Creating database tables...
✓ All tables created successfully!
```

### 4. Start the Server (30 seconds)

```bash
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### 5. Test the API (1 minute)

Open your browser or use curl:

**Health Check:**
```bash
curl http://localhost:8000/health
```

**Generate QR Code:**
```bash
curl "http://localhost:8000/api/v1/qr/generate?venue_id=venue_123"
```

**Verify QR Code:**
```bash
# Use the signature from the generate response
curl -L "http://localhost:8000/api/v1/qr/verify?signature=YOUR_SIGNATURE&device_fingerprint=test_fp_123"
```

**Interactive API Docs:**
Open http://localhost:8000/api/docs in your browser.

## Troubleshooting

### Database Connection Error

**Error:** `sqlalchemy.exc.OperationalError: could not connect to server`

**Solution:**
1. Verify PostgreSQL is running: `pg_isready`
2. Check DATABASE_URL credentials in `.env`
3. Ensure database exists: `createdb your_database`

### Import Error

**Error:** `ModuleNotFoundError: No module named 'src'`

**Solution:**
Run commands from the `backend/` directory, not from `backend/src/`.

### SECRET_KEY Error

**Error:** `ValidationError: SECRET_KEY field required`

**Solution:**
Ensure `.env` file exists and contains `SECRET_KEY=...`

### Port Already in Use

**Error:** `OSError: [Errno 48] Address already in use`

**Solution:**
```bash
# Use a different port
uvicorn src.main:app --reload --port 8001

# Or kill the process using port 8000
# Windows:
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -ti:8000 | xargs kill -9
```

## Next Steps

1. **Test with Postman/Insomnia**: Import the OpenAPI spec from http://localhost:8000/api/openapi.json
2. **Integrate with Frontend**: Use the verification URL in your QR code display
3. **Add Monitoring**: Set up logging and error tracking
4. **Production Deploy**: Follow the Production Deployment Checklist in README.md

## Common Workflows

### Regenerate Database Tables

```bash
# Drop all tables (CAUTION: Deletes all data)
python -c "from src.core.database import Base, engine; import asyncio; asyncio.run(Base.metadata.drop_all(bind=engine))"

# Recreate tables
alembic upgrade head
```

### Run Tests

```bash
pytest tests/ -v
```

### Check Code Quality

```bash
# Install dev dependencies
pip install black flake8 mypy

# Format code
black src/

# Lint code
flake8 src/

# Type check
mypy src/
```

## Support

For issues or questions:
1. Check the main README.md
2. Review API documentation at /api/docs
3. Check application logs for error details
