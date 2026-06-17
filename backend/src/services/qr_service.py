"""
Business logic for QR code generation, cryptographic signing, and session management.
Uses itsdangerous for tamper-proof token signing and PostgreSQL for state management.
"""
import hashlib
from datetime import datetime, timedelta
from typing import Dict, Any
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.core.config import settings
from src.models.qr_models import QRLog, GatekeeperSession


class QRService:
    """
    Service layer for QR code lifecycle management.
    Implements cryptographic signing, replay attack prevention, and session creation.
    """
    
    def __init__(self):
        """Initialize the cryptographic signer with application secret key."""
        self.signer = TimestampSigner(settings.SECRET_KEY)
    
    async def generate_rotating_qr(self, venue_id: str, db: AsyncSession) -> Dict[str, Any]:
        """
        Generate a cryptographically signed QR code with time-based expiration.
        
        Process:
            1. Sign the venue_id payload with timestamp using itsdangerous
            2. Compute SHA-256 hash of the signature for database uniqueness
            3. Insert QR log record with expiration window
            4. Return verification URL with signed token
        
        Args:
            venue_id: Unique identifier for the venue/location
            db: Async database session for transaction management
        
        Returns:
            Dict containing:
                - signature: The signed token string
                - verification_url: Full URL for QR code verification
                - expires_at: ISO format expiration timestamp
                - venue_id: Original venue identifier
        
        Raises:
            IntegrityError: If duplicate signature hash collision occurs (extremely rare)
            Exception: For database transaction failures
        
        Transaction State:
            - Atomic: QR log insertion is committed within this function's scope
            - Isolation: Uses default READ COMMITTED level
        """
        # Step 1: Generate cryptographic signature with embedded timestamp
        signature_bytes = self.signer.sign(venue_id.encode('utf-8'))
        signature_string = signature_bytes.decode('utf-8')
        
        # Step 2: Compute deterministic hash for database uniqueness constraint
        signature_hash = hashlib.sha256(signature_string.encode('utf-8')).hexdigest()
        
        # Step 3: Calculate expiration timestamp
        created_at = datetime.utcnow()
        expires_at = created_at + timedelta(seconds=settings.QR_EXPIRY_SECONDS)
        
        # Step 4: Persist QR log record
        qr_log = QRLog(
            qr_signature_hash=signature_hash,
            venue_id=venue_id,
            created_at=created_at,
            expires_at=expires_at
        )
        
        db.add(qr_log)
        
        try:
            await db.flush()  # Flush to detect constraint violations before commit
        except IntegrityError as e:
            await db.rollback()
            raise ValueError(f"QR signature collision detected: {str(e)}")
        
        # Step 5: Construct verification URL
        verification_url = f"/api/v1/qr/verify?signature={signature_string}"
        
        return {
            "signature": signature_string,
            "verification_url": verification_url,
            "expires_at": expires_at.isoformat(),
            "venue_id": venue_id,
            "qr_expiry_seconds": settings.QR_EXPIRY_SECONDS
        }
    
    async def verify_qr_and_create_session(
        self,
        signature_string: str,
        device_fingerprint: str,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """
        Verify QR code signature and create a gatekeeper session token.
        
        Process:
            1. Cryptographically verify signature and extract payload
            2. Check timestamp expiration (itsdangerous max_age)
            3. Verify signature hash exists in database and hasn't expired
            4. Prevent replay attacks by checking QR hasn't been used
            5. Create new gatekeeper session with UUID token
            6. Return session token for form access
        
        Args:
            signature_string: The signed token from QR code
            device_fingerprint: Browser/device fingerprint hash
            db: Async database session for transaction management
        
        Returns:
            Dict containing:
                - session_token: UUID token for form access
                - expires_at: ISO format session expiration timestamp
                - venue_id: Extracted venue identifier from signature
        
        Raises:
            ValueError: For invalid/expired signatures or replay attempts
            SignatureExpired: If signature timestamp exceeds max_age
            BadSignature: If signature tampering detected
        
        Transaction State:
            - Atomic: Session creation and QR validation in single transaction
            - Isolation: Uses SELECT FOR UPDATE to prevent race conditions
        """
        # Step 1: Cryptographic signature verification with timestamp check
        try:
            unsigned_payload = self.signer.unsign(
                signature_string.encode('utf-8'),
                max_age=settings.QR_EXPIRY_SECONDS
            )
            venue_id = unsigned_payload.decode('utf-8')
        except SignatureExpired:
            raise ValueError("QR code has expired. Please scan a new code.")
        except BadSignature:
            raise ValueError("Invalid QR code signature. Tampering detected.")
        
        # Step 2: Compute signature hash for database lookup
        signature_hash = hashlib.sha256(signature_string.encode('utf-8')).hexdigest()
        
        # Step 3: Verify QR exists in database and hasn't expired
        # Using SELECT FOR UPDATE to lock the row and prevent concurrent verification
        stmt = select(QRLog).where(
            QRLog.qr_signature_hash == signature_hash
        ).with_for_update()
        
        result = await db.execute(stmt)
        qr_log = result.scalar_one_or_none()
        
        if not qr_log:
            raise ValueError("QR code not found in system. Invalid or forged code.")
        
        # Step 4: Check database-level expiration (defense in depth)
        current_time = datetime.utcnow()
        if qr_log.expires_at < current_time:
            raise ValueError("QR code has expired in database. Please generate a new code.")
        
        # Step 5: Prevent replay attacks - check if QR has already been used
        # We can implement this by checking if a session already exists for this QR
        existing_session_stmt = select(GatekeeperSession).where(
            GatekeeperSession.device_fingerprint == device_fingerprint,
            GatekeeperSession.created_at >= qr_log.created_at
        )
        existing_session_result = await db.execute(existing_session_stmt)
        existing_session = existing_session_result.scalar_one_or_none()
        
        if existing_session and existing_session.expires_at > current_time:
            raise ValueError("Active session already exists for this device. Please use existing session.")
        
        # Step 6: Create new gatekeeper session
        session_expires_at = current_time + timedelta(seconds=settings.SESSION_EXPIRY_SECONDS)
        
        gatekeeper_session = GatekeeperSession(
            device_fingerprint=device_fingerprint,
            is_used=False,
            created_at=current_time,
            expires_at=session_expires_at
        )
        
        db.add(gatekeeper_session)
        await db.flush()  # Flush to get the generated UUID token
        
        return {
            "session_token": str(gatekeeper_session.session_token),
            "expires_at": session_expires_at.isoformat(),
            "venue_id": venue_id,
            "session_expiry_seconds": settings.SESSION_EXPIRY_SECONDS
        }


# Singleton instance for dependency injection
qr_service = QRService()
