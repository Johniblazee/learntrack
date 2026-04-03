"""
Assignment template endpoints for managing reusable assignment templates
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Path, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from pydantic import BaseModel

from app.core.database import get_database
from app.core.enhanced_auth import ClerkUserContext, require_tutor, get_current_user
from app.models.assignment_template import (
    AssignmentTemplate,
    AssignmentTemplateCreate,
    AssignmentTemplateUpdate,
    AssignmentTemplateListResponse,
    AssignmentTemplateStats,
    TemplateStatus,
)
from app.services.assignment_template_service import AssignmentTemplateService
from app.core.exceptions import NotFoundError, ValidationError

logger = structlog.get_logger()
router = APIRouter()


class BulkTemplateActionRequest(BaseModel):
    template_ids: List[str]


class BulkTemplateStatusRequest(BulkTemplateActionRequest):
    status: TemplateStatus


@router.post(
    "/", response_model=AssignmentTemplate, status_code=status.HTTP_201_CREATED
)
async def create_template(
    template_data: AssignmentTemplateCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Create a new assignment template (Tutor only)
    """
    try:
        template_service = AssignmentTemplateService(database)
        template = await template_service.create_template(
            template_data, current_user.clerk_id
        )
        return template
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to create template", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create template",
        )


@router.get("/", response_model=AssignmentTemplateListResponse)
async def list_templates(
    status_filter: Optional[TemplateStatus] = Query(
        None, description="Filter by status"
    ),
    subject_id: Optional[str] = Query(None, description="Filter by subject"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    List all assignment templates for the current tutor
    """
    try:
        template_service = AssignmentTemplateService(database)
        result = await template_service.list_templates(
            current_user.clerk_id,
            status_filter=status_filter,
            subject_id=subject_id,
            skip=skip,
            limit=limit,
        )
        return result
    except Exception as e:
        logger.error("Failed to list templates", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list templates",
        )


@router.get("/stats", response_model=AssignmentTemplateStats)
async def get_template_stats(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get statistics about assignment templates
    """
    try:
        template_service = AssignmentTemplateService(database)
        stats = await template_service.get_stats(current_user.clerk_id)
        return stats
    except Exception as e:
        logger.error("Failed to get template stats", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get template stats",
        )


@router.post("/bulk-status", response_model=dict)
async def bulk_update_template_status(
    payload: BulkTemplateStatusRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update status for multiple templates."""
    try:
        template_service = AssignmentTemplateService(database)
        return await template_service.bulk_update_status(
            payload.template_ids,
            current_user.clerk_id,
            payload.status,
        )
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk update template status", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to bulk update template status",
        )


@router.post("/bulk-delete", response_model=dict)
async def bulk_delete_templates(
    payload: BulkTemplateActionRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete multiple templates."""
    try:
        template_service = AssignmentTemplateService(database)
        return await template_service.bulk_delete_templates(
            payload.template_ids,
            current_user.clerk_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk delete templates", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to bulk delete templates",
        )


@router.get("/{template_id}", response_model=AssignmentTemplate)
async def get_template(
    template_id: str = Path(..., description="Template ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get a specific assignment template by ID
    """
    try:
        template_service = AssignmentTemplateService(database)
        template = await template_service.get_template(
            template_id, current_user.clerk_id
        )
        if not template:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
            )
        return template
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get template", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get template",
        )


@router.put("/{template_id}", response_model=AssignmentTemplate)
async def update_template(
    template_id: str,
    template_data: AssignmentTemplateUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Update an assignment template
    """
    try:
        template_service = AssignmentTemplateService(database)
        template = await template_service.update_template(
            template_id, template_data, current_user.clerk_id
        )
        return template
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to update template", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update template",
        )


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Delete an assignment template
    """
    try:
        template_service = AssignmentTemplateService(database)
        await template_service.delete_template(template_id, current_user.clerk_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error("Failed to delete template", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete template",
        )


@router.post("/{template_id}/use", response_model=AssignmentTemplate)
async def use_template(
    template_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Mark a template as used (increments usage count)
    """
    try:
        template_service = AssignmentTemplateService(database)
        template = await template_service.use_template(
            template_id, current_user.clerk_id
        )
        return template
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error("Failed to use template", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to use template",
        )
