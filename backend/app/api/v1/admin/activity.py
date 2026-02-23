"""
Admin Activity/Audit Log API endpoints
Provides activity tracking and audit logging for super admins
"""

from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_super_admin,
    require_admin_permission,
    ClerkUserContext,
)
from app.models.user import AdminPermission
from app.models.audit_log import (
    AuditLog,
    AuditLogFilter,
    PaginatedAuditLogResponse,
    AuditLogSummary,
    AuditLogCreate,
)
from app.services.audit_log_service import AuditLogService

logger = structlog.get_logger()
router = APIRouter()


@router.get("/", response_model=PaginatedAuditLogResponse)
async def get_activity_logs(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    method: Optional[str] = Query(
        None, description="Filter by HTTP method (GET, POST, etc.)"
    ),
    resource: Optional[str] = Query(
        None, description="Filter by resource (e.g., 'users', 'assignments')"
    ),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    status_code: Optional[int] = Query(None, description="Filter by HTTP status code"),
    from_date: Optional[datetime] = Query(
        None, description="Filter from date (ISO format)"
    ),
    to_date: Optional[datetime] = Query(
        None, description="Filter to date (ISO format)"
    ),
    days: int = Query(
        30, ge=1, le=90, description="Number of days to look back (default: 30)"
    ),
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_AUDIT_LOGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get paginated activity logs with optional filters.

    - Requires 'view_audit_logs' permission
    - Data retention: 30 days (automatic cleanup)
    """
    try:
        # Build filters
        filters = AuditLogFilter()

        if method:
            filters.method = method
        if resource:
            filters.resource = resource
        if user_id:
            filters.user_id = user_id
        if status_code:
            filters.status_code = status_code

        # Handle date range
        if from_date:
            filters.from_date = from_date
        if to_date:
            filters.to_date = to_date

        # Default to last N days if no dates specified
        if not from_date and not to_date:
            filters.from_date = datetime.now(timezone.utc) - __import__(
                "datetime"
            ).timedelta(days=days)
            filters.to_date = datetime.now(timezone.utc)

        # Get audit logs
        audit_service = AuditLogService(database)
        result = await audit_service.get_audit_logs(
            filters=filters, page=page, per_page=per_page
        )

        logger.info(
            "Admin retrieved activity logs",
            admin_id=current_user.clerk_id,
            page=page,
            total_logs=result.total,
            filters_applied=bool(method or resource or user_id or status_code),
        )

        return result
    except Exception as e:
        logger.error(
            "Failed to get activity logs", error=str(e), admin_id=current_user.clerk_id
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve activity logs")


@router.get("/summary", response_model=AuditLogSummary)
async def get_activity_summary(
    days: int = Query(7, ge=1, le=30, description="Number of days to summarize"),
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_AUDIT_LOGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get summary statistics for activity logs.

    Returns:
    - Total requests
    - Unique users
    - Average response time
    - Error rate
    - Top resources accessed
    - Top active users
    """
    try:
        audit_service = AuditLogService(database)
        summary = await audit_service.get_audit_log_summary(days=days)

        logger.info(
            "Admin retrieved activity summary",
            admin_id=current_user.clerk_id,
            days=days,
        )

        return summary
    except Exception as e:
        logger.error(
            "Failed to get activity summary",
            error=str(e),
            admin_id=current_user.clerk_id,
        )
        raise HTTPException(
            status_code=500, detail="Failed to retrieve activity summary"
        )


@router.get("/user/{user_id}", response_model=List[AuditLog])
async def get_user_activity(
    user_id: str,
    limit: int = Query(
        50, ge=1, le=100, description="Maximum number of logs to return"
    ),
    days: int = Query(30, ge=1, le=90, description="Number of days to look back"),
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_AUDIT_LOGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get activity logs for a specific user.

    Useful for investigating user-specific issues or tracking user behavior.
    """
    try:
        audit_service = AuditLogService(database)
        logs = await audit_service.get_audit_logs_by_user(
            user_id=user_id, limit=limit, days=days
        )

        logger.info(
            "Admin retrieved user activity logs",
            admin_id=current_user.clerk_id,
            target_user_id=user_id,
            log_count=len(logs),
        )

        return logs
    except Exception as e:
        logger.error(
            "Failed to get user activity logs",
            error=str(e),
            admin_id=current_user.clerk_id,
            target_user_id=user_id,
        )
        raise HTTPException(
            status_code=500, detail="Failed to retrieve user activity logs"
        )


@router.post("/cleanup", response_model=dict)
async def cleanup_old_logs(
    retention_days: int = Query(
        30, ge=7, le=365, description="Retention period in days"
    ),
    current_user: ClerkUserContext = Depends(require_super_admin),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Manually trigger cleanup of old audit logs.

    - Requires super admin access
    - Normally handled automatically by TTL index
    - Use this for immediate cleanup or custom retention periods
    """
    try:
        audit_service = AuditLogService(database)
        deleted_count = await audit_service.cleanup_old_logs(
            retention_days=retention_days
        )

        logger.info(
            "Admin triggered audit log cleanup",
            admin_id=current_user.clerk_id,
            deleted_count=deleted_count,
            retention_days=retention_days,
        )

        return {
            "message": f"Successfully deleted {deleted_count} old audit logs",
            "deleted_count": deleted_count,
            "retention_days": retention_days,
        }
    except Exception as e:
        logger.error(
            "Failed to cleanup audit logs", error=str(e), admin_id=current_user.clerk_id
        )
        raise HTTPException(status_code=500, detail="Failed to cleanup audit logs")


@router.post("/setup-index", response_model=dict)
async def setup_audit_log_index(
    current_user: ClerkUserContext = Depends(require_super_admin),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Setup TTL index for automatic audit log cleanup.

    - Requires super admin access
    - Should be run once during initial setup
    - Creates index for 30-day retention
    """
    try:
        audit_service = AuditLogService(database)
        await audit_service.setup_ttl_index()

        logger.info("Admin setup audit log TTL index", admin_id=current_user.clerk_id)

        return {
            "message": "TTL index created successfully for automatic 30-day cleanup",
            "status": "success",
        }
    except Exception as e:
        logger.error(
            "Failed to setup audit log index",
            error=str(e),
            admin_id=current_user.clerk_id,
        )
        raise HTTPException(status_code=500, detail="Failed to setup audit log index")
