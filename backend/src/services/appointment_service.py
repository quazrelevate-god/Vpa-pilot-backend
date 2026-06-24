"""
Business logic for OTP verification and atomic appointment submission.
Implements stateless identity gatekeeper pattern with brute-force protection.
"""
import asyncio
import hashlib
import secrets
import os
import time
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path

import httpx
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from sqlalchemy.dialects.postgresql import UUID

from src.core.config import settings
from src.models.qr_models import GatekeeperSession
from src.models.appointment_models import (
    OTPVerification, Citizen, Appointment, AppointmentAttachment
)
from src.services.scheduling_service import scheduling_service


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
    
    # File Upload Configuration
    UPLOAD_DIR = Path("uploads/attachments")
    ALLOWED_MIME_TYPES = {
        'IMAGE': ['image/jpeg', 'image/png'],
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
        """
        Encrypt sensitive field using AES-256 (placeholder implementation).
        
        In production, use a proper encryption library like cryptography.fernet
        with key rotation and secure key management (e.g., AWS KMS, HashiCorp Vault).
        
        Args:
            plaintext: Sensitive data to encrypt
        
        Returns:
            str: Encrypted ciphertext (base64 encoded)
        
        TODO: Replace with actual AES-256 encryption implementation
        """
        # Placeholder: In production, implement proper AES-256 encryption
        # Example using cryptography library:
        # from cryptography.fernet import Fernet
        # cipher = Fernet(settings.ENCRYPTION_KEY)
        # return cipher.encrypt(plaintext.encode()).decode()
        
        # For now, return base64-encoded plaintext as placeholder
        import base64
        return base64.b64encode(plaintext.encode('utf-8')).decode('utf-8')
    
    @staticmethod
    def _decrypt_field(ciphertext: str) -> str:
        """
        Decrypt sensitive field (placeholder implementation).
        
        Args:
            ciphertext: Encrypted data
        
        Returns:
            str: Decrypted plaintext
        
        TODO: Replace with actual AES-256 decryption implementation
        """
        # Placeholder: In production, implement proper AES-256 decryption
        import base64
        return base64.b64decode(ciphertext.encode('utf-8')).decode('utf-8')
    
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
                print(f"[APM SMS ERROR] Could not extract OTP from response: {resp.text!r}")
                raise HTTPException(status_code=502, detail="SMS gateway did not return an OTP.")

            print(f"[APM SMS SUCCESS] OTP sent to {phone}, otp: {otp_from_api}")
            return otp_from_api

        except HTTPException:
            raise
        except Exception as e:
            print(f"[APM SMS ERROR] Failed to send OTP to {mobile_number}: {e}")
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
            print(f"[SMS CONFIRMATION DUMMY] Token {token_number} assigned to {citizen_name} ({mobile_number})")
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
            print(f"[SMS CONFIRMATION SUCCESS] Token {token_number} sent to {phone}")
            return True
        except Exception as e:
            print(f"[SMS CONFIRMATION ERROR] Failed to send to {mobile_number}: {e}")
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
            print(f"[SMS STATUS UPDATE DUMMY] Token {token_number} status changed to {new_status} for {citizen_name} ({mobile_number})")
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
            print(f"[SMS STATUS UPDATE SUCCESS] Token {token_number} status update sent to {phone}")
            return True
        except Exception as e:
            print(f"[SMS STATUS UPDATE ERROR] Failed to send to {mobile_number}: {e}")
            return False
    
    # ── Twilio (commented out — replaced by APM Technologies SMS) ───────────────
    # async def _send_otp_sms_twilio(self, mobile_number: str, otp_code: str):
    #     if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
    #         return None
    #     try:
    #         from twilio.rest import Client as TwilioClient
    #         to_number = f"+91{mobile_number}" if not mobile_number.startswith("+") else mobile_number
    #         def _send():
    #             client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    #             msg = client.messages.create(
    #                 from_=settings.TWILIO_FROM_NUMBER,
    #                 body=f"Your OTP is {otp_code}. Valid for {self.OTP_EXPIRY_MINUTES} minutes.",
    #                 to=to_number,
    #             )
    #             return msg.sid
    #         sid = await asyncio.get_event_loop().run_in_executor(None, _send)
    #         return True
    #     except Exception as e:
    #         print(f"[TWILIO ERROR] {e}")
    #         return False
    
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
            
            # Step 2: Call APM SMS API — it generates + sends the OTP and returns it.
            # In dummy mode (no API key) we fall back to local generation.
            otp_from_api = await self._send_otp_sms(mobile_number)
            dummy_mode = otp_from_api is None

            if dummy_mode:
                otp_code = self._generate_otp_code()
                print(f"[OTP DUMMY] APM SMS not configured. OTP for {mobile_number}: {otp_code}")
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
        from pathlib import Path
        
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
            
            # Create directory
            audio_dir = Path("uploads/audio")
            audio_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate filename
            filename = f"audio_{token_number}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.webm"
            file_path = audio_dir / filename
            
            # Save to disk
            with open(file_path, 'wb') as f:
                f.write(audio_bytes)
            
            return str(file_path)
            
        except Exception as e:
            print(f"[AUDIO SAVE ERROR] Failed to save audio: {e}")
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
            safe_filename = f"{appointment_id}_{timestamp}_{secrets.token_hex(8)}_{file.filename}"
            
            # Create subdirectory for appointment
            appointment_dir = self.UPLOAD_DIR / str(appointment_id)
            appointment_dir.mkdir(parents=True, exist_ok=True)
            
            # Save file to disk
            file_path = appointment_dir / safe_filename
            with open(file_path, 'wb') as f:
                f.write(file_content)
            
            return {
                "storage_url": str(file_path),
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
                
                # Step 6: Assign token in YYYYMMDDNNNNN format (e.g. 2026062200001)
                today_date = current_time.date()
                daily_counter_stmt = select(func.count(Appointment.id)).where(
                    Appointment.created_at >= current_time.replace(hour=0, minute=0, second=0)
                )
                daily_count = await db.scalar(daily_counter_stmt) or 0
                token_assigned = int(today_date.strftime("%Y%m%d")) * 100000 + daily_count + 1
                legacy_slot_ref = daily_count + 1  # sequential counter for legacy slot_id column only
                
                # Step 7: Encrypt sensitive fields
                encrypted_name = self._encrypt_field(name)
                encrypted_mobile = self._encrypt_field(mobile)
                encrypted_grievance = self._encrypt_field(description)
                
                # Step 8: Create or get existing citizen record
                citizen_stmt = select(Citizen).where(
                    Citizen.encrypted_mobile == encrypted_mobile
                )
                citizen_result = await db.execute(citizen_stmt)
                citizen = citizen_result.scalar_one_or_none()
                
                if not citizen:
                    # Create new citizen record
                    citizen = Citizen(
                        encrypted_name=encrypted_name,
                        encrypted_mobile=encrypted_mobile,
                        ward_or_region=constituency,
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
                initial_status = 'SCHEDULED' if schedule_meeting else 'AWAITING_REVIEW'
                appointment = Appointment(
                    citizen_id=citizen.id,
                    slot_id=legacy_slot_ref,
                    token_assigned=token_assigned,
                    encrypted_grievance=encrypted_grievance,
                    encrypted_name=encrypted_name,
                    audio_recording_url=audio_url,
                    grievance_category=grievance_category,
                    status=initial_status,
                    schedule_meeting=schedule_meeting,
                    created_at=current_time
                )
                db.add(appointment)
                await db.flush()  # Get appointment.id

                # Step 10b: Meeting requests — book the citizen-selected slot.
                # Falls back to waiting queue if no slot was selected or the slot
                # filled up between the form load and submission.
                if schedule_meeting:
                    if slot_id:
                        try:
                            await scheduling_service.book_slot(
                                db, appointment, slot_id, commit=False
                            )
                            print(f"[SLOT OK] appointment_id={appointment.id} | slot_id={slot_id} | status=SCHEDULED")
                        except ValueError as slot_err:
                            # Slot just filled or blocked — put in waiting queue
                            print(f"[SLOT WARN] appointment_id={appointment.id} | slot_id={slot_id} | err={slot_err} → WAITING")
                            await scheduling_service.move_to_waiting_queue(
                                db, appointment, 'SLOT_UNAVAILABLE', commit=False
                            )
                    else:
                        print(f"[SLOT WARN] appointment_id={appointment.id} | no slot_id → WAITING")
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
                
                for file in files:
                    if file.filename:  # Skip empty file uploads
                        # Save file to disk
                        file_metadata = await self._save_uploaded_file(file, appointment.id)
                        
                        # Create attachment record
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
            
            # Step 11: Mark gatekeeper session as used to prevent reuse
            session_stmt = select(GatekeeperSession).where(
                GatekeeperSession.session_token == str(session_token)
            )
            session_result = await db.execute(session_stmt)
            session = session_result.scalar_one_or_none()
            
            if session:
                session.is_used = True

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

            # Step 14: Fire-and-forget Gemini summarisation.
            # Snapshot attachments to plain dicts BEFORE the background task
            # starts. Once db.commit() expires the ORM instances, reading
            # `.attachment_type` etc. would trigger a lazy-load on a closed
            # session and silently fail — which previously caused summarisation
            # to never run for some submissions.
            attachment_snapshots = [
                {
                    "attachment_type": att.attachment_type,
                    "storage_url": att.storage_url,
                    "mime_type": att.mime_type,
                }
                for att in attachments_created
            ]
            print(
                f"[GEMINI DISPATCH] appointment_id={appointment.id} | "
                f"schedule_meeting={schedule_meeting} | "
                f"attachments={len(attachment_snapshots)} | "
                f"audio_url={'yes' if audio_url else 'no'} | "
                f"desc_chars={len(description or '')}"
            )
            asyncio.create_task(self._trigger_summarisation(
                appointment_id=appointment.id,
                citizen_name=name,
                constituency=constituency,
                description=description,
                attachments_created=attachment_snapshots,
                audio_recording_url=audio_url,
            ))

            if final_status == 'WAITING':
                message = f"No slots available right now. Your token number is {token_assigned} and you have been added to the waiting queue."
            elif final_status == 'AWAITING_REVIEW':
                message = f"Petition submitted successfully. Your token number is {token_assigned}."
            elif final_status == 'REVIEWED':
                message = f"Petition reviewed successfully. Your token number is {token_assigned}."
            else:
                message = f"Appointment scheduled successfully. Your token number is {token_assigned}."

            scheduled_date_str = None
            scheduled_time_str = None
            if final_status == 'SCHEDULED' and appointment.scheduled_date:
                scheduled_date_str = appointment.scheduled_date.isoformat()
            if final_status == 'SCHEDULED' and appointment.scheduled_start_time:
                scheduled_time_str = appointment.scheduled_start_time.strftime("%H:%M")

            submitted_at_str = current_time.isoformat()

            return {
                "appointment_id": appointment.id,
                "token_assigned": token_assigned,
                "citizen_id": citizen.id,
                "attachments_count": len(attachments_created),
                "status": final_status,
                "submitted_at": submitted_at_str,
                "scheduled_date": scheduled_date_str,
                "scheduled_time": scheduled_time_str,
                "message": message
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
        print(f"[GEMINI START] appointment_id={appointment_id} — background summarisation starting")
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
            for att in attachments_created:
                if att["attachment_type"] == "IMAGE":
                    try:
                        with open(att["storage_url"], "rb") as fh:
                            attachment_bytes = fh.read()
                        attachment_mime = att["mime_type"]
                        attachment_filename = Path(att["storage_url"]).name
                    except OSError as read_err:
                        print(f"[GEMINI WARN] appointment_id={appointment_id}: "
                              f"Could not read image file {att['storage_url']}: {read_err}")
                    break

            # Priority 2: first DOCUMENT (PDF / Word) if no image found
            if attachment_bytes is None:
                for att in attachments_created:
                    if att["attachment_type"] == "DOCUMENT":
                        try:
                            with open(att["storage_url"], "rb") as fh:
                                attachment_bytes = fh.read()
                            attachment_mime = att["mime_type"]
                            attachment_filename = Path(att["storage_url"]).name
                        except OSError as read_err:
                            print(f"[GEMINI WARN] appointment_id={appointment_id}: "
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
                    with open(audio_path, "rb") as fh:
                        audio_bytes_for_gemini = fh.read()
                except OSError as read_err:
                    print(f"[GEMINI WARN] appointment_id={appointment_id}: "
                          f"Could not read audio file {audio_path}: {read_err}")

            # When an image/document is present it becomes the sole summarisation
            # input; audio is downgraded to transcript-only so the summariser does
            # not try to handle two multimodal streams at once.
            audio_for_summary: Optional[bytes] = None if attachment_bytes is not None else audio_bytes_for_gemini
            audio_mime_for_summary: Optional[str] = None if attachment_bytes is not None else (audio_mime if audio_bytes_for_gemini else None)

            grievance_text = (description or "").strip()

            # Skip only when nothing at all to summarise.
            if attachment_bytes is None and audio_for_summary is None and not grievance_text:
                print(f"[GEMINI SKIP] appointment_id={appointment_id}: "
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
                    grievance_text=grievance_text,
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
                    print(f"[STT WARN] appointment_id={appointment_id}: "
                          f"Gemini STT failed: {stt_result.error}")
                elif stt_result.transcript:
                    audio_transcript = stt_result.transcript.strip()
                    audio_stt_latency_ms = stt_result.latency_ms
                    print(f"[STT OK] appointment_id={appointment_id} | "
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
                    # Category is now citizen-selected in the form — don't overwrite with AI.
                    pass

                # Auto-suggest ticket priority from AI urgency (PA can override).
                # Only set if not already set manually by a PA.
                from src.models.ticket_models import (
                    Ticket, TicketEvent, TicketEventType, URGENCY_TO_PRIORITY,
                )
                tkt_result = await db.execute(
                    select(Ticket).where(Ticket.appointment_id == appointment_id)
                )
                ticket = tkt_result.scalar_one_or_none()
                if ticket is not None:
                    suggested_priority = URGENCY_TO_PRIORITY.get(summary.urgency.value)
                    if ticket.priority is None and suggested_priority:
                        ticket.priority = suggested_priority
                    db.add(TicketEvent(
                        ticket_id=ticket.id,
                        event_type=TicketEventType.AI_SUMMARISED.value,
                        actor="system",
                        note=f"AI summarised — urgency={summary.urgency.value}, "
                             f"category={summary.category.value}, "
                             f"department={summary.department.value}",
                        payload={
                            "urgency": summary.urgency.value,
                            "category": summary.category.value,
                            "department": summary.department.value,
                            "suggested_priority": suggested_priority,
                        },
                    ))

                await db.commit()

            input_parts = []
            if attachment_bytes: input_parts.append("attachment")
            if audio_bytes_for_gemini: input_parts.append("audio")
            if grievance_text: input_parts.append("text")
            input_mode = "+".join(input_parts) if input_parts else "empty"
            print(
                f"[GEMINI OK] appointment_id={appointment_id} | input={input_mode} | "
                f"urgency={summary.urgency.value} | category={summary.category.value} | "
                f"department={summary.department.value} | "
                f"latency={elapsed_ms}ms (parallel summarise+STT)"
            )

        except Exception as exc:
            print(f"[GEMINI WARN] appointment_id={appointment_id}: "
                  f"Summarisation failed (appointment unaffected): {exc}")


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
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
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

            # ── Token assignment ──────────────────────────────────────────────
            today_date = current_time.date()
            daily_count = await db.scalar(
                select(func.count(Appointment.id)).where(
                    Appointment.created_at >= current_time.replace(hour=0, minute=0, second=0)
                )
            ) or 0
            token_assigned = int(today_date.strftime("%Y%m%d")) * 100000 + daily_count + 1
            legacy_slot_ref = daily_count + 1

            # ── Encrypt PII ───────────────────────────────────────────────────
            encrypted_name   = self._encrypt_field(name)
            encrypted_mobile = self._encrypt_field(mobile or "")
            description_text = f"Handwritten petition scanned by {submitted_by}. {len(valid_files)} page(s) uploaded."

            # ── Citizen ───────────────────────────────────────────────────────
            citizen = None
            if mobile:
                citizen_stmt = select(Citizen).where(
                    Citizen.encrypted_mobile == encrypted_mobile
                )
                result = await db.execute(citizen_stmt)
                citizen = result.scalar_one_or_none()

            if not citizen:
                citizen = Citizen(
                    encrypted_name=encrypted_name,
                    encrypted_mobile=encrypted_mobile,
                    ward_or_region=constituency,
                    created_at=current_time,
                )
                db.add(citizen)
                await db.flush()
            else:
                citizen.encrypted_name = encrypted_name

            # ── Appointment (AWAITING_REVIEW — same as direct-submit) ─────────
            appointment = Appointment(
                citizen_id=citizen.id,
                slot_id=legacy_slot_ref,
                token_assigned=token_assigned,
                encrypted_grievance=self._encrypt_field(description_text),
                encrypted_name=encrypted_name,
                audio_recording_url=None,
                grievance_category=None,
                status="AWAITING_REVIEW",
                schedule_meeting=False,
                created_at=current_time,
            )
            db.add(appointment)
            await db.flush()

            # ── Save files to disk + create attachment records ────────────────
            upload_dir = Path("uploads/manual_petitions") / str(appointment.id)
            upload_dir.mkdir(parents=True, exist_ok=True)

            attachment_snapshots: List[Dict[str, Any]] = []
            for raw, mime, fname in file_contents:
                safe_name = f"{appointment.id}_{len(attachment_snapshots)+1}_{fname}"
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

            # ── Fire background Gemini summarisation ──────────────────────────
            asyncio.create_task(self._trigger_manual_summarisation(
                appointment_id=appointment.id,
                citizen_name=name,
                constituency=constituency,
                attachment_snapshots=attachment_snapshots,
            ))

            print(
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

    async def _trigger_manual_summarisation(
        self,
        appointment_id: int,
        citizen_name: str,
        constituency: str,
        attachment_snapshots: List[Dict[str, Any]],
    ) -> None:
        """Background: read all scanned pages → Gemini → save summary."""
        from src.core.database import AsyncSessionLocal
        print(f"[MANUAL GEMINI START] appointment_id={appointment_id} | "
              f"pages={len(attachment_snapshots)}")
        try:
            from src.services.summarisation import GrievanceSummarisationService
            from src.models.grievance_summary_record import GrievanceSummaryRecord

            svc = GrievanceSummarisationService.from_settings()

            # Read all pages from disk
            attachments: List[tuple] = []
            for snap in attachment_snapshots:
                try:
                    with open(snap["storage_url"], "rb") as fh:
                        raw = fh.read()
                    attachments.append((raw, snap["mime_type"], snap.get("filename")))
                except OSError as e:
                    print(f"[MANUAL GEMINI WARN] Could not read {snap['storage_url']}: {e}")

            if not attachments:
                print(f"[MANUAL GEMINI SKIP] appointment_id={appointment_id}: no readable files.")
                return

            loop = asyncio.get_event_loop()
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
                from src.models.ticket_models import URGENCY_TO_PRIORITY, Ticket, TicketEvent, TicketEventType
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

            print(
                f"[MANUAL GEMINI OK] appointment_id={appointment_id} | "
                f"pages={len(attachments)} | urgency={summary.urgency.value} | "
                f"category={summary.category.value} | latency={elapsed_ms}ms"
            )

        except Exception as exc:
            print(f"[MANUAL GEMINI WARN] appointment_id={appointment_id}: "
                  f"Summarisation failed (appointment unaffected): {exc}")


# Singleton instance
appointment_service = AppointmentService()
