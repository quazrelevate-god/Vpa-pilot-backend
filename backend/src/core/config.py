"""
Configuration module for the citizen scheduler application.
Loads environment variables and provides centralized settings management.
"""
from pydantic_settings import BaseSettings
from pydantic import model_validator, ConfigDict
from functools import lru_cache
from pathlib import Path
from typing import Optional

# Absolute path to backend/.env (config.py is at backend/src/core/config.py).
# Resolving by file location rather than cwd means the .env is found no matter
# where the process is launched from (FastAPI, the test runner, Streamlit via
# the preview tool, etc.).
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# Default staff credentials shipped for dev convenience (see the fields below).
# These MUST be overridden before a production deploy — _enforce_production_
# credentials refuses to start with any of them still in place when DEBUG=False.
_DEFAULT_STAFF_CREDENTIALS = {
    "DASHBOARD_USERNAME": "admin",     "DASHBOARD_PASSWORD": "admin123",
    "DISPLAY_USERNAME":   "display",   "DISPLAY_PASSWORD":   "display123",
    "EVENTS_USERNAME":    "events",    "EVENTS_PASSWORD":    "events123",
}


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    Uses pydantic for validation and type safety.
    """
    
    # Database Configuration - supports both formats
    DATABASE_URL: Optional[str] = None
    DB_USER: Optional[str] = None
    DB_PASSWORD: Optional[str] = None
    DB_HOST: Optional[str] = None
    DB_PORT: Optional[str] = None
    DB_NAME: Optional[str] = None
    
    # Security Configuration
    SECRET_KEY: str
    # Dedicated key for encrypting citizen PII at rest. MUST be set in production
    # and never changed (changing it makes existing data unreadable). Falls back to
    # SECRET_KEY in dev. Generate one with: python -c "import secrets;print(secrets.token_urlsafe(48))"
    ENCRYPTION_KEY: Optional[str] = None
    # Master switch for slowapi rate limiting (login + OTP). Temporarily OFF —
    # re-enable later by setting RATE_LIMIT_ENABLED=true in .env once the real
    # client IP (X-Forwarded-For) is confirmed flowing from nginx.
    RATE_LIMIT_ENABLED: bool = False
    # Enforce "one petition per phone per day" on submit. On in prod, off in dev
    # so QA can repeatedly test the same phone number without waiting a day.
    ONE_PETITION_PER_DAY: bool = True
    # Set true in production (HTTPS) so session cookies get the Secure flag + HSTS.
    COOKIE_SECURE: bool = False
    # Comma-separated allowed CORS origins for the PA portal. In prod the portal is
    # served same-origin so this is mainly for split dev (Next on :3000).
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Sentry error monitoring (backend). Leave unset to disable.
    SENTRY_DSN: Optional[str] = None

    # Gemini / AI Configuration
    # Used by src/services/summarisation.py to call gemini-2.5-flash.
    # Loaded from backend/.env; required for any grievance summarisation work.
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_PRIMARY_MODEL: str = "gemini-2.5-flash"
    GEMINI_FALLBACK_MODEL: str = "gemini-2.5-flash-lite"
    GEMINI_FALLBACK_MODEL2: str = "gemini-2.0-flash"
    # Service tier for Gemini requests: "priority" | "standard" | "flex".
    # Grievances are time-sensitive, so we default to the priority tier for the
    # fastest, most reliable latency (requires a paid/billed project).
    GEMINI_SERVICE_TIER: str = "priority"

    # Sarvam AI Configuration — Indian-language speech-to-text (Tamil-first).
    # Used by src/services/stt_service.py.  Get a key at https://www.sarvam.ai/
    SARVAM_API_KEY: Optional[str] = None
    SARVAM_STT_MODEL: str = "saaras:v3"      # saarika:v2.5 (deprecating) | saaras:v3 (recommended)
    SARVAM_STT_LANGUAGE: str = "ta-IN"        # BCP-47; use "unknown" for auto-detect
    SARVAM_API_BASE_URL: str = "https://api.sarvam.ai"

    # QR Code Configuration
    QR_EXPIRY_SECONDS: int = 300  # 5 minutes default

    # Session Configuration
    SESSION_EXPIRY_SECONDS: int = 1800  # 30 minutes default
    
    # Twilio SMS Configuration (kept for reference, currently unused)
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_FROM_NUMBER: str = ""

    # APM Technologies SMS Configuration
    APM_SMS_API_KEY: Optional[str] = None

    # Staff Dashboard Credentials
    DASHBOARD_USERNAME: str = "admin"
    DASHBOARD_PASSWORD: str = "admin123"

    # Feature flags — dark-launch tools until the PA office signs off.
    FEATURE_SUPERADMIN_UI: bool = True   # gated by role on top of this

    # Display Board Credentials (separate login)
    DISPLAY_USERNAME: str = "display"
    DISPLAY_PASSWORD: str = "display123"

    # Events (invitation calendar) PWA Credentials (separate login)
    EVENTS_USERNAME: str = "events"
    EVENTS_PASSWORD: str = "events123"

    # ── Web push reminders for the events PWA ────────────────────────────────
    # VAPID key pair identifies THIS server to browser push services (FCM,
    # Mozilla, Apple). Generate once and never rotate mid-flight — a new
    # key invalidates every existing subscription.
    #   $ python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); \
    #                v.save_key('vapid_private.pem'); v.save_public_key('vapid_public.pem')"
    # Set VAPID_SUBJECT to a mailto: URL you own — push services require it
    # so they can contact you about abuse. Feature is off when private key
    # is missing (subscribe endpoint will still 503 gracefully).
    VAPID_PUBLIC_KEY:  Optional[str] = None  # base64-url of the raw 65-byte P-256 public point
    VAPID_PRIVATE_KEY: Optional[str] = None  # base64-url of the 32-byte private scalar (OR a PEM path)
    VAPID_SUBJECT:     str = "mailto:admin@example.com"
    # Reminder cadence. Times are IST (the office's local clock). Cron sweeps
    # every EVENTS_REMINDER_TICK_SECONDS seconds; a reminder fires when the
    # tick lands inside the ±TICK window of the scheduled minute.
    EVENTS_REMINDER_NIGHT_BEFORE_HOUR_IST: int = 21   # 9 PM prior day
    EVENTS_REMINDER_MORNING_HOUR_IST:      int = 9    # 9 AM day of
    EVENTS_REMINDER_PRE_EVENT_MINUTES:     int = 60   # T-60 min before start_time
    EVENTS_REMINDER_TICK_SECONDS:          int = 60   # 1-minute sweep

    # Frontend Configuration
    FRONTEND_FORM_BASE_URL: str = "http://localhost:8000/form"

    # Audio Recording Configuration (seconds)
    AUDIO_MIN_DURATION_SECONDS: int = 10   # minimum recording length
    AUDIO_MAX_DURATION_SECONDS: int = 300  # maximum recording length (5 minutes)

    # File Upload Configuration
    MAX_FILE_SIZE_MB: int = 5              # max size per uploaded attachment
    ALLOWED_FILE_EXTENSIONS: str = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"  # comma-separated

    # Remote file storage (MinIO on VPS). Leave FILE_STORAGE_ENDPOINT unset
    # to use local disk (default when FastAPI itself runs on the VPS).
    FILE_STORAGE_ENDPOINT: Optional[str] = None   # e.g. http://127.0.0.1:9000
    FILE_STORAGE_ACCESS_KEY: str = ""
    FILE_STORAGE_SECRET_KEY: str = ""
    FILE_STORAGE_BUCKET: str = "vpa-uploads"
    FILE_STORAGE_PUBLIC_URL: Optional[str] = None  # e.g. https://namkural.in/storage

    # MLA Profile (used by seed_mla.py for initial production setup)
    MLA_NAME: str = "Default MLA"
    MLA_CONSTITUENCY: str = "Default Constituency"
    MLA_CONTACT_MOBILE: str = ""
    MLA_CONTACT_EMAIL: str = ""
    MLA_OFFICE_ADDRESS: str = ""

    # Public base URL used when constructing QR codes that must be reachable
    # from mobile devices on the same network (e.g. http://192.168.1.x:8000).
    # Defaults to localhost; override in .env for LAN/mobile testing.
    SERVER_BASE_URL: str = "http://localhost:8000"
    
    # Application Metadata
    APP_NAME: str = "Citizen Scheduler API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    model_config = ConfigDict(
        env_file=str(_ENV_FILE),
        case_sensitive=True,
        extra="ignore"  # Ignore extra fields like APP_ENV
    )
    
    @model_validator(mode='after')
    def build_database_url(self):
        """Build DATABASE_URL from individual components if not provided."""
        if self.DATABASE_URL:
            return self
        
        if all([self.DB_USER, self.DB_PASSWORD, self.DB_HOST, self.DB_PORT, self.DB_NAME]):
            self.DATABASE_URL = f"postgresql+psycopg_async://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
            return self

        raise ValueError("Either DATABASE_URL or all DB_* parameters (DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) must be provided")

    @model_validator(mode='after')
    def _enforce_production_credentials(self):
        """In production (DEBUG=False), refuse to boot on default/blank staff
        credentials. A prod deploy missing a value in .env would otherwise fall
        back to the world's most-guessable creds with the whole dashboard behind
        them. Dev keeps the defaults for zero-config startup."""
        if self.DEBUG:
            return self
        offenders = [
            name for name, default in _DEFAULT_STAFF_CREDENTIALS.items()
            if not getattr(self, name) or getattr(self, name) == default
        ]
        if offenders:
            raise ValueError(
                "Refusing to start in production (DEBUG=False) with default or "
                f"unset staff credentials: {', '.join(sorted(offenders))}. "
                "Set strong values in backend/.env before deploying."
            )
        return self

    @model_validator(mode='after')
    def _enforce_production_encryption_key(self):
        """In production, require a dedicated ENCRYPTION_KEY. Without it, crypto
        falls back to SECRET_KEY — so any future SECRET_KEY rotation (a routine
        ops action) would permanently corrupt every Fernet-encrypted PII column.

        WARNING when first setting this on an existing deployment: the value MUST
        match the key that currently encrypts your data (i.e. your existing
        SECRET_KEY, since that's the fallback in use today). A *new* random value
        makes all existing PII unreadable — there is no recovery."""
        if self.DEBUG:
            return self
        if not self.ENCRYPTION_KEY:
            raise ValueError(
                "Refusing to start in production (DEBUG=False) without ENCRYPTION_KEY. "
                "Set it in backend/.env to the key currently encrypting your data "
                "(your existing SECRET_KEY) so existing PII stays readable."
            )
        return self


@lru_cache()
def get_settings() -> Settings:
    """
    Returns a cached instance of Settings.
    Using lru_cache ensures we only load .env once.
    """
    return Settings()


settings = get_settings()
