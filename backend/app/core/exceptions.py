"""
Custom exceptions and error handlers
"""

from typing import Any, Dict, Optional
from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import structlog

logger = structlog.get_logger()


class LearnTrackException(Exception):
    """Base exception for LearnTrack application"""

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class DatabaseException(LearnTrackException):
    """Database operation exceptions"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            details=details,
        )


class NotFoundError(LearnTrackException):
    """Resource not found exception"""

    def __init__(self, resource: str, identifier: str):
        super().__init__(
            message=f"{resource} with ID '{identifier}' not found",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"resource": resource, "id": identifier},
        )


class ValidationError(LearnTrackException):
    """Validation error exception"""

    def __init__(self, message: str, field: Optional[str] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details={"field": field} if field else {},
        )


class AuthorizationError(LearnTrackException):
    """Authorization error exception"""

    def __init__(self, message: str = "Access denied"):
        super().__init__(message=message, status_code=status.HTTP_403_FORBIDDEN)


class FileProcessingError(LearnTrackException):
    """File processing error exception"""

    def __init__(self, message: str, file_id: Optional[str] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details={"file_id": file_id} if file_id else {},
        )


class AIProviderError(LearnTrackException):
    """AI provider error exception"""

    def __init__(self, message: str, provider: Optional[str] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            details={"provider": provider} if provider else {},
        )


class AIAuthenticationError(AIProviderError):
    """AI authentication failure."""

    def __init__(
        self,
        message: str = "Invalid AI provider credentials",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_401_UNAUTHORIZED


class AIBadRequestError(AIProviderError):
    """AI provider rejected the request payload."""

    def __init__(
        self,
        message: str = "Invalid AI provider request",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_400_BAD_REQUEST


class AIRateLimitError(AIProviderError):
    """AI provider rate limit exceeded."""

    def __init__(
        self,
        message: str = "AI provider rate limit exceeded",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_429_TOO_MANY_REQUESTS


class AITimeoutError(AIProviderError):
    """AI provider request timed out."""

    def __init__(
        self,
        message: str = "AI provider request timed out",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_504_GATEWAY_TIMEOUT


class AIConnectionError(AIProviderError):
    """AI provider connection failed."""

    def __init__(
        self,
        message: str = "Could not reach AI provider",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_503_SERVICE_UNAVAILABLE


class AIServiceUnavailableError(AIProviderError):
    """AI provider is temporarily unavailable."""

    def __init__(
        self,
        message: str = "AI provider is temporarily unavailable",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_503_SERVICE_UNAVAILABLE


class AIContextWindowExceededError(AIBadRequestError):
    """Prompt exceeded the model context window."""

    def __init__(
        self,
        message: str = "Prompt exceeds the model context window",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_422_UNPROCESSABLE_ENTITY


class AIContentPolicyViolationError(AIProviderError):
    """Provider blocked the request due to safety policy."""

    def __init__(
        self,
        message: str = "Request blocked by AI provider safety policy",
        provider: Optional[str] = None,
    ):
        super().__init__(message=message, provider=provider)
        self.status_code = status.HTTP_403_FORBIDDEN


# Exception handlers
async def learntrack_exception_handler(request: Request, exc: LearnTrackException):
    """Handle custom LearnTrack exceptions"""
    logger.error(
        "LearnTrack exception occurred",
        exception=exc.__class__.__name__,
        message=exc.message,
        status_code=exc.status_code,
        details=exc.details,
        path=request.url.path,
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.message,
            "code": exc.__class__.__name__,
            "status_code": exc.status_code,
        },
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions with enhanced error messages"""
    logger.warning(
        "HTTP exception occurred",
        status_code=exc.status_code,
        detail=exc.detail,
        path=request.url.path,
    )

    # Provide more helpful messages for common HTTP errors
    error_type = "HTTPException"
    message = exc.detail
    details = {}

    if exc.status_code == 404:
        error_type = "NotFound"
        message = (
            exc.detail or f"The requested resource '{request.url.path}' was not found"
        )
        details = {
            "path": request.url.path,
            "method": request.method,
            "suggestion": "Please check the URL and try again. See /docs for available endpoints.",
        }
    elif exc.status_code == 403:
        error_type = "Forbidden"
        message = exc.detail or "You don't have permission to access this resource"
        details = {
            "path": request.url.path,
            "suggestion": "Please ensure you have the required permissions or contact an administrator.",
        }
    elif exc.status_code == 401:
        error_type = "Unauthorized"
        message = exc.detail or "Authentication is required to access this resource"
        details = {
            "path": request.url.path,
            "suggestion": "Please provide a valid authentication token in the Authorization header.",
        }
    elif exc.status_code == 405:
        error_type = "MethodNotAllowed"
        message = (
            exc.detail
            or f"The {request.method} method is not allowed for this endpoint"
        )
        details = {
            "path": request.url.path,
            "method": request.method,
            "suggestion": "Check the API documentation for allowed methods on this endpoint.",
        }

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": message,
            "code": error_type,
            "status_code": exc.status_code,
        },
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation exceptions"""
    logger.warning(
        "Validation exception occurred", errors=exc.errors(), path=request.url.path
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Request validation failed",
            "code": "ValidationError",
            "status_code": status.HTTP_422_UNPROCESSABLE_ENTITY,
            "errors": exc.errors(),
        },
    )


async def general_exception_handler(request: Request, exc: Exception):
    """Handle general exceptions"""
    logger.error(
        "Unexpected exception occurred",
        exception=exc.__class__.__name__,
        message=str(exc),
        path=request.url.path,
        exc_info=True,
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An unexpected error occurred",
            "code": "InternalServerError",
            "status_code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        },
    )
