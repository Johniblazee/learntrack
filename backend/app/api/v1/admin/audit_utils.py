"""
Shared admin audit logging helpers.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

logger = structlog.get_logger()


async def log_admin_action(
    database: AsyncIOMotorDatabase,
    admin_id: str,
    admin_email: Optional[str],
    action: Any,
    target_type: str,
    target_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Log an admin action for audit trail."""
    try:
        await database.admin_audit_logs.insert_one(
            {
                "admin_id": admin_id,
                "admin_email": admin_email or "",
                "action": action.value if hasattr(action, "value") else action,
                "target_type": target_type,
                "target_id": target_id,
                "details": details or {},
                "timestamp": datetime.now(timezone.utc),
            }
        )
    except Exception as exc:
        logger.warning("Failed to log admin action", error=str(exc))
