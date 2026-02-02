"""
Student groups endpoints with tenant isolation
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Path, Query, Body, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_tutor,
    require_authenticated_user,
    ClerkUserContext,
)
from app.models.student import StudentGroup, StudentGroupCreate, StudentGroupUpdate
from app.services.student_service import StudentService
from app.services.image_generation_service import generate_group_image

logger = structlog.get_logger()
router = APIRouter()


@router.get("/student/{student_id}", response_model=List[StudentGroup])
async def get_student_groups(
    student_id: str = Path(..., description="Student ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get all groups that a student belongs to (tenant isolated, optimized query)"""
    try:
        student_service = StudentService(database)

        # Use optimized MongoDB query instead of fetching all groups and filtering in Python
        student_groups = await student_service.get_groups_for_student(
            student_id=student_id, tutor_id=current_user.clerk_id
        )

        return student_groups
    except Exception as e:
        logger.error(
            "Failed to get student groups", error=str(e), tutor_id=current_user.clerk_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve student groups",
        )


@router.get("/", response_model=List[StudentGroup])
async def get_all_groups(
    limit: int = Query(200, description="Maximum number of groups to return"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get all student groups for the authenticated tutor"""
    try:
        student_service = StudentService(database)
        # Pass tutor_id for tenant isolation
        groups = await student_service.list_groups(
            tutor_id=current_user.clerk_id, limit=limit
        )
        return groups
    except Exception as e:
        logger.error(
            "Failed to get groups", error=str(e), tutor_id=current_user.clerk_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve groups",
        )


@router.get("/{group_id}", response_model=StudentGroup)
async def get_group(
    group_id: str = Path(..., description="Group ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get a specific group by ID (only if owned by authenticated tutor)"""
    try:
        student_service = StudentService(database)
        # Pass tutor_id for tenant isolation
        group = await student_service.get_group(
            group_id, tutor_id=current_user.clerk_id
        )
        if not group:
            raise HTTPException(
                status_code=404, detail="Group not found or access denied"
            )
        return group
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get group", error=str(e), tutor_id=current_user.clerk_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve group",
        )


@router.post("/", response_model=StudentGroup, status_code=status.HTTP_201_CREATED)
async def create_group(
    group_data: StudentGroupCreate,
    generate_image: bool = Query(
        True, description="Automatically generate a cover image"
    ),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Create a new student group (with tenant isolation)"""
    try:
        student_service = StudentService(database)

        # Generate cover image if requested and not provided
        if generate_image and not group_data.imageUrl:
            image_url = await generate_group_image(
                group_name=group_data.name, description=group_data.description
            )
            if image_url:
                # Update the group data with the generated image URL
                group_data.imageUrl = image_url
                logger.info(
                    "Generated cover image for new group",
                    group_name=group_data.name,
                    tutor_id=current_user.clerk_id,
                )

        # Pass tutor_id for tenant isolation
        group = await student_service.create_group(
            group_data, tutor_id=current_user.clerk_id
        )
        return group
    except Exception as e:
        logger.error(
            "Failed to create group", error=str(e), tutor_id=current_user.clerk_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create group",
        )


@router.post("/{group_id}/regenerate-image", response_model=StudentGroup)
async def regenerate_group_image(
    group_id: str = Path(..., description="Group ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Regenerate the cover image for a group"""
    try:
        student_service = StudentService(database)

        # Get the existing group
        group = await student_service.get_group(
            group_id, tutor_id=current_user.clerk_id
        )
        if not group:
            raise HTTPException(
                status_code=404, detail="Group not found or access denied"
            )

        # Generate new image
        image_url = await generate_group_image(
            group_name=group.name, description=group.description
        )

        if not image_url:
            raise HTTPException(status_code=500, detail="Failed to generate image")

        # Update the group with new image URL
        update_data = StudentGroupUpdate(imageUrl=image_url)
        updated_group = await student_service.update_group(
            group_id, update_data, tutor_id=current_user.clerk_id
        )

        logger.info(
            "Regenerated cover image for group",
            group_id=group_id,
            group_name=group.name,
            tutor_id=current_user.clerk_id,
        )

        return updated_group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to regenerate group image",
            error=str(e),
            group_id=group_id,
            tutor_id=current_user.clerk_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to regenerate group image",
        )


@router.delete("/{group_id}/image", response_model=StudentGroup)
async def remove_group_image(
    group_id: str = Path(..., description="Group ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Remove the cover image from a group"""
    try:
        student_service = StudentService(database)

        # Get the existing group to verify ownership
        group = await student_service.get_group(
            group_id, tutor_id=current_user.clerk_id
        )
        if not group:
            raise HTTPException(
                status_code=404, detail="Group not found or access denied"
            )

        # Update the group to remove the image URL
        update_data = StudentGroupUpdate(imageUrl=None)
        updated_group = await student_service.update_group(
            group_id, update_data, tutor_id=current_user.clerk_id
        )

        logger.info(
            "Removed cover image from group",
            group_id=group_id,
            group_name=group.name,
            tutor_id=current_user.clerk_id,
        )

        return updated_group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to remove group image",
            error=str(e),
            group_id=group_id,
            tutor_id=current_user.clerk_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove group image",
        )


@router.put("/{group_id}", response_model=StudentGroup)
async def update_group(
    group_id: str = Path(..., description="Group ID"),
    group_update: StudentGroupUpdate = Body(...),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update a student group (only if owned by authenticated tutor)"""
    try:
        student_service = StudentService(database)
        # Pass tutor_id for tenant isolation
        group = await student_service.update_group(
            group_id, group_update, tutor_id=current_user.clerk_id
        )
        if not group:
            raise HTTPException(
                status_code=404, detail="Group not found or access denied"
            )
        return group
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to update group", error=str(e), tutor_id=current_user.clerk_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update group",
        )


@router.delete("/{group_id}")
async def delete_group(
    group_id: str = Path(..., description="Group ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete a student group (only if owned by authenticated tutor)"""
    try:
        student_service = StudentService(database)
        # Pass tutor_id for tenant isolation
        deleted = await student_service.delete_group(
            group_id, tutor_id=current_user.clerk_id
        )
        if not deleted:
            raise HTTPException(
                status_code=404, detail="Group not found or access denied"
            )
        return {"message": "Group deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to delete group", error=str(e), tutor_id=current_user.clerk_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete group",
        )
