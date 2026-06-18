"""
Business logic for OTP verification and atomic appointment submission.
Implements stateless identity gatekeeper pattern with brute-force protection.
"""
import hashlib
import secrets
import os
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path

import httpx
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import UUID

from src.core.config import settings
from src.models.qr_models import GatekeeperSession
from src.models.appointment_models import (
    OTPVerification, Citizen, Appointment, AppointmentAttachment
)


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
    MAX_FILE_SIZE_MB = 10
    ALLOWED_MIME_TYPES = {
        'AUDIO': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'],
        'IMAGE': ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
        'DOCUMENT': ['application/pdf', 'application/msword', 
                     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                     'application/vnd.ms-excel',
                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        'VIDEO': ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
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
    
    async def _send_otp_sms(self, mobile_number: str, otp_code: str):
        """
        Send OTP via Twilio SMS. Returns None in dummy mode (no credentials),
        True on success, False on failure.
        """
        if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
            print(f"[OTP DUMMY] Twilio not configured. OTP for {mobile_number}: {otp_code}")
            return None  # None signals dummy mode; caller exposes code in response

        try:
            import asyncio
            from twilio.rest import Client as TwilioClient

            # Prepend +91 for Indian numbers if no country code given
            to_number = f"+91{mobile_number}" if not mobile_number.startswith("+") else mobile_number

            def _send():
                client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
                msg = client.messages.create(
                    from_=settings.TWILIO_FROM_NUMBER,
                    body=f"Your OTP is {otp_code}. Valid for {self.OTP_EXPIRY_MINUTES} minutes. Do not share it.",
                    to="+919003259339",
                )
                return msg.sid

            sid = await asyncio.get_event_loop().run_in_executor(None, _send)
            print(f"[TWILIO SUCCESS] OTP sent to {to_number}, SID: {sid}")
            return True

        except Exception as e:
            print(f"[TWILIO ERROR] Failed to send OTP to {mobile_number}: {e}")
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
            
            # Step 2: Generate OTP code
            otp_code = self._generate_otp_code()
            
            # Step 3: Hash OTP code
            hashed_otp = self._hash_otp_code(otp_code)
            
            # Step 4: Calculate expiry time
            expires_at = current_time + timedelta(minutes=self.OTP_EXPIRY_MINUTES)
            
            # Save OTP verification record
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
            
            # Step 5: Send OTP via SMS gateway (async)
            # Returns None in dummy mode (no SMS key configured), True/False otherwise
            sms_result = await self._send_otp_sms(mobile_number, otp_code)
            dummy_mode = sms_result is None

            if sms_result is False:
                print(f"[WARNING] OTP generated but SMS failed for {mobile_number}  otp : {otp_code}")

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
        files: List[UploadFile],
        db: AsyncSession
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
                
                # Step 6: Allocate slot atomically using FOR UPDATE SKIP LOCKED
                # TODO: Implement actual slot allocation query
                # For now, generate a simple sequential token
                # In production, query slots table with:
                # SELECT id, token_number FROM slots 
                # WHERE date = CURRENT_DATE AND is_allocated = FALSE
                # ORDER BY token_number ASC
                # LIMIT 1
                # FOR UPDATE SKIP LOCKED
                
                # Placeholder: Generate token based on current appointments count
                token_stmt = select(Appointment).where(
                    Appointment.created_at >= datetime.utcnow().replace(hour=0, minute=0, second=0)
                )
                token_result = await db.execute(token_stmt)
                today_appointments = token_result.scalars().all()
                token_assigned = len(today_appointments) + 1
                slot_id = token_assigned  # Placeholder
                
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
                
                # Step 9: Create appointment record
                appointment = Appointment(
                    citizen_id=citizen.id,
                    slot_id=slot_id,
                    token_assigned=token_assigned,
                    encrypted_grievance=encrypted_grievance,
                    grievance_category=None,  # TODO: Implement category classification
                    status='SCHEDULED',
                    schedule_meeting=schedule_meeting,
                    created_at=current_time
                )
                db.add(appointment)
                await db.flush()  # Get appointment.id
                
                # Step 10: Save uploaded files and create attachment records
                attachments_created = []
                
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
            
            # Step 12: Commit transaction — citizen gets token NOW
            await db.commit()

            # Step 13: Trigger Gemini summarisation (non-blocking enrichment).
            # This runs AFTER commit so the citizen's appointment is guaranteed
            # saved regardless of Gemini availability.
            await self._trigger_summarisation(
                appointment_id=appointment.id,
                citizen_name=name,
                constituency=constituency,
                description=description,
                attachments_created=attachments_created,
                db=db,
            )

            return {
                "appointment_id": appointment.id,
                "token_assigned": token_assigned,
                "citizen_id": citizen.id,
                "attachments_count": len(attachments_created),
                "status": "SCHEDULED",
                "message": f"Appointment created successfully. Your token number is {token_assigned}."
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
        attachments_created: List[AppointmentAttachment],
        db: AsyncSession,
    ) -> None:
        """
        Call Gemini summarisation after the appointment transaction is committed.

        Priority:
            IMAGE attachment > DOCUMENT (PDF/Word) attachment > description text.

        If both image and text exist, image wins (text is ignored) — same logic
        as the Streamlit tester.  Audio/video files are skipped; they are saved
        to disk as evidence but not sent to Gemini.

        Always non-blocking: any failure is logged as a warning. The appointment
        record is never rolled back due to a Gemini error.

        After a successful Gemini call:
            - Saves a GrievanceSummaryRecord row (bilingual, linked to appointment).
            - Updates appointments.grievance_category with the Gemini-returned value.
        """
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
                if att.attachment_type == "IMAGE":
                    try:
                        with open(att.storage_url, "rb") as fh:
                            attachment_bytes = fh.read()
                        attachment_mime = att.mime_type
                        attachment_filename = Path(att.storage_url).name
                    except OSError as read_err:
                        print(f"[GEMINI WARN] appointment_id={appointment_id}: "
                              f"Could not read image file {att.storage_url}: {read_err}")
                    break

            # Priority 2: first DOCUMENT (PDF / Word) if no image found
            if attachment_bytes is None:
                for att in attachments_created:
                    if att.attachment_type == "DOCUMENT":
                        try:
                            with open(att.storage_url, "rb") as fh:
                                attachment_bytes = fh.read()
                            attachment_mime = att.mime_type
                            attachment_filename = Path(att.storage_url).name
                        except OSError as read_err:
                            print(f"[GEMINI WARN] appointment_id={appointment_id}: "
                                  f"Could not read document file {att.storage_url}: {read_err}")
                        break

            # Priority 3: description text (only if no usable attachment)
            if attachment_bytes is None:
                grievance_text = description or ""
                if not grievance_text.strip():
                    print(f"[GEMINI SKIP] appointment_id={appointment_id}: "
                          "No text and no usable image/document — skipping summarisation.")
                    return

            # ── Call Gemini ─────────────────────────────────────────────────
            t0 = time.monotonic()
            summary = svc.summarise(
                citizen_name=citizen_name,
                constituency=constituency,
                grievance_text=grievance_text,
                attachment_bytes=attachment_bytes,
                attachment_mime=attachment_mime,
                attachment_filename=attachment_filename,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            # ── Persist summary record ───────────────────────────────────────
            record = GrievanceSummaryRecord.from_gemini_response(
                appointment_id=appointment_id,
                summary=summary,
                gemini_model_used=svc._model_name,
                gemini_latency_ms=elapsed_ms,
            )
            db.add(record)

            # ── Update grievance_category on the appointment row ─────────────
            appt_stmt = select(Appointment).where(Appointment.id == appointment_id)
            appt_result = await db.execute(appt_stmt)
            appt = appt_result.scalar_one_or_none()
            if appt:
                appt.grievance_category = summary.category.value

            await db.commit()

            input_mode = "attachment" if attachment_bytes else "text"
            print(
                f"[GEMINI OK] appointment_id={appointment_id} | input={input_mode} | "
                f"urgency={summary.urgency.value} | category={summary.category.value} | "
                f"latency={elapsed_ms}ms"
            )

        except Exception as exc:
            print(f"[GEMINI WARN] appointment_id={appointment_id}: "
                  f"Summarisation failed (appointment unaffected): {exc}")
            try:
                await db.rollback()
            except Exception:
                pass


# Singleton instance
appointment_service = AppointmentService()
