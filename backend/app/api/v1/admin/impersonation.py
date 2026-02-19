"""
Admin User Impersonation API endpoints
Allows privileged users to impersonate accounts for support/debugging
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import secrets
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    AUTHENTICATED_ACTOR_STATE_KEY,
    require_authenticated_user,
    ClerkUserContext,
)
from app.core.impersonation_store import (
    get_impersonation_session as get_impersonation_session_record,
    list_impersonation_sessions_for_admin,
    put_impersonation_session,
    remove_impersonation_session,
)
from app.models.user import AdminPermission, UserRole
from app.models.admin import (
    AuditAction,
    ImpersonationSession,
    ImpersonationStartRequest,
    ImpersonationResponse,
)
from app.api.v1.admin.audit_utils import log_admin_action as _log_admin_action

logger = structlog.get_logger()
router = APIRouter()


def _can_impersonate_any_user(current_user: ClerkUserContext) -> bool:
    return current_user.has_admin_permission(AdminPermission.FULL_ACCESS)


def _get_requester_clerk_id(request: Request, current_user: ClerkUserContext) -> str:
    requester_clerk_id = getattr(request.state, AUTHENTICATED_ACTOR_STATE_KEY, None)
    if not isinstance(requester_clerk_id, str) or not requester_clerk_id.strip():
        return current_user.clerk_id
    return requester_clerk_id


def _assert_impersonation_start_allowed(
    *,
    current_user: ClerkUserContext,
    target_user: dict,
    target_role: UserRole,
) -> None:
    if _can_impersonate_any_user(current_user):
        return

    if current_user.role == UserRole.TUTOR:
        if target_role != UserRole.STUDENT:
            raise HTTPException(
                status_code=403,
                detail="Tutors can only view as students",
            )

        target_tutor_id = str(target_user.get("tutor_id") or "").strip()
        if target_tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="You can only view as your own students",
            )
        return

    raise HTTPException(
        status_code=403,
        detail="You do not have permission to start impersonation sessions",
    )


def get_active_impersonation_session(session_id: str) -> Optional[ImpersonationSession]:
    """Compatibility helper used by auth layer."""
    return get_impersonation_session_record(session_id)


@router.post("/start", response_model=ImpersonationResponse)
async def start_impersonation(
    payload: ImpersonationStartRequest,
    request: Request,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Start impersonating a user."""
    try:
        requester_clerk_id = _get_requester_clerk_id(request, current_user)

        target_user = None
        target_collection = None

        # Search for user across all collections
        for collection_name in ["tutors", "students", "parents"]:
            collection = database[collection_name]
            # Try clerk_id first
            user = await collection.find_one({"clerk_id": payload.target_user_id})
            if not user:
                try:
                    user = await collection.find_one(
                        {"_id": ObjectId(payload.target_user_id)}
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
        if target_user.get("clerk_id") == requester_clerk_id:
            raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

        default_role = target_collection[:-1] if target_collection else ""
        target_role_value = str(target_user.get("role", default_role)).strip().lower()
        try:
            target_role = UserRole(target_role_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Target user has invalid role")

        _assert_impersonation_start_allowed(
            current_user=current_user,
            target_user=target_user,
            target_role=target_role,
        )

        # Create impersonation session
        session_id = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        admin_email = current_user.email or ""

        session = ImpersonationSession(
            session_id=session_id,
            admin_clerk_id=requester_clerk_id,
            admin_email=admin_email,
            target_user_id=str(target_user["_id"]),
            target_clerk_id=target_user.get("clerk_id", ""),
            target_email=target_user.get("email", ""),
            target_name=target_user.get("name", "Unknown"),
            target_role=target_role.value,
            target_tutor_id=target_user.get("tutor_id"),
            expires_at=expires_at,
        )

        put_impersonation_session(session)

        # Log the impersonation start
        await _log_admin_action(
            database,
            requester_clerk_id,
            admin_email,
            AuditAction.IMPERSONATION_STARTED,
            "user",
            target_user.get("clerk_id"),
            {
                "target_email": target_user.get("email"),
                "target_role": target_role.value,
                "session_id": session_id,
                "actor_role": current_user.role.value,
            },
        )

        logger.info(
            "Impersonation started",
            admin_clerk_id=requester_clerk_id,
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
                "role": target_role.value,
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
    request: Request,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
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
        requester_clerk_id = _get_requester_clerk_id(request, current_user)
        if session.admin_clerk_id != requester_clerk_id:
            raise HTTPException(
                status_code=403, detail="Not authorized to end this session"
            )

        # Remove the session
        remove_impersonation_session(session_id)

        # Log the impersonation end
        await _log_admin_action(
            database,
            requester_clerk_id,
            session.admin_email,
            AuditAction.IMPERSONATION_ENDED,
            "user",
            session.target_clerk_id,
            {
                "target_email": session.target_email,
                "session_id": session_id,
                "actor_role": current_user.role.value,
                "duration_minutes": int(
                    (datetime.now(timezone.utc) - session.started_at).total_seconds()
                    / 60
                ),
            },
        )

        logger.info(
            "Impersonation ended",
            admin_clerk_id=requester_clerk_id,
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
    request: Request,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
):
    """Get details of an active impersonation session"""
    session = get_impersonation_session_record(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Impersonation session not found")

    # Verify the session belongs to this admin
    requester_clerk_id = _get_requester_clerk_id(request, current_user)
    if session.admin_clerk_id != requester_clerk_id:
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
    request: Request,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
):
    """Get all active impersonation sessions for the current admin"""
    now = datetime.now(timezone.utc)
    sessions = []

    requester_clerk_id = _get_requester_clerk_id(request, current_user)

    for session in list_impersonation_sessions_for_admin(requester_clerk_id):
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
