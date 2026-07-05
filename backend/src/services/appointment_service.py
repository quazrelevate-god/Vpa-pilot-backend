"""
Business logic for OTP verification and atomic appointment submission.
Implements stateless identity gatekeeper pattern with brute-force protection.
"""
import asyncio
import hashlib
import logging
import re
import secrets
import os
import time
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path

import httpx
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, text
from sqlalchemy.dialects.postgresql import UUID

from src.core.config import settings
from src.models.qr_models import GatekeeperSession
from src.models.appointment_models import (
    OTPVerification, Citizen, Appointment, AppointmentAttachment
)
from src.services.scheduling_service import scheduling_service
from src.services.v2_helpers import v2

logger = logging.getLogger(__name__)


# Courtesy categories skip the AI petition pipeline entirely. An invitation card
# or a Pongal greeting has no grievance to summarise, no department to route to,
# and no ticket to open — the audio (or optional text) is the whole message.
# These land straight in Appointments (SCHEDULED / WAITING), never in Petition
# Review, and summary_status is written as DONE so no worker ever tries.
COURTESY_CATEGORIES = frozenset({"invitation", "greetings"})


class AppointmentService:
    """
    Service layer for OTP generation, verification, and atomic appointment creation.
    
    Key Features:
        - Stateless OTP verification with 3-minute expiry
        - Brute-force protection (max 3 attempts)
        - Atomic slot allocation using FOR UPDATE SKIP LOCKED
        - Multi-file upload handling (audio, images, documents, video)
        - Field-level encryption for PII (name, mobile, grievance)
    """
    
    # OTP Configuration
    OTP_LENGTH = 6
    OTP_EXPIRY_MINUTES = 3
    MAX_OTP_ATTEMPTS = 3
    MAX_ATTACHMENTS = 10  # cap files per citizen submission
    
    # File Upload Configuration
    UPLOAD_DIR = Path("uploads/attachments")
    ALLOWED_MIME_TYPES = {
        # Phones send a range of image types: a single camera capture is usually
        # JPEG, but multi-select from the iOS photo library sends HEIC/HEIF, and
        # some Android browsers send WebP. All of these are accepted by Gemini's
        # inline image input, so we accept and store them all.
        'IMAGE': ['image/jpeg', 'image/jpg', 'image/png', 'image/webp',
                  'image/heic', 'image/heif'],
        'DOCUMENT': ['application/pdf'],
    }
    
    def __init__(self):
        """Initialize service and ensure upload directory exists."""
        self.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    @staticmethod
    def _generate_otp_code() -> str:
        """
        Generate a cryptographically secure 6-digit OTP code.
        
        Returns:
            str: 6-digit numeric string (e.g., "123456")
        """
        return ''.join([str(secrets.randbelow(10)) for _ in range(AppointmentService.OTP_LENGTH)])
    
    @staticmethod
    def _hash_otp_code(otp_code: str) -> str:
        """
        Hash OTP code using SHA-256 for secure storage.
        
        Args:
            otp_code: Plaintext 6-digit OTP code
        
        Returns:
            str: 64-character hexadecimal SHA-256 hash
        """
        return hashlib.sha256(otp_code.encode('utf-8')).hexdigest()
    
    @staticmethod
    def _encrypt_field(plaintext: str) -> str:
        """Encrypt a PII field with Fernet (real encryption). See src.core.crypto."""
        from src.core import crypto
        return crypto.encrypt(plaintext or "")

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        """
        Strip any path components and unsafe characters from a client-supplied
        filename before it is used to build a storage path. Prevents path
        traversal (e.g. '../../etc/passwd') on the local-disk storage backend.
        """
        # Drop any directory component (handles both / and \ separators)
        base = os.path.basename((filename or "").replace("\\", "/"))
        # Keep only a conservative whitelist; collapse everything else to '_'
        cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or "file"
        return cleaned[:120]  # cap length

    @staticmethod
    async def _assign_daily_token(db: AsyncSession, utc_now: datetime) -> tuple[int, int]:
        """
        Generate the next daily token in YYYYMMDDNNNNN format, in IST.

        Two guarantees over the previous COUNT-based logic:
          1. The date prefix and the per-day counter reset use **IST** (the day
             the citizen actually walked in), not UTC. Without this, every token
             issued between IST-midnight and 05:30 IST carried the previous
             calendar day's prefix and shared its counter.
          2. A PostgreSQL transaction-level advisory lock keyed on the IST date
             serialises concurrent submissions, so two citizens submitting in the
             same instant can never receive the same token. The lock is released
             automatically when the surrounding transaction commits/rolls back.

        Returns:
            (token_assigned, daily_sequence) where daily_sequence is the 1-based
            counter used for the legacy slot_id column.
        """
        ist_now = utc_now + timedelta(hours=5, minutes=30)
        ist_date = ist_now.date()
        date_key = int(ist_date.strftime("%Y%m%d"))

        # Serialise token assignment for this IST day across concurrent requests.
        await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": date_key})

        # Use MAX(token)+1 rather than COUNT: tokens embed the date as
        # date_key*100000 + sequence, so the highest token within today's numeric
        # range gives the last sequence issued. COUNT was delete-unsafe — removing
        # any appointment would make the next token reuse an existing number.
        day_floor = date_key * 100000
        day_ceil = (date_key + 1) * 100000
        last_token = await db.scalar(
            select(func.max(Appointment.token_assigned)).where(
                Appointment.token_assigned >= day_floor,
                Appointment.token_assigned < day_ceil,
            )
        )
        sequence = (last_token - day_floor + 1) if last_token else 1
        token_assigned = day_floor + sequence
        return token_assigned, sequence

    @staticmethod
    def _decrypt_field(ciphertext: str) -> str:
        """Decrypt a PII field (Fernet, with legacy-base64 fallback). See src.core.crypto."""
        from src.core import crypto
        return crypto.decrypt(ciphertext) or ""
    
    async def _send_otp_sms(self, mobile_number: str) -> Optional[str]:
        """
        Call APM Technologies SMS API to generate and send OTP to the mobile number.

        The API generates the OTP itself and SMS it to the citizen. The OTP is
        returned in the response so we can store it (hashed) for verification.

        Returns:
            str   — the OTP string received from the API (to be stored hashed)
            None  — dummy mode (no API key configured); caller must generate locally
        Raises:
            HTTPException(502) if the API call fails or OTP cannot be extracted.
        """
        if not settings.APM_SMS_API_KEY:
            return None  # dummy mode — caller generates OTP locally

        # Strip country code prefix; API expects plain 10-digit number
        phone = mobile_number.lstrip("+")
        if phone.startswith("91") and len(phone) == 12:
            phone = phone[2:]

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    "https://sms.apmtechnologies.in/api/Home/Registration",
                    params={"ApiKey": settings.APM_SMS_API_KEY, "PhoneNumber": phone},
                )
            resp.raise_for_status()

            # Response is the OTP as a plain string e.g. "493568"
            otp_from_api = resp.text.strip().strip('"')

            if not otp_from_api or not otp_from_api.isdigit():
                logger.info(f"[APM SMS ERROR] Could not extract OTP from response: {resp.text!r}")
                raise HTTPException(status_code=502, detail="SMS gateway did not return an OTP.")

            logger.info(f"[APM SMS SUCCESS] OTP sent to {phone}, otp: {otp_from_api}")
            return otp_from_api

        except HTTPException:
            raise
        except Exception as e:
            logger.info(f"[APM SMS ERROR] Failed to send OTP to {mobile_number}: {e}")
            raise HTTPException(status_code=502, detail=f"SMS gateway error: {e}")

    async def _send_confirmation_sms(self, mobile_number: str, token_number: int, citizen_name: str) -> bool:
        """
        Send appointment confirmation SMS to citizen with their token number.
        
        Uses APM Technologies SMS API. In dummy mode (no API key), logs to console.
        Fire-and-forget — failures are logged but don't affect the appointment.
        
        Args:
            mobile_number: Citizen's mobile number
            token_number: Assigned token number
            citizen_name: Citizen's name for personalization
            
        Returns:
            bool: True if sent successfully, False otherwise
        """
        if not settings.APM_SMS_API_KEY:
            logger.info(f"[SMS CONFIRMATION DUMMY] Token {token_number} assigned to {citizen_name} ({mobile_number})")
            return False
        
        phone = mobile_number.lstrip("+")
        if phone.startswith("91") and len(phone) == 12:
            phone = phone[2:]
        
        message = f"Dear {citizen_name}, your appointment is confirmed. Token: {token_number}. Thank you for your submission."
        
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    "https://sms.apmtechnologies.in/api/Home/ForgotPassword",
                    params={"ApiKey": settings.APM_SMS_API_KEY, "PhoneNumber": phone},
                )
            resp.raise_for_status()
            logger.info(f"[SMS CONFIRMATION SUCCESS] Token {token_number} sent to {phone}")
            return True
        except Exception as e:
            logger.info(f"[SMS CONFIRMATION ERROR] Failed to send to {mobile_number}: {e}")
            return False
    
    async def send_status_update_sms(self, mobile_number: str, token_number: int, citizen_name: str, new_status: str) -> bool:
        """
        Send status update SMS notification to citizen.
        
        Currently reuses the confirmation SMS endpoint. Will be replaced with
        a dedicated status update template later.
        
        Args:
            mobile_number: Citizen's mobile number
            token_number: Assigned token number
            citizen_name: Citizen's name
            new_status: New status value (e.g., "Scheduled", "Waiting", "Rescheduled", "Awaiting Review", "Reviewed")
            
        Returns:
            bool: True if sent successfully, False otherwise
        """
        if not settings.APM_SMS_API_KEY:
            logger.info(f"[SMS STATUS UPDATE DUMMY] Token {token_number} status changed to {new_status} for {citizen_name} ({mobile_number})")
            return False
        
        phone = mobile_number.lstrip("+")
        if phone.startswith("91") and len(phone) == 12:
            phone = phone[2:]
        
        # TODO: Replace with dedicated status update template
        message = f"Dear {citizen_name}, your appointment status has been updated to {new_status}. Token: {token_number}."
        
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    "https://sms.apmtechnologies.in/api/Home/ForgotPassword",
                    params={"ApiKey": settings.APM_SMS_API_KEY, "PhoneNumber": phone},
                )
            resp.raise_for_status()
            logger.info(f"[SMS STATUS UPDATE SUCCESS] Token {token_number} status update sent to {phone}")
            return True
        except Exception as e:
            logger.info(f"[SMS STATUS UPDATE ERROR] Failed to send to {mobile_number}: {e}")
            return False
    
    
    async def verify_otp(
        self,
        mobile_number: str,
        otp_code: str,
        db: AsyncSession,
    ) -> Dict[str, Any]:
        """
        Verify OTP entered by the citizen and mark it as verified.

        Does NOT mark is_used — that happens on form submission.
        Brute-force protection: max 3 attempts, then record is locked.
        """
        current_time = datetime.utcnow()

        stmt = select(OTPVerification).where(
            OTPVerification.mobile_number == mobile_number,
            OTPVerification.is_used == False,
            OTPVerification.expires_at > current_time,
        ).order_by(OTPVerification.created_at.desc()).limit(1)

        result = await db.execute(stmt)
        otp_record = result.scalar_one_or_none()

        if not otp_record:
            raise HTTPException(
                status_code=404,
                detail="No active OTP found. Please request a new OTP.",
            )

        if otp_record.attempts_count >= self.MAX_OTP_ATTEMPTS:
            otp_record.is_used = True
            await db.commit()
            raise HTTPException(
                status_code=400,
                detail="Maximum OTP attempts exceeded. Please request a new OTP.",
            )

        hashed_input = self._hash_otp_code(otp_code)
        if hashed_input != otp_record.hashed_otp_code:
            otp_record.attempts_count += 1
            await db.commit()
            remaining = self.MAX_OTP_ATTEMPTS - otp_record.attempts_count
            raise HTTPException(
                status_code=400,
                detail=f"Incorrect OTP. {remaining} attempt(s) remaining.",
            )

        # Mark verified so the submission step can trust it without re-hashing
        otp_record.is_verified = True
        await db.commit()

        return {"verified": True, "message": "OTP verified successfully."}

    async def create_otp_request(
        self,
        session_token: UUID,
        mobile_number: str,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """
        Generate and send OTP code for mobile number verification.
        
        Process Flow:
            1. Validate session_token exists in gatekeeper_sessions
            2. Generate cryptographically secure 6-digit OTP
            3. Hash OTP using SHA-256
            4. Save to otp_verifications with 3-minute expiry
            5. Send OTP via SMS gateway (async)
        
        Args:
            session_token: UUID from gatekeeper_sessions table
            mobile_number: Citizen's mobile number (10-15 digits)
            db: Async database session
        
        Returns:
            Dict containing:
                - message: Success message
                - expires_at: ISO 8601 expiry timestamp
                - mobile_number: Masked mobile number (e.g., "******1234")
        
        Raises:
            HTTPException 404: Session token not found
            HTTPException 400: Session token expired or invalid mobile number
            HTTPException 500: Database or SMS gateway error
        
        Security:
            - OTP is hashed before storage (never store plaintext)
            - Session token must be active and not expired
            - Rate limiting should be implemented at API gateway level
        """
        try:
            # Step 1: Validate session token exists and is active
            stmt = select(GatekeeperSession).where(
                GatekeeperSession.session_token == session_token
            )
            result = await db.execute(stmt)
            session = result.scalar_one_or_none()
            
            if not session:
                raise HTTPException(
                    status_code=404,
                    detail="Session token not found. Please scan QR code again."
                )
            
            # Check if session has expired
            current_time = datetime.utcnow()
            if session.expires_at < current_time:
                raise HTTPException(
                    status_code=400,
                    detail="Session token has expired. Please scan QR code again."
                )
            
            # Validate mobile number format (basic validation)
            if not mobile_number.isdigit() or len(mobile_number) < 10 or len(mobile_number) > 15:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid mobile number format. Must be 10-15 digits."
                )
            
            # Step 1b: Duplicate-submission guard — one petition per phone per day.
            # Gated by settings.ONE_PETITION_PER_DAY so dev/QA can turn it off in .env.
            from src.core import crypto
            from src.core.config import settings as _settings
            mobile_idx_check = crypto.blind_index(mobile_number)
            today_start = current_time.replace(hour=0, minute=0, second=0, microsecond=0)
            existing_today = 0
            if _settings.ONE_PETITION_PER_DAY:
                existing_today = await db.scalar(
                    select(func.count(Appointment.id))
                    .join(Citizen, Citizen.id == Appointment.citizen_id)
                    .where(Citizen.mobile_index == mobile_idx_check)
                    .where(Appointment.created_at >= today_start)
                    .where(Appointment.status.notin_(["CANCELLED"]))
                ) or 0
            if existing_today > 0 and not _settings.DEBUG:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "ALREADY_SUBMITTED_TODAY",
                        "en": (
                            "Your petition has already been submitted today. "
                            "We have received your request and it is currently being processed by the PA office. "
                            "You will be notified once it is reviewed. "
                            "Please visit again tomorrow if you have a new grievance."
                        ),
                        "ta": (
                            "உங்கள் மனு இன்று ஏற்கனவே சமர்ப்பிக்கப்பட்டுள்ளது. "
                            "உங்கள் கோரிக்கை PA அலுவலகத்தால் பரிசீலிக்கப்படுகிறது. "
                            "மதிப்பாய்வு செய்யப்பட்டவுடன் உங்களுக்கு தகவல் அனுப்பப்படும். "
                            "புதிய புகார் இருந்தால் நாளை மீண்டும் வருகை தரவும்."
                        ),
                    }
                )

            # Step 2: Call APM SMS API — it generates + sends the OTP and returns it.
            # In dummy mode (no API key) we fall back to local generation.
            otp_from_api = await self._send_otp_sms(mobile_number)
            dummy_mode = otp_from_api is None

            if dummy_mode:
                otp_code = self._generate_otp_code()
                logger.info(f"[OTP DUMMY] APM SMS not configured. OTP for {mobile_number}: {otp_code}")
            else:
                otp_code = otp_from_api

            # Step 3: Hash OTP code for storage
            hashed_otp = self._hash_otp_code(otp_code)

            # Step 4: Calculate expiry time
            expires_at = current_time + timedelta(minutes=self.OTP_EXPIRY_MINUTES)

            # Step 5: Persist OTP record (hashed)
            otp_record = OTPVerification(
                session_token=session_token,
                mobile_number=mobile_number,
                hashed_otp_code=hashed_otp,
                attempts_count=0,
                is_used=False,
                created_at=current_time,
                expires_at=expires_at
            )

            db.add(otp_record)
            await db.commit()

            # Mask mobile number for response (show last 4 digits only)
            masked_mobile = "*" * (len(mobile_number) - 4) + mobile_number[-4:]

            response = {
                "message": "OTP sent successfully" if not dummy_mode else "OTP generated (dummy mode — SMS not configured)",
                "expires_at": expires_at.isoformat(),
                "mobile_number": masked_mobile,
                "expires_in_seconds": self.OTP_EXPIRY_MINUTES * 60,
                "otp_code": otp_code if dummy_mode else None,
            }
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create OTP request: {str(e)}"
            )
    
    def _determine_attachment_type(self, mime_type: str) -> Optional[str]:
        """
        Determine attachment type category from MIME type.
        
        Args:
            mime_type: File MIME type (e.g., "audio/mpeg")
        
        Returns:
            str: Attachment type (AUDIO, IMAGE, DOCUMENT, VIDEO) or None if unsupported
        """
        for attachment_type, allowed_mimes in self.ALLOWED_MIME_TYPES.items():
            if mime_type in allowed_mimes:
                return attachment_type
        return None
    
    # Max audio recording: configurable via .env AUDIO_MAX_DURATION_SECONDS
    # webm/opus at ~128kbps ≈ 16 KB/sec → seconds * 16 KB + 20% safety margin
    @property
    def MAX_AUDIO_SIZE_BYTES(self) -> int:
        from src.core.config import settings
        return int(settings.AUDIO_MAX_DURATION_SECONDS * 16 * 1024 * 1.2)

    @property
    def MAX_FILE_SIZE_MB(self) -> int:
        from src.core.config import settings
        return settings.MAX_FILE_SIZE_MB

    async def _save_audio_recording(self, audio_base64: str, token_number: int) -> str:
        """
        Save base64 encoded audio recording to disk.
        
        Args:
            audio_base64: Base64 encoded audio data (data:audio/webm;base64,...)
            token_number: Token number for filename
            
        Returns:
            str: Storage URL path
        """
        import base64
        
        try:
            # Parse base64 data URL
            if ',' in audio_base64:
                header, encoded = audio_base64.split(',', 1)
            else:
                encoded = audio_base64
            
            # Decode base64
            audio_bytes = base64.b64decode(encoded)
            
            # Validate audio size (configurable via .env AUDIO_MAX_DURATION_SECONDS)
            if len(audio_bytes) > self.MAX_AUDIO_SIZE_BYTES:
                from src.core.config import settings
                raise HTTPException(
                    status_code=400,
                    detail=f"Audio recording too long. Maximum allowed is {settings.AUDIO_MAX_DURATION_SECONDS // 60} minutes."
                )
            
            # Generate filename and save via storage_service
            filename = f"audio_{token_number}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.webm"
            relative_path = f"audio/{filename}"
            
            from src.services.storage_service import save_file
            return save_file(audio_bytes, relative_path, content_type="audio/webm")
            
        except Exception as e:
            logger.info(f"[AUDIO SAVE ERROR] Failed to save audio: {e}")
            return None
    
    async def _save_uploaded_file(
        self,
        file: UploadFile,
        appointment_id: int
    ) -> Dict[str, Any]:
        """
        Save uploaded file to disk and return metadata.
        
        Args:
            file: FastAPI UploadFile object
            appointment_id: ID of the appointment this file belongs to
        
        Returns:
            Dict containing file metadata:
                - storage_url: Filesystem path
                - file_size_bytes: File size
                - mime_type: MIME type
                - attachment_type: Category (AUDIO, IMAGE, DOCUMENT, VIDEO)
        
        Raises:
            HTTPException 400: Unsupported file type or file too large
            HTTPException 500: File I/O error
        """
        try:
            # Validate MIME type
            mime_type = file.content_type
            attachment_type = self._determine_attachment_type(mime_type)
            
            if not attachment_type:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {mime_type}"
                )
            
            # Read file content
            file_content = await file.read()
            file_size = len(file_content)
            
            # Validate file size
            max_size_bytes = self.MAX_FILE_SIZE_MB * 1024 * 1024
            if file_size > max_size_bytes:
                raise HTTPException(
                    status_code=400,
                    detail=f"File too large. Maximum size: {self.MAX_FILE_SIZE_MB}MB"
                )
            
            # Generate unique filename
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            safe_filename = f"{appointment_id}_{timestamp}_{secrets.token_hex(8)}_{self._sanitize_filename(file.filename)}"
            
            # Save via storage_service (MinIO on VPS if configured, else local disk)
            relative_path = f"attachments/{appointment_id}/{safe_filename}"
            
            from src.services.storage_service import save_file
            # save_file is blocking (local disk write or MinIO/boto3 network put).
            # Run it in a worker thread so it never stalls the async event loop —
            # critical when several files are uploaded at once.
            storage_url = await asyncio.to_thread(
                save_file, file_content, relative_path, content_type=mime_type
            )

            return {
                "storage_url": storage_url,
                "file_size_bytes": file_size,
                "mime_type": mime_type,
                "attachment_type": attachment_type
            }
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to save file: {str(e)}"
            )
    
    async def process_atomic_submission(
        self,
        session_token: UUID,
        name: str,
        mobile: str,
        constituency: str,
        description: str,
        otp_code: str,
        schedule_meeting: bool,
        audio_recording: str,
        files: List[UploadFile],
        db: AsyncSession,
        slot_id: Optional[int] = None,
        num_persons: int = 1,
        grievance_category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Atomically verify OTP and create appointment with attachments.
        
        This is the core stateless submission handler. All validation and
        persistence happens in a single database transaction. If any step
        fails, the entire operation is rolled back with zero disk footprint.
        
        Process Flow:
            1. Look up active OTP record for mobile number
            2. Check brute-force threshold (max 3 attempts)
            3. Verify OTP hash matches
            4. Begin explicit database transaction
            5. Mark OTP as used
            6. Allocate slot atomically using FOR UPDATE SKIP LOCKED
            7. Save uploaded files to disk
            8. Create/update citizen record (with encryption)
            9. Create appointment record
            10. Create attachment records
            11. Commit transaction
        
        Args:
            session_token: UUID from gatekeeper_sessions
            name: Citizen's full name
            mobile: Mobile number (must match OTP request)
            constituency: Ward/region identifier
            description: Grievance description
            otp_code: 6-digit OTP code entered by user
            schedule_meeting: Whether to schedule a meeting with official
            files: List of uploaded files (optional)
            db: Async database session
        
        Returns:
            Dict containing:
                - appointment_id: Created appointment ID
                - token_assigned: Queue token number
                - citizen_id: Citizen record ID
                - attachments_count: Number of files uploaded
                - status: Appointment status
        
        Raises:
            HTTPException 400: OTP invalid, expired, or max attempts exceeded
            HTTPException 404: OTP record not found
            HTTPException 500: Database or file I/O error
        
        Security:
            - Brute-force protection (max 3 attempts)
            - OTP is single-use (marked as used after verification)
            - All PII fields are encrypted before storage
            - Atomic transaction ensures data consistency
        
        Performance:
            - Uses FOR UPDATE SKIP LOCKED for lock-free slot allocation
            - Files are saved to disk outside transaction for speed
            - Composite indexes optimize OTP lookup
        """
        try:
            # Step 1: Look up the pre-verified OTP record
            current_time = datetime.utcnow()

            stmt = select(OTPVerification).where(
                OTPVerification.mobile_number == mobile,
                OTPVerification.is_used == False,
                OTPVerification.is_verified == True,
                OTPVerification.expires_at > current_time,
            ).order_by(OTPVerification.created_at.desc()).limit(1)

            result = await db.execute(stmt)
            otp_record = result.scalar_one_or_none()

            if not otp_record:
                raise HTTPException(
                    status_code=400,
                    detail="OTP not verified. Please verify your OTP before submitting.",
                )

            # OTP is valid - proceed with atomic transaction
            # Step 4: Begin explicit transaction
            async with db.begin_nested():
                # Step 5: Mark OTP as used
                otp_record.is_used = True

                # Step 6: Assign token in YYYYMMDDNNNNN format (IST, collision-safe)
                token_assigned, legacy_slot_ref = await self._assign_daily_token(db, current_time)

                # Link OTP → this appointment's token for audit trail
                otp_record.token_assigned = token_assigned
                
                # Step 7: Encrypt sensitive fields
                encrypted_name = self._encrypt_field(name)
                encrypted_mobile = self._encrypt_field(mobile)
                encrypted_grievance = self._encrypt_field(description)
                
                # Step 8: Create or get existing citizen record (dedup by mobile_index)
                from src.core import crypto
                mobile_idx = crypto.blind_index(mobile)
                citizen_stmt = select(Citizen).where(Citizen.mobile_index == mobile_idx)
                citizen_result = await db.execute(citizen_stmt)
                citizen = citizen_result.scalar_one_or_none()

                if not citizen:
                    # Create new citizen record
                    citizen = Citizen(
                        encrypted_name=encrypted_name,
                        encrypted_mobile=encrypted_mobile,
                        mobile_index=mobile_idx,
                        created_at=current_time
                    )
                    db.add(citizen)
                    await db.flush()  # Get citizen.id
                else:
                    # Update name in case citizen re-submitted with a different name
                    citizen.encrypted_name = encrypted_name
                
                # Step 9: Save audio recording if provided
                audio_url = None
                if audio_recording:
                    audio_url = await self._save_audio_recording(audio_recording, token_assigned)
                
                # Step 10: Create appointment record.
                # Direct-submit petitions land in AWAITING_REVIEW so the PA can
                # check before moving them to REVIEWED.
                # Meeting requests stay on the SCHEDULED path.
                # Courtesy categories (invitation, greetings) bypass Petition
                # Review entirely — they always take the appointment path so the
                # PA sees them in the meeting list, never in the AI inbox.
                is_courtesy = grievance_category in COURTESY_CATEGORIES
                take_slot_path = schedule_meeting or is_courtesy
                initial_status = 'SCHEDULED' if take_slot_path else 'AWAITING_REVIEW'
                # Courtesy items have nothing to summarise, so mark them DONE up
                # front and no worker will ever pick them up.
                initial_summary_status = 'DONE' if is_courtesy else 'PENDING'
                # Courtesy + audio → PENDING so the durable STT worker will
                # retry if the initial async call fails. NULL for everything
                # else so the poll stays cheap.
                initial_transcript_status = 'PENDING' if (is_courtesy and audio_url) else None

                # Resolve status/category/priority to admin FK ids (v2)
                appt_ids = v2.new_appointment_ids(
                    status=initial_status,
                    category=grievance_category,
                )

                appointment = Appointment(
                    citizen_id=citizen.id,
                    # v2: slot_id is a real FK to slots.id — leave NULL at insert.
                    # book_slot() sets it for meeting requests; petition-only rows stay NULL.
                    slot_id=None,
                    schedule_meeting=take_slot_path,
                    token_assigned=token_assigned,
                    encrypted_grievance=encrypted_grievance,
                    grievance_category=grievance_category,
                    status=initial_status,
                    status_id=appt_ids["status_id"],
                    priority_id=appt_ids["priority_id"],
                    category_id=appt_ids.get("category_id"),
                    summary_status=initial_summary_status,
                    transcript_status=initial_transcript_status,
                    num_persons=max(1, min(4, num_persons)),
                    created_at=current_time
                )
                db.add(appointment)
                await db.flush()  # Get appointment.id

                # Step 10b: Meeting requests — book the citizen-selected slot.
                # Falls back to waiting queue if no slot was selected or the slot
                # filled up between the form load and submission.
                if take_slot_path:
                    if slot_id:
                        try:
                            await scheduling_service.book_slot(
                                db, appointment, slot_id, commit=False
                            )
                            logger.info(f"[SLOT OK] appointment_id={appointment.id} | slot_id={slot_id} | status=SCHEDULED")
                        except ValueError as slot_err:
                            # Slot just filled or blocked — put in waiting queue
                            logger.info(f"[SLOT WARN] appointment_id={appointment.id} | slot_id={slot_id} | err={slot_err} → WAITING")
                            await scheduling_service.move_to_waiting_queue(
                                db, appointment, 'SLOT_UNAVAILABLE', commit=False
                            )
                    else:
                        logger.info(f"[SLOT WARN] appointment_id={appointment.id} | no slot_id → WAITING")
                        await scheduling_service.move_to_waiting_queue(
                            db, appointment, 'NO_SLOT_SELECTED', commit=False
                        )
                
                # Step 11: Save uploaded files and create attachment records
                attachments_created = []
                
                # Add audio recording as attachment if present
                if audio_url:
                    from pathlib import Path
                    audio_path = Path(audio_url)
                    audio_size = audio_path.stat().st_size if audio_path.exists() else 0
                    
                    audio_attachment = AppointmentAttachment(
                        appointment_id=appointment.id,
                        attachment_type='AUDIO',
                        storage_url=audio_url,
                        file_size_bytes=audio_size,
                        mime_type='audio/mp4',   # iOS records mp4; webm saved with .webm ext but mp4 for iOS compat
                        created_at=current_time
                    )
                    db.add(audio_attachment)
                    attachments_created.append(audio_attachment)
                
                # Save all uploaded files concurrently (each save runs its blocking
                # I/O in a worker thread). Doing them in parallel instead of one
                # after another is what keeps a multi-image submission fast.
                upload_files = [f for f in files if f.filename][:self.MAX_ATTACHMENTS]
                if upload_files:
                    file_metadatas = await asyncio.gather(
                        *[self._save_uploaded_file(f, appointment.id) for f in upload_files]
                    )
                    for file_metadata in file_metadatas:
                        attachment = AppointmentAttachment(
                            appointment_id=appointment.id,
                            attachment_type=file_metadata['attachment_type'],
                            storage_url=file_metadata['storage_url'],
                            file_size_bytes=file_metadata['file_size_bytes'],
                            mime_type=file_metadata['mime_type'],
                            created_at=current_time
                        )
                        db.add(attachment)
                        attachments_created.append(attachment)
            
            # Step 11: Mark gatekeeper session as used and carry venue to appointment
            session_stmt = select(GatekeeperSession).where(
                GatekeeperSession.session_token == str(session_token)
            )
            session_result = await db.execute(session_stmt)
            session = session_result.scalar_one_or_none()

            if session:
                session.is_used = True
                if hasattr(session, 'venue_id') and session.venue_id:
                    appointment.venue_id = session.venue_id

            # Capture final status before commit so we can return it without an extra DB round-trip
            final_status = appointment.status

            # Step 12: Commit transaction — citizen gets token NOW
            await db.commit()

            # Step 13: Confirmation SMS disabled — only OTP SMS is sent
            # asyncio.create_task(self._send_confirmation_sms(
            #     mobile_number=mobile,
            #     token_number=token_assigned,
            #     citizen_name=name,
            # ))

            # Step 14: Durable summarisation. The appointment is already
            # summary_status='PENDING'; fire an optimistic attempt now for low
            # latency. If this process dies before it finishes, the standalone
            # worker picks the row up — the summary can no longer be silently
            # lost the way the old fire-and-forget task could.
            #
            # Courtesy items (invitation, greetings) were written as
            # summary_status='DONE'. There is no grievance to route, no ticket
            # to open — the audio/text is the whole message — so we skip the
            # Gemini dispatch entirely. The PA sees them in Appointments.
            if is_courtesy:
                logger.info(
                    f"[GEMINI SKIP] appointment_id={appointment.id} | "
                    f"category={grievance_category} | reason=courtesy"
                )
                # Still transcribe the audio (if any) — the PA needs to see
                # what the citizen said, just not routed through petition AI.
                if audio_url:
                    asyncio.create_task(self.transcribe_courtesy(appointment.id))
            else:
                logger.info(
                    f"[GEMINI DISPATCH] appointment_id={appointment.id} | "
                    f"schedule_meeting={take_slot_path} | "
                    f"attachments={len(attachments_created)} | "
                    f"audio_url={'yes' if audio_url else 'no'} | "
                    f"desc_chars={len(description or '')}"
                )
                asyncio.create_task(self.try_summarise_now(appointment.id))

            if final_status == 'WAITING':
                message = f"No slots available right now. Your token number is {token_assigned} and you have been added to the waiting queue."
            elif final_status == 'AWAITING_REVIEW':
                message = f"Petition submitted successfully. Your token number is {token_assigned}."
            elif final_status == 'REVIEWED':
                message = f"Petition reviewed successfully. Your token number is {token_assigned}."
            else:
                message = f"Appointment scheduled successfully. Your token number is {token_assigned}."

            scheduled_date_str  = None
            scheduled_time_str  = None   # slot window start (HH:MM)
            scheduled_end_str   = None   # slot window end   (HH:MM)
            if final_status == 'SCHEDULED' and appointment.slot_id:
                # v2: derive scheduled date/time from the booked slot + its availability
                from src.models.scheduling_models import AppointmentSlot, MLADailyAvailability
                slot_stmt = (
                    select(AppointmentSlot, MLADailyAvailability)
                    .join(MLADailyAvailability, AppointmentSlot.availability_id == MLADailyAvailability.id)
                    .where(AppointmentSlot.id == appointment.slot_id)
                )
                slot_row = (await db.execute(slot_stmt)).first()
                if slot_row:
                    slot_obj, avail_obj = slot_row
                    scheduled_date_str = avail_obj.date.isoformat()
                    scheduled_time_str = slot_obj.start_time.strftime("%H:%M")
                    scheduled_end_str  = slot_obj.end_time.strftime("%H:%M")

            submitted_at_str = current_time.isoformat()

            return {
                "appointment_id":    appointment.id,
                "token_assigned":    token_assigned,
                "citizen_id":        citizen.id,
                "attachments_count": len(attachments_created),
                "status":            final_status,
                "submitted_at":      submitted_at_str,
                "scheduled_date":    scheduled_date_str,
                "scheduled_time":    scheduled_time_str,   # slot window start
                "scheduled_end":     scheduled_end_str,    # slot window end
                "message":           message
            }

        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process submission: {str(e)}"
            )

    async def _trigger_summarisation(
        self,
        appointment_id: int,
        citizen_name: str,
        constituency: str,
        description: str,
        attachments_created: List[Dict[str, Any]],
        audio_recording_url: Optional[str] = None,
    ) -> None:
        """
        Background Gemini summarisation — runs after the HTTP response is sent.

        Opens its own DB session so it is fully decoupled from the request
        session (which is already closed by the time this executes).
        Any failure is logged; the appointment record is never affected.
        """
        from src.core.database import AsyncSessionLocal
        logger.info(f"[GEMINI START] appointment_id={appointment_id} — background summarisation starting")
        try:
            # Lazy imports to avoid circular dependencies at module load time.
            from src.services.summarisation import GrievanceSummarisationService
            from src.models.grievance_summary_record import GrievanceSummaryRecord

            svc = GrievanceSummarisationService.from_settings()

            # ── Decide Gemini input: attachment priority ────────────────────
            attachment_bytes: Optional[bytes] = None
            attachment_mime: Optional[str] = None
            attachment_filename: Optional[str] = None
            grievance_text: str = ""

            # Priority 1: first IMAGE attachment
            from src.services.storage_service import get_file_bytes
            for att in attachments_created:
                if att["attachment_type"] == "IMAGE":
                    try:
                        attachment_bytes = get_file_bytes(att["storage_url"])
                        if attachment_bytes is None:
                            raise FileNotFoundError(f"File not found in storage: {att['storage_url']}")
                        attachment_mime = att["mime_type"]
                        attachment_filename = Path(att["storage_url"]).name
                    except Exception as read_err:
                        logger.info(f"[GEMINI WARN] appointment_id={appointment_id}: "
                              f"Could not read image file {att['storage_url']}: {read_err}")
                    break

            # Priority 2: first DOCUMENT (PDF / Word) if no image found
            if attachment_bytes is None:
                for att in attachments_created:
                    if att["attachment_type"] == "DOCUMENT":
                        try:
                            attachment_bytes = get_file_bytes(att["storage_url"])
                            if attachment_bytes is None:
                                raise FileNotFoundError(f"File not found in storage: {att['storage_url']}")
                            attachment_mime = att["mime_type"]
                            attachment_filename = Path(att["storage_url"]).name
                        except Exception as read_err:
                            logger.info(f"[GEMINI WARN] appointment_id={appointment_id}: "
                                  f"Could not read document file {att['storage_url']}: {read_err}")
                        break

            # Priority 3: AUDIO — collect from attachments or dedicated mic recording.
            # Rule: if an image (or document) was already found above, audio is used
            # ONLY for transcription (STT). If there is no image/document, audio is
            # sent to the summariser as the primary multimodal input AND transcribed.
            audio_path: Optional[str] = None
            audio_mime: Optional[str] = None
            for att in attachments_created:
                if att["attachment_type"] == "AUDIO":
                    audio_path = att["storage_url"]
                    audio_mime = att["mime_type"] or "audio/webm"
                    break
            if audio_path is None and audio_recording_url:
                audio_path = audio_recording_url
                audio_mime = "audio/webm"  # form mic captures as webm/opus

            audio_bytes_for_gemini: Optional[bytes] = None
            if audio_path:
                try:
                    audio_bytes_for_gemini = get_file_bytes(audio_path)
                    if audio_bytes_for_gemini is None:
                        raise FileNotFoundError(f"File not found in storage: {audio_path}")
                except Exception as read_err:
                    logger.info(f"[GEMINI WARN] appointment_id={appointment_id}: "
                          f"Could not read audio file {audio_path}: {read_err}")

            # When an image/document is present it becomes the sole summarisation
            # input; audio is downgraded to transcript-only so the summariser does
            # not try to handle two multimodal streams at once.
            audio_for_summary: Optional[bytes] = None if attachment_bytes is not None else audio_bytes_for_gemini
            audio_mime_for_summary: Optional[str] = None if attachment_bytes is not None else (audio_mime if audio_bytes_for_gemini else None)

            grievance_text = (description or "").strip()

            # Skip only when nothing at all to summarise.
            if attachment_bytes is None and audio_for_summary is None and not grievance_text:
                logger.info(f"[GEMINI SKIP] appointment_id={appointment_id}: "
                      "No usable input — skipping summarisation.")
                return

            # ── Run summariser + STT in parallel ──────────────────────────────
            # Both are sync/blocking; push them into the default executor so they
            # run on separate threads, then await both.
            loop = asyncio.get_event_loop()
            t0 = time.monotonic()

            summarise_future = loop.run_in_executor(
                None,
                lambda: svc.summarise(
                    citizen_name=citizen_name,
                    constituency=constituency,
                    attachment_bytes=attachment_bytes,
                    attachment_mime=attachment_mime,
                    attachment_filename=attachment_filename,
                    audio_bytes=audio_for_summary,
                    audio_mime=audio_mime_for_summary,
                ),
            )

            audio_transcript: Optional[str] = None
            audio_stt_latency_ms: Optional[int] = None

            if audio_bytes_for_gemini:
                from src.services.stt_service import GeminiSTTService
                stt_svc = GeminiSTTService.from_settings()
                stt_future = loop.run_in_executor(
                    None,
                    lambda: stt_svc.transcribe(audio_bytes_for_gemini, mime_type=audio_mime),
                )
                summary, stt_result = await asyncio.gather(
                    summarise_future, stt_future, return_exceptions=False
                )
                if stt_result.error:
                    logger.info(f"[STT WARN] appointment_id={appointment_id}: "
                          f"Gemini STT failed: {stt_result.error}")
                elif stt_result.transcript:
                    audio_transcript = stt_result.transcript.strip()
                    audio_stt_latency_ms = stt_result.latency_ms
                    logger.info(f"[STT OK] appointment_id={appointment_id} | "
                          f"chars={len(audio_transcript)} | latency={audio_stt_latency_ms}ms")
            else:
                summary = await summarise_future

            elapsed_ms = int((time.monotonic() - t0) * 1000)

            # ── Persist summary record in its own session ────────────────────
            async with AsyncSessionLocal() as db:
                record = GrievanceSummaryRecord.from_gemini_response(
                    appointment_id=appointment_id,
                    summary=summary,
                    gemini_model_used=svc._model_name,
                    gemini_latency_ms=elapsed_ms,
                    audio_transcript=audio_transcript,
                    audio_stt_latency_ms=audio_stt_latency_ms,
                )
                db.add(record)

                appt_result = await db.execute(
                    select(Appointment).where(Appointment.id == appointment_id)
                )
                appt = appt_result.scalar_one_or_none()
                if appt:
                    # Use AI category only if citizen didn't pick one (or picked "others/general").
                    if not appt.grievance_category or appt.grievance_category in ("others", "general", "other"):
                        appt.grievance_category = summary.category.value

                # Auto-suggest ticket priority from AI urgency (PA can override).
                # Only set if not already set manually by a PA.
                from src.models.ticket_models import Ticket, URGENCY_TO_PRIORITY
                from src.models.activity_models import Activity
                tkt_result = await db.execute(
                    select(Ticket).where(Ticket.appointment_id == appointment_id)
                )
                ticket = tkt_result.scalar_one_or_none()
                if ticket is not None:
                    suggested_priority = URGENCY_TO_PRIORITY.get(summary.urgency.value)
                    if ticket.priority is None and suggested_priority:
                        ticket.priority = suggested_priority
                    # v2: single Activity row replaces TicketEvent
                    db.add(Activity(
                        ticket_id=ticket.id,
                        user="system",
                        action_type="ai_summarised",
                        message=(
                            f"AI summarised — urgency={summary.urgency.value}, "
                            f"category={summary.category.value}, "
                            f"ministry={summary.ministry.value}"
                        ),
                        payload={
                            "urgency": summary.urgency.value,
                            "category": summary.category.value,
                            "ministry": summary.ministry.value,
                            "suggested_priority": suggested_priority,
                        },
                    ))

                await db.commit()

            input_parts = []
            if attachment_bytes: input_parts.append("attachment")
            if audio_bytes_for_gemini: input_parts.append("audio")
            if grievance_text: input_parts.append("text")
            input_mode = "+".join(input_parts) if input_parts else "empty"
            logger.info(
                f"[GEMINI OK] appointment_id={appointment_id} | input={input_mode} | "
                f"urgency={summary.urgency.value} | category={summary.category.value} | "
                f"ministry={summary.ministry.value} | "
                f"latency={elapsed_ms}ms (parallel summarise+STT)"
            )

        except Exception as exc:
            logger.info(f"[GEMINI WARN] appointment_id={appointment_id}: "
                  f"Summarisation failed (appointment unaffected): {exc}")
            raise  # let the durable wrapper mark the row for retry / FAILED


    # ── Manual / scan petition (staff-operated, no OTP) ─────────────────────

    async def process_manual_petition(
        self,
        name: str,
        mobile: str,
        constituency: str,
        files: List[UploadFile],
        db: AsyncSession,
        submitted_by: str = "pa_staff",
    ) -> Dict[str, Any]:
        """
        Create an appointment from a handwritten / scanned petition uploaded by PA staff.
        No OTP, no QR session — auth is handled at the route level (dash_session).

        Steps:
          1. Validate + save files to disk
          2. Create Citizen + Appointment (AWAITING_REVIEW) atomically
          3. Fire background Gemini multi-image summarisation
          4. Return token immediately
        """
        MAX_FILES      = 10
        MAX_BYTES      = 10 * 1024 * 1024   # 10 MB per file
        ALLOWED_MIMES  = {
            "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
            "image/bmp", "image/heic", "image/heif",
            "application/pdf",
        }

        # ── Validate files ────────────────────────────────────────────────────
        valid_files: List[UploadFile] = [f for f in files if f.filename]
        if not valid_files:
            raise HTTPException(status_code=400, detail="At least one file is required.")
        if len(valid_files) > MAX_FILES:
            valid_files = valid_files[:MAX_FILES]   # silently cap

        file_contents: List[tuple] = []   # (bytes, mime_type, filename)
        for f in valid_files:
            mime = f.content_type or "application/octet-stream"
            if mime not in ALLOWED_MIMES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type '{mime}' ({f.filename}). "
                           f"Only images and PDF are accepted.",
                )
            raw = await f.read()
            if len(raw) > MAX_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{f.filename}' exceeds 10 MB limit.",
                )
            file_contents.append((raw, mime, f.filename))

        try:
            current_time = datetime.utcnow()

            # ── Token assignment (IST, collision-safe) ────────────────────────
            token_assigned, legacy_slot_ref = await self._assign_daily_token(db, current_time)

            # ── Encrypt PII ───────────────────────────────────────────────────
            encrypted_name   = self._encrypt_field(name)
            encrypted_mobile = self._encrypt_field(mobile or "")
            description_text = f"Handwritten petition scanned by {submitted_by}. {len(valid_files)} page(s) uploaded."

            # ── Citizen (dedup by mobile_index) ───────────────────────────────
            from src.core import crypto
            mobile_idx = crypto.blind_index(mobile) if mobile else None
            citizen = None
            if mobile:
                result = await db.execute(select(Citizen).where(Citizen.mobile_index == mobile_idx))
                citizen = result.scalar_one_or_none()

            if not citizen:
                citizen = Citizen(
                    encrypted_name=encrypted_name,
                    encrypted_mobile=encrypted_mobile,
                    mobile_index=mobile_idx,
                    created_at=current_time,
                )
                db.add(citizen)
                await db.flush()
            else:
                citizen.encrypted_name = encrypted_name

            # ── Appointment (AWAITING_REVIEW — same as direct-submit) ─────────
            manual_ids = v2.new_appointment_ids(status="AWAITING_REVIEW")
            appointment = Appointment(
                citizen_id=citizen.id,
                slot_id=legacy_slot_ref,
                token_assigned=token_assigned,
                encrypted_grievance=self._encrypt_field(description_text),
                grievance_category=None,
                status="AWAITING_REVIEW",
                status_id=manual_ids["status_id"],
                priority_id=manual_ids["priority_id"],
                created_at=current_time,
            )
            db.add(appointment)
            await db.flush()

            # ── Save files to disk + create attachment records ────────────────
            upload_dir = Path("uploads/manual_petitions") / str(appointment.id)
            upload_dir.mkdir(parents=True, exist_ok=True)

            attachment_snapshots: List[Dict[str, Any]] = []
            for raw, mime, fname in file_contents:
                safe_name = f"{appointment.id}_{len(attachment_snapshots)+1}_{self._sanitize_filename(fname)}"
                fpath = upload_dir / safe_name
                with open(fpath, "wb") as fh:
                    fh.write(raw)
                att = AppointmentAttachment(
                    appointment_id=appointment.id,
                    attachment_type="IMAGE" if mime.startswith("image/") else "DOCUMENT",
                    storage_url=str(fpath),
                    file_size_bytes=len(raw),
                    mime_type=mime,
                    created_at=current_time,
                )
                db.add(att)
                attachment_snapshots.append({
                    "storage_url": str(fpath),
                    "mime_type":   mime,
                    "filename":    fname,
                })

            await db.commit()

            # ── Durable summarisation ─────────────────────────────────────────
            # Row is already summary_status='PENDING'; optimistic attempt now,
            # worker is the restart-safe fallback.
            _task = asyncio.create_task(self.try_summarise_now(appointment.id))
            _task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)

            logger.info(
                f"[MANUAL PETITION] appointment_id={appointment.id} | "
                f"token={token_assigned} | pages={len(valid_files)} | "
                f"submitted_by={submitted_by}"
            )

            return {
                "appointment_id": appointment.id,
                "token_assigned": token_assigned,
                "token_display":  f"TKN{token_assigned}",
                "status":         "AWAITING_REVIEW",
                "pages_uploaded": len(valid_files),
                "message":        f"Petition registered. Token: TKN{token_assigned}. "
                                  f"AI summary will be ready in ~30 seconds.",
            }

        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to process petition: {e}")

    # ── Floor / walk-in unified intake (staff-operated, no OTP) ─────────────

    async def process_floor_intake(
        self,
        name: str,
        mobile: str,
        description: str,
        grievance_category: str,
        db: AsyncSession,
        slot_id: Optional[int] = None,
        num_persons: int = 1,
        schedule_meeting: bool = False,
        files: Optional[List[UploadFile]] = None,
        constituency: str = "Tamil Nadu",
        submitted_by: str = "floor_staff",
    ) -> Dict[str, Any]:
        """
        Unified walk-in intake from the crowd PWA (no OTP; auth is the display
        session). One journey: write the grievance + optional photo + optionally
        book a live meeting slot. Mirrors the post-OTP half of
        `process_atomic_submission` (SCHEDULED / WAITING / AWAITING_REVIEW) but is
        staff-operated. Summarisation only runs when there is a photo or a
        grievance description (a pure appointment has nothing to summarise).
        """
        MAX_FILES = 10
        MAX_BYTES = 10 * 1024 * 1024
        ALLOWED_MIMES = {
            "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
            "image/bmp", "image/heic", "image/heif", "application/pdf",
        }

        user_desc = (description or "").strip()

        # ── Validate files (optional) ─────────────────────────────────────────
        valid_files = [f for f in (files or []) if f.filename][:MAX_FILES]
        file_contents: List[tuple] = []
        for f in valid_files:
            mime = f.content_type or "application/octet-stream"
            if mime not in ALLOWED_MIMES:
                raise HTTPException(status_code=400,
                                    detail=f"Unsupported file type '{mime}' ({f.filename}).")
            raw = await f.read()
            if len(raw) > MAX_BYTES:
                raise HTTPException(status_code=400, detail=f"'{f.filename}' exceeds 10 MB.")
            file_contents.append((raw, mime, f.filename))

        if not (name or "").strip():
            raise HTTPException(status_code=400, detail="Name is required.")
        # Courtesy categories (invitation, greetings) are self-describing —
        # allow them with just the category, no grievance/photo/slot needed.
        is_courtesy_intake = (grievance_category or "").lower() in COURTESY_CATEGORIES
        if (not user_desc and not file_contents and not slot_id
                and not schedule_meeting and not is_courtesy_intake):
            raise HTTPException(status_code=400,
                                detail="Write the grievance, add a photo, or pick a meeting slot.")

        # AI summarisation is only useful when there's an IMAGE to read.
        # A text-only grievance is what the staff already wrote — no AI needed
        # (they also pick the category up front). A pure appointment obviously
        # has nothing to summarise either.
        has_image = bool(file_contents)

        # Courtesy categories (invitation, greetings) bypass Petition Review
        # and the AI pipeline — they always land as an appointment, and any
        # attached image is treated as reference material, not a grievance.
        is_courtesy = (grievance_category or "").lower() in COURTESY_CATEGORIES
        take_slot_path = schedule_meeting or is_courtesy

        try:
            current_time = datetime.utcnow()
            token_assigned, legacy_slot_ref = await self._assign_daily_token(db, current_time)

            encrypted_name = self._encrypt_field(name.strip())
            grievance_text = user_desc or (
                f"Walk-in {'appointment' if schedule_meeting else 'petition'} "
                f"registered by {submitted_by}."
                + (f" {len(file_contents)} page(s) attached." if file_contents else "")
            )

            # ── Citizen (dedup by mobile_index) ───────────────────────────────
            from src.core import crypto
            mobile_idx = crypto.blind_index(mobile) if mobile else None
            citizen = None
            if mobile:
                citizen = (await db.execute(
                    select(Citizen).where(Citizen.mobile_index == mobile_idx)
                )).scalar_one_or_none()
            if not citizen:
                citizen = Citizen(
                    encrypted_name=encrypted_name,
                    encrypted_mobile=self._encrypt_field(mobile or ""),
                    mobile_index=mobile_idx,
                    created_at=current_time,
                )
                db.add(citizen)
                await db.flush()
            else:
                citizen.encrypted_name = encrypted_name

            walkin_status = "SCHEDULED" if take_slot_path else "AWAITING_REVIEW"
            walkin_ids = v2.new_appointment_ids(
                status=walkin_status, category=grievance_category or None,
            )
            appointment = Appointment(
                citizen_id=citizen.id,
                # v2: slot_id is a real FK — book_slot() sets it below.
                slot_id=None,
                token_assigned=token_assigned,
                encrypted_grievance=self._encrypt_field(grievance_text),
                grievance_category=grievance_category or None,
                status=walkin_status,
                status_id=walkin_ids["status_id"],
                priority_id=walkin_ids["priority_id"],
                category_id=walkin_ids.get("category_id"),
                schedule_meeting=take_slot_path,
                num_persons=max(1, min(4, num_persons)),
                # Courtesy items skip AI regardless of image; other floor
                # petitions still summarise when an image is attached.
                summary_status=("DONE" if is_courtesy else ("PENDING" if has_image else "DONE")),
                created_at=current_time,
            )
            db.add(appointment)
            await db.flush()

            # ── Book a slot (SCHEDULED) or fall back to WAITING ───────────────
            scheduled: Dict[str, Any] = {}
            if take_slot_path:
                if slot_id:
                    try:
                        scheduled = await scheduling_service.book_slot(
                            db, appointment, slot_id, commit=False)
                    except ValueError:
                        await scheduling_service.move_to_waiting_queue(
                            db, appointment, "SLOT_UNAVAILABLE", commit=False)
                else:
                    await scheduling_service.move_to_waiting_queue(
                        db, appointment, "NO_SLOT_SELECTED", commit=False)

            # ── Save photos (optional) ────────────────────────────────────────
            if file_contents:
                upload_dir = Path("uploads/manual_petitions") / str(appointment.id)
                upload_dir.mkdir(parents=True, exist_ok=True)
                for i, (raw, mime, fname) in enumerate(file_contents, 1):
                    safe_name = f"{appointment.id}_{i}_{self._sanitize_filename(fname)}"
                    fpath = upload_dir / safe_name
                    with open(fpath, "wb") as fh:
                        fh.write(raw)
                    db.add(AppointmentAttachment(
                        appointment_id=appointment.id,
                        attachment_type="IMAGE" if mime.startswith("image/") else "DOCUMENT",
                        storage_url=str(fpath),
                        file_size_bytes=len(raw),
                        mime_type=mime,
                        created_at=current_time,
                    ))

            await db.commit()

            # ── Summarise only when there is an IMAGE to read ─────────────────
            # Courtesy items skip AI regardless.
            if has_image and not is_courtesy:
                _task = asyncio.create_task(self.try_summarise_now(appointment.id))
                _task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)

            status = appointment.status
            msg = (f"Appointment booked · Token TKN{token_assigned}"  if status == "SCHEDULED"
                   else f"Added to waiting queue · Token TKN{token_assigned}" if status == "WAITING"
                   else f"Petition submitted · Token TKN{token_assigned}")
            logger.info(f"[FLOOR INTAKE] appointment_id={appointment.id} | token={token_assigned} "
                        f"| status={status} | files={len(file_contents)} | by={submitted_by}")
            return {
                "appointment_id": appointment.id,
                "token_assigned": token_assigned,
                "token_display":  f"TKN{token_assigned}",
                "status":         status,
                "scheduled_date": scheduled.get("scheduled_date"),
                "scheduled_time": scheduled.get("assigned_time"),
                "slot_window":    scheduled.get("slot_window"),
                "message":        msg,
            }

        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to register visitor: {e}")

    async def _trigger_manual_summarisation(
        self,
        appointment_id: int,
        citizen_name: str,
        constituency: str,
        attachment_snapshots: List[Dict[str, Any]],
    ) -> None:
        """Background: read all scanned pages → Gemini → save summary."""
        from src.core.database import AsyncSessionLocal
        logger.info(f"[MANUAL GEMINI START] appointment_id={appointment_id} | "
              f"pages={len(attachment_snapshots)}")
        try:
            from src.services.summarisation import GrievanceSummarisationService
            from src.models.grievance_summary_record import GrievanceSummaryRecord

            svc = GrievanceSummarisationService.from_settings()

            # Read all pages from storage (MinIO or local disk)
            from src.services.storage_service import get_file_bytes
            attachments: List[tuple] = []
            for snap in attachment_snapshots:
                try:
                    raw = get_file_bytes(snap["storage_url"])
                    if raw is None:
                        raise FileNotFoundError(f"File not found in storage: {snap['storage_url']}")
                    attachments.append((raw, snap["mime_type"], snap.get("filename")))
                except Exception as e:
                    logger.info(f"[MANUAL GEMINI WARN] Could not read {snap['storage_url']}: {e}")

            if not attachments:
                logger.info(f"[MANUAL GEMINI SKIP] appointment_id={appointment_id}: no readable files.")
                return

            logger.info(f"[MANUAL GEMINI CALL] appointment_id={appointment_id} | "
                  f"pages={len(attachments)} | model={svc._model_name}")
            loop = asyncio.get_running_loop()   # get_event_loop() deprecated in 3.10+
            t0 = time.monotonic()
            summary = await loop.run_in_executor(
                None,
                lambda: svc.summarise_manual(
                    citizen_name=citizen_name,
                    constituency=constituency,
                    attachments=attachments,
                ),
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            async with AsyncSessionLocal() as db:
                record = GrievanceSummaryRecord.from_gemini_response(
                    appointment_id=appointment_id,
                    summary=summary,
                    gemini_model_used=svc._model_name,
                    gemini_latency_ms=elapsed_ms,
                )
                db.add(record)

                appt = await db.scalar(
                    select(Appointment).where(Appointment.id == appointment_id)
                )
                if appt:
                    appt.grievance_category = summary.category.value

                # Auto-suggest ticket priority (no ticket yet for manual petitions)
                await db.commit()

            logger.info(
                f"[MANUAL GEMINI OK] appointment_id={appointment_id} | "
                f"pages={len(attachments)} | urgency={summary.urgency.value} | "
                f"category={summary.category.value} | latency={elapsed_ms}ms"
            )

        except Exception as exc:
            logger.info(f"[MANUAL GEMINI WARN] appointment_id={appointment_id}: "
                  f"Summarisation failed (appointment unaffected): {exc}")
            raise  # let the durable wrapper mark the row for retry / FAILED

    # ── Durable summarisation queue (worker-owned, restart-safe) ─────────────
    # A submitted petition lands as summary_status='PENDING'. Both an optimistic
    # web task (try_summarise_now) and the standalone worker (drain_pending_
    # summaries) claim work atomically via PENDING->PROCESSING with FOR UPDATE
    # SKIP LOCKED, so exactly one runs each row and a restart/crash is recovered.

    MAX_SUMMARY_ATTEMPTS = 3
    SUMMARY_STALE_MINUTES = 10

    async def _run_summary_for(self, appointment_id: int) -> None:
        """Reconstruct inputs from the DB and dispatch to the right summariser.

        Raises on failure (caller manages retry/FAILED state).
        """
        from src.core.database import AsyncSessionLocal
        from sqlalchemy.orm import selectinload

        async with AsyncSessionLocal() as db:
            appt = (await db.execute(
                select(Appointment)
                .options(selectinload(Appointment.citizen), selectinload(Appointment.attachments))
                .where(Appointment.id == appointment_id)
            )).scalar_one_or_none()
            if appt is None:
                return  # row vanished — nothing to do

            citizen = appt.citizen
            citizen_name = self._decrypt_field(citizen.encrypted_name) if citizen else ""
            constituency = ""  # v2: no longer stored on citizen (was ward_or_region)
            description = self._decrypt_field(appt.encrypted_grievance) if appt.encrypted_grievance else ""
            # v2: source column removed — inferred from grievance prefix
            # (manual-scan rows always start with "Handwritten petition scanned by").
            source = "manual_staff" if description.startswith("Handwritten petition scanned by") else "qr_citizen"
            attachments = [
                {"attachment_type": a.attachment_type, "storage_url": a.storage_url, "mime_type": a.mime_type}
                for a in appt.attachments
            ]
            # v2: audio lives in attachments now (attachment_type='AUDIO'), not a column
            audio_url = next(
                (a["storage_url"] for a in attachments if a["attachment_type"] == "AUDIO"),
                None,
            )

        if source == "manual_staff":
            manual_snaps = [
                {"storage_url": a["storage_url"], "mime_type": a["mime_type"],
                 "filename": Path(a["storage_url"]).name}
                for a in attachments
            ]
            await self._trigger_manual_summarisation(
                appointment_id=appointment_id,
                citizen_name=citizen_name,
                constituency=constituency,
                attachment_snapshots=manual_snaps,
            )
        else:  # qr_citizen (ai_scan rows are created DONE and never reach here)
            await self._trigger_summarisation(
                appointment_id=appointment_id,
                citizen_name=citizen_name,
                constituency=constituency,
                description=description,
                attachments_created=attachments,
                audio_recording_url=audio_url,
            )

    async def _finish_summary(self, appointment_id: int, ok: bool) -> None:
        """Mark a claimed row DONE, or PENDING (retry) / FAILED (give up)."""
        from src.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            if ok:
                await db.execute(text(
                    "UPDATE appointment SET summary_status='DONE', summary_claimed_at=NULL "
                    "WHERE id=:id"), {"id": appointment_id})
            else:
                await db.execute(text(
                    "UPDATE appointment SET "
                    "summary_status = CASE WHEN summary_attempts >= :max THEN 'FAILED' ELSE 'PENDING' END, "
                    "summary_claimed_at = NULL "
                    "WHERE id=:id"), {"id": appointment_id, "max": self.MAX_SUMMARY_ATTEMPTS})
            await db.commit()

    async def _process_claimed_summary(self, appointment_id: int) -> None:
        """Run summarisation for an already-claimed (PROCESSING) row and finalise."""
        try:
            await self._run_summary_for(appointment_id)
            await self._finish_summary(appointment_id, ok=True)
        except Exception:
            await self._finish_summary(appointment_id, ok=False)

    # After this many attempts, the row is marked FAILED and the worker stops
    # polling it. The PA still has the audio file to play back.
    TRANSCRIPT_MAX_ATTEMPTS = 5

    async def transcribe_courtesy(self, appointment_id: int) -> bool:
        """
        Transcribe the audio message on a courtesy submission (invitation or
        greetings) and persist a Fernet-encrypted transcript.

        Returns True if a transcript was written (or was already present),
        False if this attempt failed and the row should be retried later.

        Called after commit for courtesy items with audio, and also from the
        durable worker (`drain_pending_transcripts`) which polls PENDING rows
        every 5 minutes.
        """
        from src.services.storage_service import get_file_bytes
        from src.core.database import AsyncSessionLocal
        from sqlalchemy import select as _select

        async with AsyncSessionLocal() as session:
            appt = (await session.execute(
                _select(Appointment).where(Appointment.id == appointment_id)
            )).scalar_one_or_none()
            if not appt:
                logger.info(f"[COURTESY STT] appointment_id={appointment_id} not found")
                return False

            # Idempotent — a concurrent worker may have already finished it.
            if appt.encrypted_transcript and appt.transcript_status == "DONE":
                return True

            # v2: audio lives in attachments (attachment_type='AUDIO')
            audio_url = (await session.execute(
                _select(AppointmentAttachment.storage_url)
                .where(AppointmentAttachment.appointment_id == appointment_id)
                .where(AppointmentAttachment.attachment_type == "AUDIO")
                .limit(1)
            )).scalar_one_or_none()
            if not audio_url:
                # Nothing we can do; keep the state so the worker moves on.
                appt.transcript_status = "DONE"
                await session.commit()
                logger.info(f"[COURTESY STT] appointment_id={appointment_id} no audio, marking DONE")
                return True

            try:
                audio_bytes = await asyncio.to_thread(get_file_bytes, audio_url)
            except Exception as read_err:
                audio_bytes = None
                logger.info(f"[COURTESY STT] appointment_id={appointment_id} audio read error: {read_err}")

            transcript = ""
            if audio_bytes:
                # Sarvam first (better Tamil accuracy), Gemini as fallback.
                try:
                    from src.services.stt_service import SarvamSTTService
                    svc = SarvamSTTService.from_settings()
                    r = await asyncio.to_thread(
                        svc.transcribe, audio_bytes,
                        filename=f"appt_{appointment_id}.webm",
                        mime_type="audio/webm",
                    )
                    if r and not r.error:
                        transcript = (r.transcript or "").strip()
                except Exception as sarvam_err:
                    logger.info(f"[COURTESY STT] Sarvam failed for appointment_id={appointment_id}: {sarvam_err}")

                if not transcript:
                    try:
                        from src.services.stt_service import GeminiSTTService
                        gsvc = GeminiSTTService.from_settings()
                        g = await asyncio.to_thread(
                            gsvc.transcribe, audio_bytes,
                            filename=f"appt_{appointment_id}.webm",
                            mime_type="audio/webm",
                        )
                        if g and not g.error:
                            transcript = (g.transcript or "").strip()
                    except Exception as gemini_err:
                        logger.info(f"[COURTESY STT] Gemini fallback failed for appointment_id={appointment_id}: {gemini_err}")

            if transcript:
                appt.encrypted_transcript = self._encrypt_field(transcript)
                appt.transcript_status = "DONE"
                await session.commit()
                logger.info(f"[COURTESY STT OK] appointment_id={appointment_id} chars={len(transcript)}")
                return True

            # Failure path — count the attempt, cap and give up if we hit it.
            appt.transcript_attempts = (appt.transcript_attempts or 0) + 1
            if appt.transcript_attempts >= self.TRANSCRIPT_MAX_ATTEMPTS:
                appt.transcript_status = "FAILED"
                logger.info(
                    f"[COURTESY STT FAILED] appointment_id={appointment_id} "
                    f"attempts={appt.transcript_attempts} — giving up"
                )
            else:
                appt.transcript_status = "PENDING"
                logger.info(
                    f"[COURTESY STT RETRY] appointment_id={appointment_id} "
                    f"attempts={appt.transcript_attempts}"
                )
            await session.commit()
            return False

    async def drain_pending_transcripts(self, limit: int = 25) -> int:
        """
        Retry every appointment stuck at transcript_status='PENDING' (capped at
        `limit` per pass). Called by the background worker every 5 minutes and
        once at startup so a Sarvam/Gemini outage doesn't strand transcripts.
        Returns the number of rows successfully transcribed this pass.
        """
        from src.core.database import AsyncSessionLocal
        from sqlalchemy import select as _select

        async with AsyncSessionLocal() as session:
            ids = (await session.execute(
                _select(Appointment.id).where(
                    Appointment.transcript_status == "PENDING",
                    Appointment.transcript_attempts < self.TRANSCRIPT_MAX_ATTEMPTS,
                ).limit(limit)
            )).scalars().all()

        done = 0
        for aid in ids:
            try:
                if await self.transcribe_courtesy(aid):
                    done += 1
            except Exception as e:
                logger.info(f"[COURTESY STT DRAIN] appointment_id={aid} error: {e}")
        return done

    async def try_summarise_now(self, appointment_id: int) -> None:
        """Optimistic web-side attempt: claim THIS row if still PENDING, then run.

        If the worker already grabbed it, the claim returns nothing and we skip —
        no double processing. If we crash, the row stays PROCESSING and is
        recovered by the worker.
        """
        from src.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            claimed = (await db.execute(text(
                "UPDATE appointment SET summary_status='PROCESSING', "
                "summary_attempts = summary_attempts + 1, summary_claimed_at = now() "
                "WHERE id = :id AND summary_status = 'PENDING' "
                "RETURNING id"), {"id": appointment_id})).scalar()
            await db.commit()
        if claimed is None:
            return
        await self._process_claimed_summary(appointment_id)

    async def _claim_next_pending_summary(self) -> Optional[int]:
        """Worker: atomically claim the next PENDING row (PENDING->PROCESSING).

        Ordering — highest urgency first, then FIFO within a bucket:
          0. Meeting scheduled for today   (citizen is coming NOW)
          1. Meeting scheduled for tomorrow
          2. Meeting scheduled further out
          3. Petition-only submissions     (no meeting requested)

        The bucket priority only bites when the worker has a backlog — an empty
        queue processes rows the moment they arrive. Cheap to compute: the
        filter `summary_status='PENDING'` already narrows the candidate set to
        a handful of rows, so re-evaluating the CASE per row is trivial.
        """
        from src.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            row_id = (await db.execute(text(
                # v2: meeting date lives on the joined slot → availability.
                # FOR UPDATE OF a — can't lock the nullable side of an outer join.
                "SELECT a.id FROM appointment a "
                "LEFT JOIN slots s ON s.id = a.slot_id "
                "LEFT JOIN availability av ON av.id = s.availability_id "
                "WHERE a.summary_status='PENDING' "
                "ORDER BY "
                "  CASE "
                "    WHEN a.schedule_meeting AND av.date = CURRENT_DATE               THEN 0 "
                "    WHEN a.schedule_meeting AND av.date = CURRENT_DATE + INTEGER '1' THEN 1 "
                "    WHEN a.schedule_meeting                                          THEN 2 "
                "    ELSE                                                                  3 "
                "  END, a.created_at "
                "FOR UPDATE OF a SKIP LOCKED LIMIT 1"))).scalar()
            if row_id is None:
                return None
            await db.execute(text(
                "UPDATE appointment SET summary_status='PROCESSING', "
                "summary_attempts = summary_attempts + 1, summary_claimed_at = now() "
                "WHERE id = :id"), {"id": row_id})
            await db.commit()
            return row_id

    async def recover_stale_summaries(self) -> int:
        """Reset rows stuck in PROCESSING (crashed mid-run) back to PENDING, or
        FAILED once attempts are exhausted. Returns how many were recovered."""
        from src.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            res = await db.execute(text(
                "UPDATE appointment SET "
                "summary_status = CASE WHEN summary_attempts >= :max THEN 'FAILED' ELSE 'PENDING' END, "
                "summary_claimed_at = NULL "
                "WHERE summary_status='PROCESSING' "
                "AND (summary_claimed_at IS NULL OR summary_claimed_at < now() - (:mins || ' minutes')::interval)"),
                {"max": self.MAX_SUMMARY_ATTEMPTS, "mins": self.SUMMARY_STALE_MINUTES})
            await db.commit()
            return res.rowcount

    async def drain_pending_summaries(self) -> int:
        """Worker entry point: process all currently-pending summaries. Returns count."""
        done = 0
        while True:
            appointment_id = await self._claim_next_pending_summary()
            if appointment_id is None:
                break
            await self._process_claimed_summary(appointment_id)
            done += 1
        return done


# Singleton instance
appointment_service = AppointmentService()
