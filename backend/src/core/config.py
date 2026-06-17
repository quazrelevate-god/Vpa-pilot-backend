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

    # Gemini / AI Configuration
    # Used by src/services/summarisation.py to call gemini-2.5-flash.
    # Loaded from backend/.env; required for any grievance summarisation work.
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_PRIMARY_MODEL: str = "gemini-2.5-flash"
    GEMINI_FALLBACK_MODEL: str = "gemini-2.5-flash-lite"
    # Service tier for Gemini requests: "priority" | "standard" | "flex".
    # Grievances are time-sensitive, so we default to the priority tier for the
    # fastest, most reliable latency (requires a paid/billed project).
    GEMINI_SERVICE_TIER: str = "priority"

    # QR Code Configuration
    QR_EXPIRY_SECONDS: int = 300  # 5 minutes default

    # Session Configuration
    SESSION_EXPIRY_SECONDS: int = 1800  # 30 minutes default
    
    # Frontend Configuration
    FRONTEND_FORM_BASE_URL: str = "http://localhost:8000/form"
    
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
            self.DATABASE_URL = f"postgresql+psycopg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
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
