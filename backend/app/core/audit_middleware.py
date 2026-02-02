"""
Audit logging middleware for automatic activity tracking.
Logs all API requests with user context for admin monitoring.
"""

import time
from datetime import datetime, timezone
from typing import Optional, List, Set
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
import structlog

from app.core.database import get_database
from app.models.audit_log import AuditLogCreate
from app.services.audit_log_service import AuditLogService

logger = structlog.get_logger()


# Paths to skip for audit logging (health checks, static files, etc.)
SKIP_PATHS: Set[str] = {
    "/health",
    "/health/ready",
    "/metrics",
    "/favicon.ico",
    "/docs",
    "/openapi.json",
    "/redoc",
}

# Path prefixes to skip
SKIP_PREFIXES: List[str] = [
    "/static/",
    "/assets/",
    "/_next/",
]


class AuditLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to automatically log all API requests for audit trail"""

    def __init__(self, app):
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Check if path should be skipped
        if self._should_skip(request.url.path):
            return await call_next(request)

        # Record start time
        start_time = time.time()
        start_time_iso = datetime.now(timezone.utc)

        # Get client info
        client_ip = self._get_client_ip(request)
        user_agent = request.headers.get("user-agent")

        # Extract resource info from path
        resource, resource_id = self._extract_resource_info(request.url.path)

        # Get user context if available
        user_id = None
        user_email = None
        user_name = None
        tenant_id = None

        try:
            # Try to get user from request state (set by auth middleware)
            if hasattr(request.state, "user") and request.state.user:
                user = request.state.user
                user_id = getattr(user, "clerk_id", None) or getattr(user, "id", None)
                user_email = getattr(user, "email", None) or getattr(
                    user, "primary_email", None
                )
                user_name = getattr(user, "full_name", None) or getattr(
                    user, "name", None
                )
                tenant_id = getattr(user, "tenant_id", None) or getattr(
                    user, "tutor_id", None
                )
        except Exception:
            pass

        # Process request
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception as e:
            status_code = 500
            raise
        finally:
            # Calculate duration
            duration_ms = int((time.time() - start_time) * 1000)

            # Only log if we have a user context (authenticated requests)
            if user_id:
                try:
                    await self._log_request(
                        request=request,
                        status_code=status_code,
                        duration_ms=duration_ms,
                        start_time=start_time_iso,
                        user_id=user_id,
                        user_email=user_email,
                        user_name=user_name,
                        tenant_id=tenant_id,
                        client_ip=client_ip,
                        user_agent=user_agent,
                        resource=resource,
                        resource_id=resource_id,
                    )
                except Exception as e:
                    # Log failure shouldn't break the request
                    logger.warning("Failed to create audit log", error=str(e))

        return response

    def _should_skip(self, path: str) -> bool:
        """Check if path should be skipped for audit logging"""
        # Exact path matches
        if path in SKIP_PATHS:
            return True

        # Prefix matches
        for prefix in SKIP_PREFIXES:
            if path.startswith(prefix):
                return True

        return False

    def _get_client_ip(self, request: Request) -> Optional[str]:
        """Extract client IP from request headers"""
        # Check for forwarded IP (when behind proxy/load balancer)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()

        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip

        # Fall back to direct connection
        if request.client:
            return request.client.host

        return None

    def _extract_resource_info(self, path: str) -> tuple:
        """Extract resource name and ID from path"""
        parts = path.strip("/").split("/")

        if len(parts) < 2:
            return "root", None

        # Get API version and resource
        if parts[0] == "api":
            if len(parts) >= 3:
                resource = parts[2]  # e.g., "users" from /api/v1/users
                resource_id = parts[3] if len(parts) >= 4 else None
                return resource, resource_id
            return "api", None

        # For non-API paths
        resource = parts[0]  # e.g., "admin" from /admin/users
        resource_id = parts[1] if len(parts) >= 2 else None
        return resource, resource_id

    async def _log_request(
        self,
        request: Request,
        status_code: int,
        duration_ms: int,
        start_time: datetime,
        user_id: str,
        user_email: Optional[str],
        user_name: Optional[str],
        tenant_id: Optional[str],
        client_ip: Optional[str],
        user_agent: Optional[str],
        resource: str,
        resource_id: Optional[str],
    ):
        """Create audit log entry"""
        try:
            # Get database connection
            # Note: In middleware we need to get db differently than in endpoints
            # We'll use the app's db from request.app
            db = request.app.state.db

            audit_service = AuditLogService(db)

            # Extract query params
            query_params = dict(request.query_params) if request.query_params else None

            # Create audit log
            audit_log = AuditLogCreate(
                timestamp=start_time,
                user_id=user_id,
                user_email=user_email,
                user_name=user_name,
                method=request.method,
                resource=resource,
                resource_id=resource_id,
                status_code=status_code,
                duration_ms=duration_ms,
                ip_address=client_ip,
                user_agent=user_agent,
                tenant_id=tenant_id,
                endpoint=str(request.url.path),
                query_params=query_params,
                details=None,  # Could add request body hash or other details here
            )

            await audit_service.create_audit_log(audit_log)

        except Exception as e:
            logger.warning(
                "Audit log creation failed",
                error=str(e),
                user_id=user_id,
                path=str(request.url.path),
            )
