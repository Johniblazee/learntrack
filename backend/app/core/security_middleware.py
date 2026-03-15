"""
Security Headers Middleware - HSTS, CSP, X-Frame-Options, etc.
"""

from typing import Dict, Optional
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
import structlog

from app.core.config import settings

logger = structlog.get_logger()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add security headers to all responses.

    Headers added:
    - Strict-Transport-Security (HSTS)
    - Content-Security-Policy (CSP)
    - X-Frame-Options
    - X-Content-Type-Options
    - X-XSS-Protection
    - Referrer-Policy
    - Permissions-Policy
    """

    def __init__(
        self,
        app,
        hsts_max_age: int = 31536000,  # 1 year
        include_subdomains: bool = True,
        preload: bool = False,
        csp_policy: Optional[Dict[str, str]] = None,
        frame_options: str = "DENY",
    ):
        super().__init__(app)
        self.hsts_max_age = hsts_max_age
        self.include_subdomains = include_subdomains
        self.preload = preload
        self.frame_options = frame_options

        # Default CSP policy
        self.csp_policy = csp_policy or {
            "default-src": "'self'",
            "script-src": "'self' 'unsafe-inline' 'unsafe-eval' https://clerk.com https://*.clerk.accounts.dev https://cdn.jsdelivr.net",
            "style-src": "'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
            "img-src": "'self' data: https: blob: https://fastapi.tiangolo.com",
            "font-src": "'self' https://fonts.gstatic.com",
            "connect-src": "'self' https://api.clerk.com https://*.clerk.accounts.dev wss://* https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.groq.com https://us.i.posthog.com",
            "frame-ancestors": "'self'",
            "form-action": "'self'",
            "base-uri": "'self'",
            "object-src": "'none'",
        }

    def _build_hsts_header(self) -> str:
        """Build HSTS header value"""
        value = f"max-age={self.hsts_max_age}"
        if self.include_subdomains:
            value += "; includeSubDomains"
        if self.preload:
            value += "; preload"
        return value

    def _build_csp_header(self) -> str:
        """Build CSP header value"""
        return "; ".join(f"{key} {value}" for key, value in self.csp_policy.items())

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)

        # Only add HSTS in production (requires HTTPS)
        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = self._build_hsts_header()

        # Content Security Policy
        response.headers["Content-Security-Policy"] = self._build_csp_header()

        # X-Frame-Options - prevent clickjacking
        response.headers["X-Frame-Options"] = self.frame_options

        # X-Content-Type-Options - prevent MIME sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # X-XSS-Protection - XSS filter (legacy, but still useful)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer-Policy - control referrer information
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions-Policy - restrict browser features
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
            "magnetometer=(), microphone=(), payment=(), usb=()"
        )

        return response
