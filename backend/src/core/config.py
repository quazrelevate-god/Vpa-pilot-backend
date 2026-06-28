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

    # Display Board Credentials (separate login)
    DISPLAY_USERNAME: str = "display"
    DISPLAY_PASSWORD: str = "display123"

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


@lru_cache()
def get_settings() -> Settings:
    """
    Returns a cached instance of Settings.
    Using lru_cache ensures we only load .env once.
    """
    return Settings()


settings = get_settings()
