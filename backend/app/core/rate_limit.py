"""
Rate limiting configuration for LearnTrack API

Rate limits are applied based on endpoint type:
- AI/Generation endpoints: 10/minute (expensive operations)
- Write endpoints (POST/PUT/DELETE): 30/minute
- Read endpoints (GET): 100/minute
- Auth endpoints: 20/minute (prevent brute force)
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi import Request
from fastapi.responses import JSONResponse
import structlog

logger = structlog.get_logger()


def get_request_identifier(request: Request) -> str:
    """
    Get a unique identifier for the request.
    Uses authenticated user ID if available, otherwise falls back to IP address.
    """
    # Try to get user from request state (set by auth middleware)
    if hasattr(request.state, 'user') and request.state.user:
        user_id = getattr(request.state.user, 'clerk_id', None)
        if user_id:
            return f"user:{user_id}"
    
    # Fall back to IP address
    return get_remote_address(request)


# Use Redis when available for shared rate limiting across workers, else fall back to memory
from app.core.config import settings as _settings

_storage_uri = _settings.REDIS_URL or "memory://"

# Create limiter with custom key function
limiter = Limiter(
    key_func=get_request_identifier,
    default_limits=["100/minute"],  # Default limit for all endpoints
    storage_uri=_storage_uri,
    strategy="fixed-window",
)


# Rate limit presets for different endpoint types
RATE_LIMITS = {
    "ai_generation": "10/minute",      # AI/RAG question generation
    "ai_regenerate": "20/minute",      # Single question regeneration
    "write": "30/minute",              # POST, PUT, DELETE operations
    "read": "100/minute",              # GET operations
    "auth": "20/minute",               # Authentication endpoints
    "bulk": "5/minute",                # Bulk operations
    "file_upload": "20/minute",        # File upload operations
}


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """
    Custom handler for rate limit exceeded errors.
    Returns a consistent JSON response with retry-after header.
    """
    logger.warning(
        "Rate limit exceeded",
        path=request.url.path,
        method=request.method,
        client=get_request_identifier(request),
        limit=str(exc.detail),
    )
    
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please slow down your requests.",
            "error": "rate_limit_exceeded",
            "limit": str(exc.detail),
        },
        headers={
            "Retry-After": "60",
            "X-RateLimit-Limit": str(exc.detail),
        },
    )


def setup_rate_limiting(app):
    """
    Setup rate limiting for the FastAPI application.
    Call this during app initialization.
    """
    # Add limiter to app state
    app.state.limiter = limiter
    
    # Add the rate limit exceeded exception handler
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    
    # Add middleware
    app.add_middleware(SlowAPIMiddleware)
    
    logger.info("Rate limiting configured successfully")

