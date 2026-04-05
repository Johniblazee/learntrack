"""
Visibility and access control endpoints
"""
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_authenticated_user, ClerkUserContext
from app.services.visibility_service import VisibilityService


class VisibleUserDetail(BaseModel):
    user_id: str
    name: str
    role: str

logger = structlog.get_logger()
router = APIRouter()


@router.get("/visible-users", response_model=List[str])
async def get_visible_users(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Get list of user IDs visible to the current user based on their role.
    
    - Students see: their teacher + their parents
    - Parents see: their children + their children's teacher
    - Tutors see: all their students + all parents of their students
    """
    try:
        visibility_service = VisibilityService(database)
        
        if current_user.role.value == "student":
            visible_users = await visibility_service.get_visible_users_for_student(current_user.clerk_id)
        elif current_user.role.value == "parent":
            visible_users = await visibility_service.get_visible_users_for_parent(current_user.clerk_id)
        elif current_user.role.value == "tutor":
            visible_users = await visibility_service.get_visible_users_for_tutor(current_user.clerk_id)
        else:
            visible_users = []
        
        return visible_users
        
    except Exception as e:
        logger.error("Failed to get visible users", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get visible users")


@router.get("/visible-users-detailed", response_model=List[VisibleUserDetail])
async def get_visible_users_detailed(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get visible users with name and role details for the contact picker.
    Returns [{user_id, name, role}] for each user visible to the caller.
    """
    try:
        visibility_service = VisibilityService(database)

        if current_user.role.value == "student":
            visible_ids = await visibility_service.get_visible_users_for_student(current_user.clerk_id)
        elif current_user.role.value == "parent":
            visible_ids = await visibility_service.get_visible_users_for_parent(current_user.clerk_id)
        elif current_user.role.value == "tutor":
            visible_ids = await visibility_service.get_visible_users_for_tutor(current_user.clerk_id)
        else:
            visible_ids = []

        if not visible_ids:
            return []

        results: List[VisibleUserDetail] = []

        # Look up each user across the role-specific collections
        for collection_name, role_label in [("tutors", "tutor"), ("students", "student"), ("parents", "parent")]:
            collection = database[collection_name]
            docs = await collection.find(
                {"clerk_id": {"$in": visible_ids}},
                {"clerk_id": 1, "name": 1, "display_name": 1, "_id": 0},
            ).to_list(length=None)
            for doc in docs:
                name = doc.get("display_name") or doc.get("name") or "Unknown"
                results.append(VisibleUserDetail(user_id=doc["clerk_id"], name=name, role=role_label))

        return results

    except Exception as e:
        logger.error("Failed to get visible users detailed", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get visible users")


@router.get("/visible-students")
async def get_visible_students(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Get list of students visible to the current user with full details.
    
    - Tutors see: all their students
    - Parents see: only their children
    - Students see: empty list (students don't see other students)
    """
    try:
        visibility_service = VisibilityService(database)
        students = await visibility_service.get_visible_students_for_user(
            current_user.clerk_id,
            current_user.role
        )
        
        # Convert ObjectId to string
        for student in students:
            student["_id"] = str(student["_id"])
        
        return students
        
    except Exception as e:
        logger.error("Failed to get visible students", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get visible students")


@router.get("/can-see-user/{target_user_id}", response_model=bool)
async def can_see_user(
    target_user_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Check if current user can see a specific target user.
    Returns true if visible, false otherwise.
    """
    try:
        visibility_service = VisibilityService(database)
        can_see = await visibility_service.can_user_see_user(
            current_user.clerk_id,
            target_user_id,
            current_user.role
        )
        
        return can_see
        
    except Exception as e:
        logger.error("Failed to check user visibility", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to check visibility")


@router.get("/can-access-conversation/{conversation_id}", response_model=bool)
async def can_access_conversation(
    conversation_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Check if current user can access a specific conversation.
    Returns true if user is a participant and all participants are visible to user.
    """
    try:
        visibility_service = VisibilityService(database)
        can_access = await visibility_service.can_user_access_conversation(
            current_user.clerk_id,
            conversation_id,
            current_user.role
        )
        
        return can_access
        
    except Exception as e:
        logger.error("Failed to check conversation access", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to check conversation access")

