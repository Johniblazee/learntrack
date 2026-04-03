"""
Assignment management endpoints
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Path, Query, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from pydantic import BaseModel

from app.core.database import get_database
from app.core.dependencies import get_assignment_service
from app.core.exceptions import AuthorizationError, NotFoundError, ValidationError
from app.core.enhanced_auth import (
    require_tutor,
    require_authenticated_user,
    ClerkUserContext,
)
from app.models.assignment import (
    Assignment,
    AssignmentCreate,
    AssignmentForStudent,
    AssignmentStatus,
    AssignmentUpdate,
)
from app.services.assignment_service import AssignmentService
from app.services.user_service import UserService
from app.utils.pagination import PaginationParams, PaginatedResponse, paginate

logger = structlog.get_logger()
router = APIRouter()


class BulkAssignmentActionRequest(BaseModel):
    assignment_ids: List[str]


class BulkAssignmentStatusRequest(BulkAssignmentActionRequest):
    status: str


@router.post("/", response_model=Assignment)
async def create_assignment(
    assignment_data: AssignmentCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Create a new assignment (tutor only)"""
    try:
        assignment = await assignment_service.create_assignment(
            assignment_data, current_user.clerk_id
        )
        return assignment
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("Failed to create assignment", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create assignment")


@router.get("/", response_model=PaginatedResponse[Assignment])
async def get_assignments(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Get paginated assignments for current user (tutor only)"""
    try:
        result = await assignment_service.get_assignments_for_tutor(
            tutor_id=current_user.clerk_id,
            subject_id=subject_id,
            status=status,
            page=page,
            per_page=per_page,
        )
        return paginate(
            items=result["items"], page=page, per_page=per_page, total=result["total"]
        )
    except Exception as e:
        logger.error("Failed to get assignments", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get assignments")


@router.get("/student/me", response_model=PaginatedResponse[AssignmentForStudent])
async def get_my_assignments(
    status: Optional[str] = Query(
        None, description="Filter by status (pending, completed, etc.)"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Get paginated assignments for currently authenticated student"""
    try:
        if current_user.role.value != "student":
            return paginate(items=[], page=page, per_page=per_page, total=0)

        result = await assignment_service.get_student_assignment_summaries(
            student_id=current_user.clerk_id,
            tutor_id=current_user.tutor_id or current_user.clerk_id,
            status=status,
            page=page,
            per_page=per_page,
        )

        return paginate(
            items=result["items"],
            page=page,
            per_page=per_page,
            total=result["total"],
        )
    except Exception as e:
        logger.error("Failed to get current student assignments", error=str(e))
        raise HTTPException(
            status_code=500, detail="Failed to get current student assignments"
        )


@router.get("/student/{student_id}", response_model=PaginatedResponse[Assignment])
async def get_student_assignments(
    student_id: str = Path(..., description="Student ID"),
    status: Optional[str] = Query(
        None, description="Filter by status (pending, completed, etc.)"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Get paginated assignments for a specific student"""
    try:
        # Create pagination params
        pagination = PaginationParams(page=page, per_page=per_page)

        # Get total count
        total = await assignment_service.get_student_assignments_count(
            student_id=student_id, tutor_id=current_user.tutor_id, status=status
        )

        # Get paginated assignments
        assignments = await assignment_service.get_student_assignments_paginated(
            student_id=student_id,
            tutor_id=current_user.tutor_id,
            status=status,
            skip=pagination.skip,
            limit=pagination.limit,
        )

        # Return paginated response
        return paginate(items=assignments, page=page, per_page=per_page, total=total)
    except Exception as e:
        logger.error("Failed to get student assignments", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get student assignments")


@router.post("/bulk-status", response_model=dict)
async def bulk_update_assignment_status(
    payload: BulkAssignmentStatusRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Update status for multiple tutor assignments."""
    try:
        status_value = AssignmentStatus(payload.status)
        return await assignment_service.bulk_update_status(
            payload.assignment_ids,
            current_user.clerk_id,
            status_value,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid assignment status")
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk update assignment status", error=str(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to bulk update assignment status",
        )


@router.post("/bulk-delete", response_model=dict)
async def bulk_delete_assignments(
    payload: BulkAssignmentActionRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Delete multiple tutor assignments."""
    try:
        return await assignment_service.bulk_delete_assignments(
            payload.assignment_ids,
            current_user.clerk_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk delete assignments", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to bulk delete assignments")


@router.get("/{assignment_id}", response_model=Assignment)
async def get_assignment(
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Get assignment by ID"""
    try:
        # For tutors, validate ownership. For students, they can view if assigned.
        tutor_id = current_user.clerk_id if current_user.role == "tutor" else None
        assignment = await assignment_service.get_assignment_by_id(
            assignment_id, tutor_id=tutor_id
        )

        # For students, verify they are assigned to this assignment
        if current_user.role == "student" and current_user.clerk_id not in (
            assignment.student_ids or []
        ):
            raise HTTPException(
                status_code=403, detail="Not authorized to view this assignment"
            )

        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return assignment
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get assignment", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get assignment")


@router.put("/{assignment_id}", response_model=Assignment)
async def update_assignment(
    assignment_update: AssignmentUpdate,
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Update assignment"""
    try:
        assignment = await assignment_service.update_assignment(
            assignment_id, assignment_update, current_user.clerk_id
        )
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return assignment
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update assignment", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update assignment")


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Delete assignment"""
    try:
        success = await assignment_service.delete_assignment(
            assignment_id, current_user.clerk_id
        )
        if not success:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return {"message": "Assignment deleted successfully"}
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete assignment", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to delete assignment")


@router.post("/{assignment_id}/assign-to-group", response_model=Assignment)
async def assign_to_group(
    assignment_id: str = Path(..., description="Assignment ID"),
    group_id: str = Query(..., description="Group ID to assign to"),
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Assign an assignment to a student group"""
    try:
        assignment = await assignment_service.assign_to_group(
            assignment_id, group_id, current_user.clerk_id
        )
        return assignment
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to assign to group",
            assignment_id=assignment_id,
            group_id=group_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{assignment_id}/group-performance/{group_id}")
async def get_group_performance(
    assignment_id: str = Path(..., description="Assignment ID"),
    group_id: str = Path(..., description="Group ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    assignment_service: AssignmentService = Depends(get_assignment_service),
):
    """Get performance statistics for a specific group on an assignment"""
    try:
        performance = await assignment_service.get_group_performance(
            assignment_id, group_id, current_user.clerk_id
        )
        return performance
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get group performance",
            assignment_id=assignment_id,
            group_id=group_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))
