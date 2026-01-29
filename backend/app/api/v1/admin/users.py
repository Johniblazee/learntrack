"""
Admin User Management API endpoints
Provides cross-tenant user management for super admins
"""
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, EmailStr
from bson import ObjectId
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_super_admin, ClerkUserContext, require_admin_permission
from app.core.utils import escape_regex
from app.models.user import UserRole, AdminPermission
from app.models.admin import (
    AuditAction, BatchUserOperationRequest, BatchOperationType,
    BatchOperationResponse, BatchOperationResult
)

logger = structlog.get_logger()
router = APIRouter()


class AdminUserInfo(BaseModel):
    """User info for admin view"""
    id: str
    clerk_id: str
    email: str
    name: str
    role: UserRole
    tutor_id: Optional[str] = None
    is_active: bool = True
    is_super_admin: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_login: Optional[datetime] = None


class AdminUserListResponse(BaseModel):
    """Response for user list endpoint"""
    users: List[AdminUserInfo]
    total: int
    page: int
    per_page: int
    total_pages: int


class CreateTutorRequest(BaseModel):
    """Request to create a new tutor"""
    email: EmailStr
    name: str
    clerk_id: str
    is_super_admin: bool = False
    admin_permissions: List[str] = []


class UpdateUserRequest(BaseModel):
    """Request to update a user"""
    name: Optional[str] = None
    is_active: Optional[bool] = None
    is_super_admin: Optional[bool] = None
    admin_permissions: Optional[List[str]] = None


async def _log_admin_action(database, admin_id, admin_email, action, target_type, target_id=None, details=None):
    """Log admin action for audit trail"""
    try:
        await database.admin_audit_logs.insert_one({
            "admin_id": admin_id,
            "admin_email": admin_email,
            "action": action.value if hasattr(action, 'value') else action,
            "target_type": target_type,
            "target_id": target_id,
            "details": details or {},
            "timestamp": datetime.now(timezone.utc)
        })
    except Exception as e:
        logger.warning("Failed to log admin action", error=str(e))


@router.get("/", response_model=AdminUserListResponse)
async def list_all_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    role_filter: Optional[UserRole] = Query(None),
    tenant_id: Optional[str] = Query(None, description="Filter by tenant (tutor) ID"),
    search: Optional[str] = Query(None, description="Search by name or email"),
    current_user: ClerkUserContext = Depends(require_admin_permission(AdminPermission.VIEW_ALL_USERS)),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """List all users across all tenants"""
    try:
        skip = (page - 1) * per_page
        all_users = []
        
        # Define collections to search based on role filter
        collections_to_search = []
        if role_filter:
            if role_filter == UserRole.TUTOR or role_filter == UserRole.SUPER_ADMIN:
                collections_to_search = [("tutors", UserRole.TUTOR)]
            elif role_filter == UserRole.STUDENT:
                collections_to_search = [("students", UserRole.STUDENT)]
            elif role_filter == UserRole.PARENT:
                collections_to_search = [("parents", UserRole.PARENT)]
        else:
            collections_to_search = [
                ("tutors", UserRole.TUTOR),
                ("students", UserRole.STUDENT),
                ("parents", UserRole.PARENT)
            ]
        
        # Build query
        query = {}
        if tenant_id:
            query["tutor_id"] = tenant_id
        if search:
            query["$or"] = [
                {"name": {"$regex": escape_regex(search), "$options": "i"}},
                {"email": {"$regex": escape_regex(search), "$options": "i"}}
            ]
        
        # Collect users from all relevant collections
        for collection_name, role in collections_to_search:
            collection = database[collection_name]
            cursor = collection.find(query)
            users = await cursor.to_list(length=1000)  # Get all for counting
            
            for user in users:
                user_info = AdminUserInfo(
                    id=str(user["_id"]),
                    clerk_id=user.get("clerk_id", ""),
                    email=user.get("email", ""),
                    name=user.get("name", "Unknown"),
                    role=UserRole(user.get("role", role.value)),
                    tutor_id=user.get("tutor_id"),
                    is_active=user.get("is_active", True),
                    is_super_admin=user.get("is_super_admin", False),
                    created_at=user.get("created_at", datetime.now(timezone.utc)),
                    updated_at=user.get("updated_at"),
                    last_login=user.get("last_login")
                )
                all_users.append(user_info)
        
        # Sort by created_at descending
        all_users.sort(key=lambda x: x.created_at, reverse=True)
        
        # Apply pagination
        total = len(all_users)
        paginated_users = all_users[skip:skip + per_page]
        total_pages = (total + per_page - 1) // per_page
        
        return AdminUserListResponse(
            users=paginated_users,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages
        )
    except Exception as e:
        logger.error("Failed to list users", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to list users: {str(e)}")


@router.get("/{user_id}", response_model=AdminUserInfo)
async def get_user_details(
    user_id: str,
    current_user: ClerkUserContext = Depends(require_admin_permission(AdminPermission.VIEW_ALL_USERS)),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Get detailed information about any user"""
    try:
        # Search across all collections
        for collection_name in ["tutors", "students", "parents"]:
            collection = database[collection_name]

            # Try clerk_id first, then _id
            user = await collection.find_one({"clerk_id": user_id})
            if not user:
                try:
                    user = await collection.find_one({"_id": ObjectId(user_id)})
                except Exception:
                    pass

            if user:
                await _log_admin_action(
                    database, current_user.clerk_id, current_user.email,
                    AuditAction.USER_VIEWED, "user", user_id
                )

                return AdminUserInfo(
                    id=str(user["_id"]),
                    clerk_id=user.get("clerk_id", ""),
                    email=user.get("email", ""),
                    name=user.get("name", "Unknown"),
                    role=UserRole(user.get("role", "tutor")),
                    tutor_id=user.get("tutor_id"),
                    is_active=user.get("is_active", True),
                    is_super_admin=user.get("is_super_admin", False),
                    created_at=user.get("created_at", datetime.now(timezone.utc)),
                    updated_at=user.get("updated_at"),
                    last_login=user.get("last_login")
                )

        raise HTTPException(status_code=404, detail="User not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get user details", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get user: {str(e)}")


@router.post("/tutors", response_model=AdminUserInfo)
async def create_tutor(
    request: CreateTutorRequest,
    current_user: ClerkUserContext = Depends(require_admin_permission(AdminPermission.CREATE_TUTORS)),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Create a new tutor account (admin only)"""
    try:
        # Check if user already exists
        existing = await database.tutors.find_one({"$or": [
            {"clerk_id": request.clerk_id},
            {"email": request.email}
        ]})

        if existing:
            raise HTTPException(status_code=400, detail="User with this email or clerk_id already exists")

        # Create tutor
        now = datetime.now(timezone.utc)
        tutor_doc = {
            "clerk_id": request.clerk_id,
            "email": request.email,
            "name": request.name,
            "role": UserRole.TUTOR.value,
            "tutor_id": request.clerk_id,
            "is_active": True,
            "is_super_admin": request.is_super_admin,
            "admin_permissions": request.admin_permissions,
            "status": "active",
            "created_at": now,
            "updated_at": now
        }

        result = await database.tutors.insert_one(tutor_doc)
        tutor_doc["_id"] = result.inserted_id

        await _log_admin_action(
            database, current_user.clerk_id, current_user.email,
            AuditAction.USER_CREATED, "tutor", request.clerk_id,
            {"email": request.email, "is_super_admin": request.is_super_admin}
        )

        logger.info("Tutor created by admin", tutor_email=request.email, admin=current_user.email)

        return AdminUserInfo(
            id=str(tutor_doc["_id"]),
            clerk_id=request.clerk_id,
            email=request.email,
            name=request.name,
            role=UserRole.TUTOR,
            tutor_id=request.clerk_id,
            is_active=True,
            is_super_admin=request.is_super_admin,
            created_at=now,
            updated_at=now
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create tutor", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to create tutor: {str(e)}")


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    request: UpdateUserRequest,
    current_user: ClerkUserContext = Depends(require_admin_permission(AdminPermission.MANAGE_USERS)),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Update any user's details (admin only)"""
    try:
        update_data = {"updated_at": datetime.now(timezone.utc)}

        if request.name is not None:
            update_data["name"] = request.name
        if request.is_active is not None:
            update_data["is_active"] = request.is_active
        if request.is_super_admin is not None:
            update_data["is_super_admin"] = request.is_super_admin
        if request.admin_permissions is not None:
            update_data["admin_permissions"] = request.admin_permissions

        # Search and update across all collections
        for collection_name in ["tutors", "students", "parents"]:
            collection = database[collection_name]
            result = await collection.update_one(
                {"clerk_id": user_id},
                {"$set": update_data}
            )

            if result.matched_count > 0:
                await _log_admin_action(
                    database, current_user.clerk_id, current_user.email,
                    AuditAction.USER_UPDATED, "user", user_id,
                    {"updates": list(update_data.keys())}
                )
                return {"status": "updated", "user_id": user_id}

        raise HTTPException(status_code=404, detail="User not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update user", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")


@router.post("/batch", response_model=BatchOperationResponse)
async def batch_user_operations(
    request: BatchUserOperationRequest,
    current_user: ClerkUserContext = Depends(require_admin_permission(AdminPermission.MANAGE_USERS)),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Perform batch operations on multiple users.
    Supports: activate, deactivate, delete
    """
    try:
        results: List[BatchOperationResult] = []
        successful = 0
        failed = 0

        for user_id in request.user_ids:
            try:
                # Find user across all collections
                user_found = False
                user_collection = None
                user_doc = None

                for collection_name in ["tutors", "students", "parents"]:
                    collection = database[collection_name]
                    user = await collection.find_one({"clerk_id": user_id})
                    if not user:
                        try:
                            user = await collection.find_one({"_id": ObjectId(user_id)})
                        except Exception:
                            pass
                    if user:
                        user_found = True
                        user_collection = collection
                        user_doc = user
                        break

                if not user_found:
                    results.append(BatchOperationResult(id=user_id, success=False, error="User not found"))
                    failed += 1
                    continue

                # Prevent operations on super admins
                if user_doc.get("is_super_admin", False) and request.operation == BatchOperationType.DELETE:
                    results.append(BatchOperationResult(id=user_id, success=False, error="Cannot delete super admin"))
                    failed += 1
                    continue

                # Perform the operation
                if request.operation == BatchOperationType.ACTIVATE:
                    await user_collection.update_one(
                        {"_id": user_doc["_id"]},
                        {"$set": {"is_active": True, "updated_at": datetime.now(timezone.utc)}}
                    )
                elif request.operation == BatchOperationType.DEACTIVATE:
                    await user_collection.update_one(
                        {"_id": user_doc["_id"]},
                        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}}
                    )
                elif request.operation == BatchOperationType.DELETE:
                    await user_collection.delete_one({"_id": user_doc["_id"]})
                else:
                    results.append(BatchOperationResult(id=user_id, success=False, error="Invalid operation for users"))
                    failed += 1
                    continue

                results.append(BatchOperationResult(id=user_id, success=True))
                successful += 1

            except Exception as e:
                results.append(BatchOperationResult(id=user_id, success=False, error=str(e)))
                failed += 1

        # Log the batch operation
        audit_action = {
            BatchOperationType.ACTIVATE: AuditAction.BATCH_USERS_ACTIVATED,
            BatchOperationType.DEACTIVATE: AuditAction.BATCH_USERS_DEACTIVATED,
            BatchOperationType.DELETE: AuditAction.BATCH_USERS_DELETED,
        }.get(request.operation, AuditAction.USER_UPDATED)

        await _log_admin_action(
            database, current_user.clerk_id, current_user.email,
            audit_action, "users", None,
            {
                "operation": request.operation.value,
                "total_requested": len(request.user_ids),
                "successful": successful,
                "failed": failed,
                "reason": request.reason
            }
        )

        logger.info(
            "Batch user operation completed",
            operation=request.operation.value,
            successful=successful,
            failed=failed,
            admin=current_user.email
        )

        return BatchOperationResponse(
            operation=request.operation,
            total_requested=len(request.user_ids),
            successful=successful,
            failed=failed,
            results=results,
            message=f"Batch {request.operation.value} completed: {successful} successful, {failed} failed"
        )
    except Exception as e:
        logger.error("Failed to perform batch user operation", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to perform batch operation: {str(e)}")
