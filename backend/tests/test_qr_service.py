"""
Unit tests for QR service functionality.
Tests cryptographic signing, verification, and session creation.
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool

from src.core.database import Base
from src.models.qr_models import QRLog, GatekeeperSession
from src.services.qr_service import QRService
from src.core.config import settings


@pytest.fixture
async def test_db():
    """Create a test database session."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=NullPool,
        echo=False
    )
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    async with async_session() as session:
        yield session
    
    await engine.dispose()


@pytest.mark.asyncio
async def test_generate_rotating_qr(test_db):
    """Test QR code generation with cryptographic signing."""
    service = QRService()
    venue_id = "test_venue_123"
    
    result = await service.generate_rotating_qr(venue_id, test_db)
    
    assert "signature" in result
    assert "verification_url" in result
    assert "expires_at" in result
    assert result["venue_id"] == venue_id
    assert venue_id in result["signature"]


@pytest.mark.asyncio
async def test_verify_qr_and_create_session(test_db):
    """Test QR verification and session creation."""
    service = QRService()
    venue_id = "test_venue_456"
    device_fp = "test_fingerprint_abc"
    
    # Generate QR first
    qr_data = await service.generate_rotating_qr(venue_id, test_db)
    await test_db.commit()
    
    # Verify QR and create session
    session_data = await service.verify_qr_and_create_session(
        qr_data["signature"],
        device_fp,
        test_db
    )
    
    assert "session_token" in session_data
    assert "expires_at" in session_data
    assert session_data["venue_id"] == venue_id


@pytest.mark.asyncio
async def test_expired_qr_rejection(test_db):
    """Test that expired QR codes are rejected."""
    service = QRService()
    
    # Create an expired QR log manually
    import hashlib
    expired_signature = "expired_venue.timestamp.signature"
    signature_hash = hashlib.sha256(expired_signature.encode()).hexdigest()
    
    expired_qr = QRLog(
        qr_signature_hash=signature_hash,
        venue_id="expired_venue",
        created_at=datetime.utcnow() - timedelta(hours=1),
        expires_at=datetime.utcnow() - timedelta(minutes=30)
    )
    
    test_db.add(expired_qr)
    await test_db.commit()
    
    # Attempt to verify expired QR
    with pytest.raises(ValueError, match="expired"):
        await service.verify_qr_and_create_session(
            expired_signature,
            "test_fp",
            test_db
        )
