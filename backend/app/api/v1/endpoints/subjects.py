"""
Subject management endpoints with tenant isolation
"""

from typing import List
from fastapi import APIRouter, Depends, Path, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.exceptions import (
    AuthorizationError,
    DatabaseException,
    NotFoundError,
    ValidationError,
)
from app.services.subject_service import SubjectService
from app.models.subject import Subject, SubjectCreate, SubjectUpdate, SubjectWithStats

logger = structlog.get_logger()

router = APIRouter()


@router.post("/", response_model=Subject, status_code=status.HTTP_201_CREATED)
async def create_subject(
    subject_data: SubjectCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Create a new subject (requires tutor authentication)"""
    try:
        subject_service = SubjectService(database)
        return await subject_service.create_subject(
            subject_data,
            tutor_id=current_user.tenant_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error("Subject create database error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create subject",
        )
    except Exception as e:
        logger.error(
            "Failed to create subject",
            error=str(e),
            tutor_id=current_user.tenant_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create subject",
        )


@router.get("/", response_model=List[Subject])
async def get_subjects(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get all subjects for the authenticated tutor"""
    try:
        subject_service = SubjectService(database)
        return await subject_service.get_subjects_by_tutor(
            tutor_id=current_user.tenant_id
        )
    except DatabaseException as e:
        logger.error("Subject list database error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subjects",
        )
    except Exception as e:
        logger.error(
            "Failed to get subjects",
            error=str(e),
            tutor_id=current_user.tenant_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subjects",
        )


@router.get("/{subject_id}", response_model=Subject)
async def get_subject(
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get subject by ID (only if owned by authenticated tutor)"""
    try:
        subject_service = SubjectService(database)
        subject = await subject_service.get_subject_by_id(
            subject_id,
            tutor_id=current_user.tenant_id,
        )
        if subject is None:
            raise NotFoundError("Subject", subject_id)
        return subject
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error("Subject get database error", error=str(e), subject_id=subject_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subject",
        )
    except Exception as e:
        logger.error(
            "Failed to get subject",
            error=str(e),
            tutor_id=current_user.tenant_id,
            subject_id=subject_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subject",
        )


@router.get("/{subject_id}/stats", response_model=SubjectWithStats)
async def get_subject_with_stats(
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get subject with statistics (only if owned by authenticated tutor)"""
    try:
        subject_service = SubjectService(database)
        subject_stats = await subject_service.get_subject_with_stats(
            subject_id,
            tutor_id=current_user.tenant_id,
        )
        if subject_stats is None:
            raise NotFoundError("Subject", subject_id)
        return subject_stats
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error(
            "Subject stats database error",
            error=str(e),
            subject_id=subject_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subject statistics",
        )
    except Exception as e:
        logger.error(
            "Failed to get subject stats",
            error=str(e),
            tutor_id=current_user.tenant_id,
            subject_id=subject_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subject statistics",
        )


@router.put("/{subject_id}", response_model=Subject)
async def update_subject(
    subject_update: SubjectUpdate,
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update subject (only if owned by authenticated tutor)"""
    try:
        subject_service = SubjectService(database)
        return await subject_service.update_subject(
            subject_id,
            subject_update,
            tutor_id=current_user.tenant_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error(
            "Subject update database error", error=str(e), subject_id=subject_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update subject",
        )
    except Exception as e:
        logger.error(
            "Failed to update subject",
            error=str(e),
            tutor_id=current_user.tenant_id,
            subject_id=subject_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update subject",
        )


@router.delete("/{subject_id}")
async def delete_subject(
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete subject (only if owned by authenticated tutor)"""
    try:
        subject_service = SubjectService(database)
        await subject_service.delete_subject(
            subject_id,
            tutor_id=current_user.tenant_id,
        )
        return {"message": "Subject deleted successfully"}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error(
            "Subject delete database error", error=str(e), subject_id=subject_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete subject",
        )
    except Exception as e:
        logger.error(
            "Failed to delete subject",
            error=str(e),
            tutor_id=current_user.tenant_id,
            subject_id=subject_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete subject",
        )


@router.post("/{subject_id}/topics/{topic}")
async def add_topic_to_subject(
    subject_id: str = Path(..., description="Subject ID"),
    topic: str = Path(..., description="Topic name"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Add topic to subject (only if owned by authenticated tutor)"""
    try:
        subject_service = SubjectService(database)
        subject = await subject_service.add_topic_to_subject(
            subject_id,
            topic,
            tutor_id=current_user.tenant_id,
        )
        return {"message": f"Topic '{topic}' added successfully", "subject": subject}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error(
            "Topic add database error",
            error=str(e),
            subject_id=subject_id,
            topic=topic,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add topic",
        )
    except Exception as e:
        logger.error(
            "Failed to add topic",
            error=str(e),
            tutor_id=current_user.tenant_id,
            subject_id=subject_id,
            topic=topic,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add topic",
        )


@router.delete("/{subject_id}/topics/{topic}")
async def remove_topic_from_subject(
    subject_id: str = Path(..., description="Subject ID"),
    topic: str = Path(..., description="Topic name"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Remove topic from subject (only if owned by authenticated tutor)"""
    try:
        subject_service = SubjectService(database)
        subject = await subject_service.remove_topic_from_subject(
            subject_id,
            topic,
            tutor_id=current_user.tenant_id,
        )
        return {"message": f"Topic '{topic}' removed successfully", "subject": subject}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DatabaseException as e:
        logger.error(
            "Topic remove database error",
            error=str(e),
            subject_id=subject_id,
            topic=topic,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove topic",
        )
    except Exception as e:
        logger.error(
            "Failed to remove topic",
            error=str(e),
            tutor_id=current_user.tenant_id,
            subject_id=subject_id,
            topic=topic,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove topic",
        )
