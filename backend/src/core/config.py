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
    # Master switch for slowapi rate limiting (login + OTP). OFF by default (per
    # request) — turn it ON in production by setting RATE_LIMIT_ENABLED=true in
    # .env. NOTE: the limit decorators on login/OTP are a credential-stuffing /
    # OTP-enumeration defence, so this SHOULD be true in prod; confirm the real
    # client IP (X-Forwarded-For) is flowing from nginx, then enable it.
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
    
    # DB connection pool sizing (SQLAlchemy async engine). Defaults match the
    # historical hardcoded values; expose them so prod can tune to its worker
    # count / Postgres max_connections without a code change (optimization O-2).
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10

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


def assert_production_ready(cfg: "Settings") -> None:
    """Fail-fast production preflight — call at APP STARTUP, not at Settings
    construction.

    These checks used to be pydantic validators, but that ran them on every
    import of this module — including alembic's env.py and one-off scripts,
    which only need DATABASE_URL and shouldn't require the app's runtime
    secrets. Coupling `alembic upgrade` to the dashboard password was wrong.
    Enforcing at app startup instead keeps the running app protected in prod
    while leaving DB tooling free.

    In production (DEBUG=False) this refuses to start when:
      • any staff credential is still a shipped default / blank — a missing
        value would otherwise fall back to the world's most-guessable creds;
      • ENCRYPTION_KEY is unset — crypto would fall back to SECRET_KEY, so a
        future SECRET_KEY rotation would permanently corrupt all encrypted PII
        (set it to the key currently encrypting your data — today's SECRET_KEY);
      • SERVER_BASE_URL is the localhost default — the QR/referral/dashboard
        link builders would then fall back to the client-controlled Host header.
    """
    if cfg.DEBUG:
        return

    problems: list[str] = []

    offenders = [
        name for name, default in _DEFAULT_STAFF_CREDENTIALS.items()
        if not getattr(cfg, name) or getattr(cfg, name) == default
    ]
    if offenders:
        problems.append(
            "default or unset staff credentials: " + ", ".join(sorted(offenders))
        )
    if not cfg.ENCRYPTION_KEY:
        problems.append(
            "ENCRYPTION_KEY is unset (set it to the key currently encrypting your "
            "data — your existing SECRET_KEY — or existing PII becomes unreadable)"
        )
    if not cfg.SERVER_BASE_URL or cfg.SERVER_BASE_URL == "http://localhost:8000":
        problems.append(
            "SERVER_BASE_URL is the localhost default (set it to the public base "
            "URL, e.g. https://namkural.in, to block Host-header link spoofing)"
        )

    if problems:
        raise RuntimeError(
            "Refusing to start in production (DEBUG=False). Fix in backend/.env:\n  - "
            + "\n  - ".join(problems)
        )


@lru_cache()
def get_settings() -> Settings:
    """
    Returns a cached instance of Settings.
    Using lru_cache ensures we only load .env once.
    """
    return Settings()


settings = get_settings()
