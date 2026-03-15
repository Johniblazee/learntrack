import asyncio
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import structlog
from datetime import datetime, timezone

from app.core.database import database
from app.core.config import settings
from app.core.enhanced_auth import close_clerk_http_client
from app.core.posthog import shutdown as posthog_shutdown
from app.models.responses import HealthResponse
from app.core.exceptions import (
    LearnTrackException,
    learntrack_exception_handler,
    http_exception_handler,
    validation_exception_handler,
    general_exception_handler,
)
from app.core.rate_limit import setup_rate_limiting, limiter
from app.websocket import get_socket_app
from app.core.security_middleware import SecurityHeadersMiddleware
from app.core.metrics import MetricsMiddleware, metrics_collector
from app.core.audit_middleware import AuditLoggingMiddleware
from app.core.health import health_checker, HealthStatus
from app.core.logging_config import RequestLoggingMiddleware, configure_logging
from app.core.cache import get_cache_stats
from app.api.v1.lazy_subapps import create_lazy_router_subapp

# Configure structured logging
configure_logging()

logger = structlog.get_logger()


def _track_background_task(task, task_name: str):
    """Track background startup tasks and log failures without blocking readiness."""

    def _log_result(completed_task):
        try:
            completed_task.result()
            logger.info("Background startup task completed", task=task_name)
        except Exception as error:
            logger.error(
                "Background startup task failed",
                task=task_name,
                error=str(error),
            )

    task.add_done_callback(_log_result)
    return task


async def _run_startup_bootstrap(db_ref):
    """Run non-critical schema bootstrap work outside request-serving startup."""
    from app.bootstrap import run_bootstrap_tasks

    await run_bootstrap_tasks(db_ref)


app = FastAPI(
    title="LearnTrack API",
    version="1.0.0",
    redirect_slashes=False,  # Disable automatic redirects to avoid auth issues with CORS
    description="""
    ## LearnTrack - Smart Assignment & Progress Monitoring API

    This API provides comprehensive functionality for managing educational content, students, assignments, and AI-powered question generation.

    ### Key Features:
    * **Student Management**: Create, update, and manage student profiles and groups
    * **Subject & Content Management**: Organize subjects, topics, and educational materials
    * **AI Question Generation**: Generate questions using multiple AI providers (OpenAI, Anthropic, Google)
    * **Assignment Tracking**: Create and monitor student assignments and progress
    * **File Management**: Upload and process educational documents
    * **Settings Management**: Configure AI providers and system settings

    ### Authentication:
    Most endpoints require authentication via Clerk JWT tokens. Include the token in the Authorization header:
    ```
    Authorization: Bearer <your-clerk-jwt-token>
    ```

    ### Role-Based Access Control:
    * **Tutors**: Full access to create assignments, manage students, and view all data
    * **Students**: Access to their own assignments and progress
    * **Parents**: Access to their children's progress and assignments

    ### Getting Started:
    1. Sign up/sign in through the frontend application to get a JWT token
    2. Use the token in the Authorization header for protected endpoints
    3. Start with `/health` to verify the API is running (no auth required)
    4. Get your profile with `/api/v1/users/me` (auth required)
    5. Explore role-specific endpoints based on your user role
    """,
    contact={
        "name": "LearnTrack Support",
        "email": "support@learntrack.example.com",
    },
    license_info={
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Register exception handlers
app.add_exception_handler(LearnTrackException, learntrack_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Setup rate limiting
setup_rate_limiting(app)

# Add security headers middleware (production security)
app.add_middleware(SecurityHeadersMiddleware)

# Add metrics collection middleware
app.add_middleware(MetricsMiddleware)

# Add request logging middleware
app.add_middleware(RequestLoggingMiddleware)

# Add audit logging middleware (must be after auth middleware to capture user context)
app.add_middleware(AuditLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-LearnTrack-Impersonation-Session"],
)


# Database lifecycle events
@app.on_event("startup")
async def startup_event():
    """Initialize lightweight process state on startup."""
    try:
        db_ref = await database.init_client()
        app.state.db = db_ref
        app.state.startup_tasks = {}

        if settings.STARTUP_PING_DATABASE:
            await database.ensure_connected()

        if settings.RUN_STARTUP_BOOTSTRAP:
            task = _track_background_task(
                asyncio.create_task(_run_startup_bootstrap(db_ref)),
                "database_bootstrap",
            )
            app.state.startup_tasks["database_bootstrap"] = task

        logger.info("FastAPI application started successfully")
    except Exception as e:
        logger.error("Failed to start FastAPI application", error=str(e))
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """Close database connection on shutdown"""
    try:
        for task in getattr(app.state, "startup_tasks", {}).values():
            if task and not task.done():
                task.cancel()
        await database.close_database_connection()
        await close_clerk_http_client()
        posthog_shutdown()
        logger.info("FastAPI application shutdown successfully")
    except Exception as e:
        logger.error("Error during FastAPI application shutdown", error=str(e))


# Include routers
from app.api.v1 import api_router

app.include_router(api_router, prefix="/api/v1")
app.mount(
    "/api/v1/question-generator",
    create_lazy_router_subapp("app.api.v1.endpoints.question_generator"),
)
app.mount(
    "/api/v1/rag",
    create_lazy_router_subapp("app.api.v1.endpoints.rag"),
)

# Mount Socket.IO app for WebSocket support
socket_app = get_socket_app()
app.mount("/ws", socket_app)

# Authentication removed - no user role endpoint needed


# Health and monitoring endpoints
@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health():
    """
    Liveness probe - simple health check to verify API is running.
    Used by load balancers and container orchestrators.
    """
    result = await health_checker.check_liveness()
    return HealthResponse(
        status=result["status"],
        service=result["service"],
        version=result["version"],
        timestamp=result["timestamp"],
    )


@app.get("/health/ready", tags=["Health"])
async def health_ready():
    """
    Readiness probe - checks if application is ready to serve traffic.
    Verifies database connectivity and other dependencies.
    Returns 503 if not ready.
    """
    result = await health_checker.check_readiness(deep=False)

    if result["status"] == HealthStatus.UNHEALTHY.value:
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=503, content=result)

    return result


@app.get("/health/ready/deep", tags=["Health"])
async def health_ready_deep():
    """Optional deep readiness check including vector store connectivity."""
    result = await health_checker.check_readiness(deep=True)

    if result["status"] == HealthStatus.UNHEALTHY.value:
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=503, content=result)

    return result


@app.get("/metrics", tags=["Monitoring"])
async def get_metrics():
    """
    Get application metrics including request counts, response times, and error rates.
    Useful for monitoring dashboards and alerting.
    """
    return {
        "metrics": metrics_collector.get_metrics(),
        "cache": get_cache_stats(),
    }


@app.get("/metrics/summary", tags=["Monitoring"])
async def get_metrics_summary():
    """Get a brief summary of key metrics."""
    return metrics_collector.get_summary()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
