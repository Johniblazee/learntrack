from fastapi import APIRouter, Depends, HTTPException, status, Query, Path
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import List
from pydantic import BaseModel
from datetime import datetime, timezone

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.services.user_service import UserService
from app.models.user import User, UserRole
import structlog

logger = structlog.get_logger()

router = APIRouter()


class UpdateParentStudentsRequest(BaseModel):
    """Request model for updating parent's linked students"""

    student_ids: List[str]


class ParentListResponse(BaseModel):
    """Response model for listing parents"""

    parents: List[User]
    total: int


@router.get("/", response_model=ParentListResponse)
async def list_parents_for_tutor(
    limit: int = Query(200, ge=1, le=500),
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get all parents assigned to the currently authenticated tutor.
    """
    try:
        user_service = UserService(db)

        # Get all parents for this tutor from parents collection
        cursor = db.parents.find(
            {"tutor_id": current_user.clerk_id, "is_active": {"$ne": False}}
        ).limit(limit)

        parents = []
        async for parent in cursor:
            parents.append(User(**parent))

        logger.info(
            "Retrieved parents for tutor",
            tutor_id=current_user.clerk_id,
            count=len(parents),
        )

        return ParentListResponse(parents=parents, total=len(parents))
    except Exception as e:
        logger.error("Failed to list parents for tutor", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve parents")


@router.get("/{parent_clerk_id}", response_model=User)
async def get_parent(
    parent_clerk_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get a specific parent, ensuring they belong to the current tutor.
    """
    try:
        user_service = UserService(db)
        parent = await user_service.get_user_by_clerk_id(parent_clerk_id)

        if not parent or parent.role != UserRole.PARENT:
            raise HTTPException(status_code=404, detail="Parent not found")

        # Security Check: Ensure the parent belongs to the requesting tutor
        if parent.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Parent does not belong to this tutor.",
            )

        return parent
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get parent", parent_clerk_id=parent_clerk_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve parent")


@router.put("/{parent_clerk_id}/students", response_model=User)
async def update_parent_students(
    parent_clerk_id: str,
    payload: UpdateParentStudentsRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Update the list of students linked to a parent.
    This replaces the entire list of linked students.
    """
    try:
        user_service = UserService(db)

        # Verify parent exists and belongs to tutor
        parent = await user_service.get_user_by_clerk_id(parent_clerk_id)
        if not parent or parent.role != UserRole.PARENT:
            raise HTTPException(status_code=404, detail="Parent not found")

        if parent.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Parent does not belong to this tutor.",
            )

        # Verify all students belong to the tutor
        for student_id in payload.student_ids:
            student = await user_service.get_user_by_clerk_id(student_id)
            if not student or student.role != UserRole.STUDENT:
                raise HTTPException(
                    status_code=400, detail=f"Student {student_id} not found"
                )
            if student.tutor_id != current_user.clerk_id:
                raise HTTPException(
                    status_code=403,
                    detail=f"Student {student_id} does not belong to this tutor",
                )

        # Update parent's student_ids in parents collection
        result = await db.parents.update_one(
            {"clerk_id": parent_clerk_id},
            {
                "$set": {
                    "student_ids": payload.student_ids,
                    "parent_children": payload.student_ids,  # Keep both fields in sync
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Parent not found")

        # Return updated parent
        updated_parent = await user_service.get_user_by_clerk_id(parent_clerk_id)
        logger.info(
            "Updated parent students",
            parent_id=parent_clerk_id,
            student_count=len(payload.student_ids),
        )

        return updated_parent
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to update parent students",
            parent_clerk_id=parent_clerk_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to update parent students")


@router.delete("/{parent_clerk_id}/students/{student_clerk_id}")
async def unlink_student_from_parent(
    parent_clerk_id: str,
    student_clerk_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Remove a student from a parent's linked students list.
    """
    try:
        user_service = UserService(db)

        # Verify parent exists and belongs to tutor
        parent = await user_service.get_user_by_clerk_id(parent_clerk_id)
        if not parent or parent.role != UserRole.PARENT:
            raise HTTPException(status_code=404, detail="Parent not found")

        if parent.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Parent does not belong to this tutor.",
            )

        # Verify student exists and belongs to tutor
        student = await user_service.get_user_by_clerk_id(student_clerk_id)
        if not student or student.role != UserRole.STUDENT:
            raise HTTPException(status_code=404, detail="Student not found")

        if student.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403, detail="Student does not belong to this tutor"
            )

        # Remove student from parent's lists in parents collection
        result = await db.parents.update_one(
            {"clerk_id": parent_clerk_id},
            {
                "$pull": {
                    "student_ids": student_clerk_id,
                    "parent_children": student_clerk_id,
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Parent not found")

        logger.info(
            "Unlinked student from parent",
            parent_id=parent_clerk_id,
            student_id=student_clerk_id,
        )

        return {"message": "Student unlinked successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to unlink student from parent",
            parent_clerk_id=parent_clerk_id,
            student_clerk_id=student_clerk_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to unlink student")


@router.post("/{parent_clerk_id}/students/{student_clerk_id}")
async def link_student_to_parent(
    parent_clerk_id: str,
    student_clerk_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Add a student to a parent's linked students list.
    """
    try:
        user_service = UserService(db)

        # Verify parent exists and belongs to tutor
        parent = await user_service.get_user_by_clerk_id(parent_clerk_id)
        if not parent or parent.role != UserRole.PARENT:
            raise HTTPException(status_code=404, detail="Parent not found")

        if parent.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Parent does not belong to this tutor.",
            )

        # Verify student exists and belongs to tutor
        student = await user_service.get_user_by_clerk_id(student_clerk_id)
        if not student or student.role != UserRole.STUDENT:
            raise HTTPException(status_code=404, detail="Student not found")

        if student.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403, detail="Student does not belong to this tutor"
            )

        # Add student to parent's lists in parents collection
        result = await db.parents.update_one(
            {"clerk_id": parent_clerk_id},
            {
                "$addToSet": {
                    "student_ids": student_clerk_id,
                    "parent_children": student_clerk_id,
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Parent not found")

        logger.info(
            "Linked student to parent",
            parent_id=parent_clerk_id,
            student_id=student_clerk_id,
        )

        return {"message": "Student linked successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to link student to parent",
            parent_clerk_id=parent_clerk_id,
            student_clerk_id=student_clerk_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to link student")
