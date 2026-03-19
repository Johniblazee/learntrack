"""
Application configuration using pydantic-settings and python-dotenv
"""

from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from dotenv import load_dotenv

# Load environment variables from stable locations regardless of current working dir.
# Priority: existing OS env vars > backend/.env > repo/.env
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT_DIR = BACKEND_DIR.parent
load_dotenv(REPO_ROOT_DIR / ".env", override=False)
load_dotenv(BACKEND_DIR / ".env", override=False)


class Settings(BaseSettings):
    """Application settings"""

    # Base Directory
    BASE_DIR: str = str(Path(__file__).parent.parent.parent.parent)

    # API Configuration
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "LearnTrack MVP"
    VERSION: str = "1.0.0"
    DESCRIPTION: str = "Smart Assignment & Progress Monitoring API"

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    SECRET_KEY: str = ""  # Must be set via environment variable

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v, info):
        """Ensure SECRET_KEY is set and not a placeholder in production"""
        env = info.data.get("ENVIRONMENT", "development")
        if env == "production":
            if not v or len(v) < 32:
                raise ValueError(
                    "SECRET_KEY must be at least 32 characters in production. "
                    "Set a secure random SECRET_KEY in your deployment environment."
                )
            placeholders = [
                "your-secret",
                "change-in-production",
                "placeholder",
                "secret-key",
            ]
            if any(p in v.lower() for p in placeholders):
                raise ValueError(
                    "SECRET_KEY appears to be a placeholder. "
                    "Set a secure random SECRET_KEY in your deployment environment."
                )
        return v

    # Redis (optional - used for rate limiting, caching)
    REDIS_URL: Optional[str] = None

    # Database
    MONGODB_URL: str = "mongodb://localhost:27017"
    DATABASE_NAME: str = "learntrack_mvp"
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: int = 500
    MONGODB_CONNECT_TIMEOUT_MS: int = 500
    MONGODB_SOCKET_TIMEOUT_MS: int = 2000
    MONGODB_MAX_POOL_SIZE: int = 50
    MONGODB_MIN_POOL_SIZE: int = 5
    STARTUP_PING_DATABASE: bool = False
    RUN_STARTUP_BOOTSTRAP: bool = False

    # Clerk Configuration - Enhanced for Backend-First Auth
    CLERK_SECRET_KEY: Optional[str] = None
    CLERK_PUBLISHABLE_KEY: Optional[str] = None
    # REQUIRED: Set to your Clerk instance issuer, e.g., https://clerk.your-app.clerk.accounts.dev
    CLERK_JWT_ISSUER: Optional[str] = None
    # REQUIRED: Audience should match your Clerk Backend Token Template (e.g., "fastapi")
    CLERK_JWT_AUDIENCE: Optional[str] = None
    # Optional: name of the Clerk token template the frontend should request
    CLERK_TOKEN_TEMPLATE: str = "fastapi"

    # Clerk Backend-Specific Settings
    CLERK_WEBHOOK_SECRET: Optional[str] = None
    CLERK_JWT_VERIFICATION_TIMEOUT: int = 10  # seconds
    CLERK_JWKS_CACHE_TTL: int = 3600  # 1 hour in seconds
    CLERK_ENABLE_DEVELOPMENT_MODE: bool = True  # Allow dev tokens in development
    CLERK_FRONTEND_API: Optional[str] = None  # For frontend API calls

    # AI Provider Configuration
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None

    # AI Model Configuration
    # NOTE: Model lists are now centralized in app/core/ai_models_config.py
    # These prefixes are kept for backwards compatibility but prefer using
    # get_model_prefixes() from ai_models_config.py instead

    # RAG Configuration
    QDRANT_URL: Optional[str] = None
    QDRANT_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None
    MAX_RAG_TOKEN_BUDGET: int = 3000  # Default max tokens for RAG context

    # PostHog Configuration
    POSTHOG_API_KEY: Optional[str] = None
    POSTHOG_API_HOST: str = "https://us.i.posthog.com"

    # Cloudflare R2 Storage
    R2_ACCESS_KEY_ID: Optional[str] = None
    R2_SECRET_ACCESS_KEY: Optional[str] = None
    R2_ENDPOINT_URL: Optional[str] = None
    R2_BUCKET_NAME: str = "learntrack-uploads"
    R2_PUBLIC_URL: Optional[str] = None

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:5173",
    ]

    # Logging
    LOG_LEVEL: str = "INFO"

    # File Storage
    MAX_FILE_SIZE: int = 10 * 1024 * 1024  # 10MB
    ALLOWED_FILE_TYPES: List[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v):
        import json

        if isinstance(v, str):
            if v.startswith("["):
                # Parse JSON array
                return json.loads(v)
            else:
                # Comma-separated list
                return [i.strip() for i in v.split(",")]
        elif isinstance(v, list):
            return v
        raise ValueError(v)

    @field_validator("CLERK_JWT_ISSUER")
    @classmethod
    def validate_clerk_issuer(cls, v, info):
        if info.data.get("ENVIRONMENT") == "production":
            if not v:
                raise ValueError("CLERK_JWT_ISSUER is required in production")
            if v == "https://clerk.dev":
                raise ValueError(
                    "CLERK_JWT_ISSUER must be set to your specific Clerk instance URL"
                )
        return v

    @field_validator("CLERK_JWT_AUDIENCE")
    @classmethod
    def validate_clerk_audience(cls, v, info):
        if info.data.get("ENVIRONMENT") == "production" and not v:
            raise ValueError("CLERK_JWT_AUDIENCE is required in production")
        return v

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env")


# Global settings instance
settings = Settings()
