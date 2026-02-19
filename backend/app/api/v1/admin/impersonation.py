"""
Admin User Impersonation API endpoints
Allows super admins to impersonate users for support/debugging
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import secrets
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_admin_permission, ClerkUserContext
from app.core.impersonation_store import (
    get_impersonation_session as get_impersonation_session_record,
    list_impersonation_sessions_for_admin,
    put_impersonation_session,
    remove_impersonation_session,
)
from app.models.user import AdminPermission
from app.models.admin import (
    AuditAction,
    ImpersonationSession,
    ImpersonationStartRequest,
    ImpersonationResponse,
)
from app.api.v1.admin.audit_utils import log_admin_action as _log_admin_action

logger = structlog.get_logger()
router = APIRouter()


def get_active_impersonation_session(session_id: str) -> Optional[ImpersonationSession]:
    """Compatibility helper used by auth layer."""
    return get_impersonation_session_record(session_id)


@router.post("/start", response_model=ImpersonationResponse)
async def start_impersonation(
    request: ImpersonationStartRequest,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.FULL_ACCESS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Start impersonating a user. Requires IMPERSONATE_USERS or FULL_ACCESS permission."""
    try:
        target_user = None
        target_collection = None

        # Search for user across all collections
        for collection_name in ["tutors", "students", "parents"]:
            collection = database[collection_name]
            # Try clerk_id first
            user = await collection.find_one({"clerk_id": request.target_user_id})
            if not user:
                try:
                    user = await collection.find_one(
                        {"_id": ObjectId(request.target_user_id)}
                    )
                except Exception:
                    pass
            if user:
                target_user = user
                target_collection = collection_name
                break

        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")

        # Prevent impersonating super admins
        if target_user.get("is_super_admin", False):
            raise HTTPException(
                status_code=403, detail="Cannot impersonate super admin users"
            )

        # Prevent impersonating yourself
        if target_user.get("clerk_id") == current_user.clerk_id:
            raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

        # Create impersonation session
        session_id = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        admin_email = current_user.email or ""
        default_role = target_collection[:-1] if target_collection else "user"

        session = ImpersonationSession(
            session_id=session_id,
            admin_clerk_id=current_user.clerk_id,
            admin_email=admin_email,
            target_user_id=str(target_user["_id"]),
            target_clerk_id=target_user.get("clerk_id", ""),
            target_email=target_user.get("email", ""),
            target_name=target_user.get("name", "Unknown"),
            target_role=target_user.get("role", default_role),
            target_tutor_id=target_user.get("tutor_id"),
            expires_at=expires_at,
        )

        put_impersonation_session(session)

        # Log the impersonation start
        await _log_admin_action(
            database,
            current_user.clerk_id,
            admin_email,
            AuditAction.IMPERSONATION_STARTED,
            "user",
            target_user.get("clerk_id"),
            {
                "target_email": target_user.get("email"),
                "target_role": target_user.get("role"),
                "session_id": session_id,
            },
        )

        logger.info(
            "Impersonation started",
            admin=current_user.email,
            target=target_user.get("email"),
            session_id=session_id,
        )

        return ImpersonationResponse(
            session_id=session_id,
            target_user={
                "id": str(target_user["_id"]),
                "clerk_id": target_user.get("clerk_id", ""),
                "email": target_user.get("email", ""),
                "name": target_user.get("name", "Unknown"),
                "role": target_user.get("role", ""),
                "tutor_id": target_user.get("tutor_id"),
            },
            expires_in_minutes=60,
            message=f"Now impersonating {target_user.get('name', 'user')}",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to start impersonation", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to start impersonation: {str(e)}"
        )


@router.post("/end")
async def end_impersonation(
    session_id: str,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.FULL_ACCESS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """End an impersonation session"""
    try:
        session = get_impersonation_session_record(session_id)

        if not session:
            raise HTTPException(
                status_code=404, detail="Impersonation session not found"
            )

        # Verify the session belongs to this admin
        if session.admin_clerk_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403, detail="Not authorized to end this session"
            )

        # Remove the session
        remove_impersonation_session(session_id)

        # Log the impersonation end
        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            AuditAction.IMPERSONATION_ENDED,
            "user",
            session.target_clerk_id,
            {
                "target_email": session.target_email,
                "session_id": session_id,
                "duration_minutes": int(
                    (datetime.now(timezone.utc) - session.started_at).total_seconds()
                    / 60
                ),
            },
        )

        logger.info(
            "Impersonation ended",
            admin=current_user.email,
            target=session.target_email,
            session_id=session_id,
        )

        return {"status": "ended", "message": "Impersonation session ended"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to end impersonation", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to end impersonation: {str(e)}"
        )


@router.get("/session/{session_id}")
async def get_impersonation_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.FULL_ACCESS)
    ),
):
    """Get details of an active impersonation session"""
    session = get_impersonation_session_record(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Impersonation session not found")

    # Verify the session belongs to this admin
    if session.admin_clerk_id != current_user.clerk_id:
        raise HTTPException(
            status_code=403, detail="Not authorized to view this session"
        )

    return {
        "session_id": session.session_id,
        "target_user": {
            "id": session.target_user_id,
            "clerk_id": session.target_clerk_id,
            "email": session.target_email,
            "name": session.target_name,
            "role": session.target_role,
            "tutor_id": session.target_tutor_id,
        },
        "started_at": session.started_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "remaining_minutes": max(
            0,
            int((session.expires_at - datetime.now(timezone.utc)).total_seconds() / 60),
        ),
    }


@router.get("/active")
async def get_active_sessions(
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.FULL_ACCESS)
    ),
):
    """Get all active impersonation sessions for the current admin"""
    now = datetime.now(timezone.utc)
    sessions = []

    for session in list_impersonation_sessions_for_admin(current_user.clerk_id):
        sessions.append(
            {
                "session_id": session.session_id,
                "target_email": session.target_email,
                "target_name": session.target_name,
                "target_role": session.target_role,
                "remaining_minutes": max(
                    0, int((session.expires_at - now).total_seconds() / 60)
                ),
            }
        )

    return {"sessions": sessions}
