from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from typing import Any, Dict

from app.core.database import get_database
from app.core.enhanced_auth import require_authenticated_user, ClerkUserContext
from app.services.user_service import UserService
from app.models.user import User, UserRole, UserCreate, UserUpdate
from app.core.config import settings

logger = structlog.get_logger()
router = APIRouter()


def _serialize_user_for_response(user: Any) -> Dict[str, Any]:
    name_value = user.name or ""

    profile = None
    if getattr(user, "student_profile", None):
        try:
            profile = user.student_profile.model_dump()
        except Exception:
            profile = user.student_profile

    return {
        "id": str(user.id),
        "clerk_id": user.clerk_id,
        "email": user.email,
        "name": name_value,
        "first_name": name_value.split()[0] if name_value else "",
        "last_name": " ".join(name_value.split()[1:])
        if len(name_value.split()) > 1
        else "",
        "role": user.role.value if hasattr(user.role, "value") else user.role,
        "tutor_id": user.tutor_id,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "student_profile": profile,
        "is_super_admin": user.is_super_admin,
        "admin_permissions": [
            permission.value if hasattr(permission, "value") else permission
            for permission in (user.admin_permissions or [])
        ],
    }


@router.get("/me")
async def read_users_me(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get current authenticated user profile from Clerk JWT token"""
    try:
        # Try to get user from database first
        user_service = UserService(db)
        db_user = await user_service.get_user_by_clerk_id(current_user.clerk_id)

        if db_user:
            # Return user data from database
            return _serialize_user_for_response(db_user)
        else:
            # Return user data from Clerk JWT token if not in database yet
            logger.warning(
                "User not found in database, returning JWT data",
                clerk_id=current_user.clerk_id,
            )
            jwt_name = current_user.name or ""
            jwt_name_parts = jwt_name.split() if isinstance(jwt_name, str) else []
            return {
                "id": current_user.clerk_id,
                "clerk_id": current_user.clerk_id,
                "email": current_user.email,
                "name": jwt_name,
                "first_name": jwt_name_parts[0] if jwt_name_parts else "",
                "last_name": " ".join(jwt_name_parts[1:])
                if len(jwt_name_parts) > 1
                else "",
                "role": current_user.role.value,
                "tutor_id": current_user.tutor_id,
                "created_at": current_user.created_at.isoformat()
                if current_user.created_at
                else None,
                "last_sign_in": current_user.last_sign_in.isoformat()
                if current_user.last_sign_in
                else None,
                "student_profile": None,
                # Super admin fields (from JWT context)
                "is_super_admin": current_user.is_super_admin,
                "admin_permissions": [
                    p.value if hasattr(p, "value") else p
                    for p in current_user.admin_permissions
                ]
                if current_user.admin_permissions
                else [],
            }
    except Exception as e:
        logger.error(
            "Failed to get user profile", error=str(e), clerk_id=current_user.clerk_id
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve user profile")


@router.put("/me")
async def update_users_me(
    payload: UserUpdate,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update current authenticated user profile."""
    try:
        user_service = UserService(db)
        db_user = await user_service.get_user_by_clerk_id(current_user.clerk_id)

        if not db_user:
            user_create = UserCreate(
                clerk_id=current_user.clerk_id,
                email=str(current_user.email)
                if current_user.email
                else f"{current_user.clerk_id}@learntrack.local",
                name=str(current_user.name) if current_user.name else "User",
                role=current_user.role,
                tutor_id=current_user.clerk_id
                if current_user.role == UserRole.TUTOR
                else current_user.tutor_id,
                tenant_id=current_user.tutor_id,
            )
            db_user = await user_service.create_user(user_create)

        payload_data = payload.model_dump(exclude_unset=True)
        if not payload_data:
            return _serialize_user_for_response(db_user)

        updated_user = await user_service.update_user(str(db_user.id), payload)

        logger.info("User profile updated", clerk_id=current_user.clerk_id)
        return _serialize_user_for_response(updated_user)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to update user profile",
            error=str(e),
            clerk_id=current_user.clerk_id,
        )
        raise HTTPException(status_code=500, detail="Failed to update user profile")


@router.put("/me/role")
async def update_user_role(
    role_data: dict,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update current user's role in the database"""
    try:
        # Validate role
        role_str = role_data.get("role", "").lower()
        if role_str not in ["tutor", "student", "parent"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid role. Must be 'tutor', 'student', or 'parent'",
            )

        role = UserRole(role_str)
        user_service = UserService(db)

        # Get or create user in database
        db_user = await user_service.get_user_by_clerk_id(current_user.clerk_id)

        if db_user:
            # Update existing user's role
            updated_user = await user_service.update_user_role(
                current_user.clerk_id, role
            )
            if not updated_user:
                raise HTTPException(status_code=404, detail="User not found")
        else:
            # Create new user with role
            from app.models.user import UserCreate

            user_create = UserCreate(
                clerk_id=current_user.clerk_id,
                email=str(current_user.email)
                if current_user.email
                else f"{current_user.clerk_id}@learntrack.local",
                name=str(current_user.name) if current_user.name else "User",
                role=role,
                tutor_id=current_user.clerk_id if role == UserRole.TUTOR else None,
            )
            updated_user = await user_service.create_user(user_create)

        logger.info(
            "User role updated", clerk_id=current_user.clerk_id, new_role=role_str
        )

        return {
            "id": str(updated_user.id),
            "clerk_id": updated_user.clerk_id,
            "email": updated_user.email,
            "name": updated_user.name,
            "role": updated_user.role.value,
            "tutor_id": updated_user.tutor_id,
            "message": f"Role updated to {role_str}",
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to update user role", error=str(e), clerk_id=current_user.clerk_id
        )
        raise HTTPException(status_code=500, detail="Failed to update user role")


@router.get("/{clerk_id}", response_model=User)
async def get_user_by_id(
    clerk_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get user details by Clerk ID.

    Security:
    - Tutors can view any user in their tenant (students, parents)
    - Students can view themselves and their parents
    - Parents can view themselves and their children
    """
    try:
        user_service = UserService(db)

        # Get the requested user
        requested_user = await user_service.get_user_by_clerk_id(clerk_id)

        if not requested_user:
            raise HTTPException(status_code=404, detail="User not found")

        # Security check: Verify access permissions
        # Allow if:
        # 1. User is viewing themselves
        # 2. User is a tutor viewing someone in their tenant
        # 3. User is a student viewing their parent
        # 4. User is a parent viewing their child

        if clerk_id == current_user.clerk_id:
            # User viewing themselves - always allowed
            pass
        elif current_user.role == UserRole.TUTOR:
            # Tutors can view any user in their tenant
            if requested_user.tutor_id != current_user.clerk_id:
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: User does not belong to your tenant",
                )
        elif current_user.role == UserRole.STUDENT:
            # Students can view their parents
            # Check if requested user is a parent and current user is in their children list
            if requested_user.role != UserRole.PARENT:
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: Students can only view their parents",
                )
            if current_user.clerk_id not in (requested_user.parent_children or []):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: This parent is not linked to you",
                )
        elif current_user.role == UserRole.PARENT:
            # Parents can view their children
            if requested_user.role != UserRole.STUDENT:
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: Parents can only view their children",
                )
            if clerk_id not in (current_user.student_ids or []):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: This student is not your child",
                )
        else:
            raise HTTPException(status_code=403, detail="Access forbidden")

        logger.info(
            "User details retrieved",
            requested_clerk_id=clerk_id,
            requester_clerk_id=current_user.clerk_id,
        )

        return requested_user

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get user details", error=str(e), clerk_id=clerk_id)
        raise HTTPException(status_code=500, detail="Failed to retrieve user details")
