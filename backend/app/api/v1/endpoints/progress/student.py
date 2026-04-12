"""Student and parent progress view endpoints."""

from typing import List, Dict, Any
from datetime import datetime, timezone
from calendar import month_abbr

from fastapi import APIRouter, Depends, HTTPException, Path, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from dateutil.relativedelta import relativedelta
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_student,
    require_authenticated_user,
    require_parent,
    ClerkUserContext,
)
from app.models.progress import ProgressAnalytics, ParentProgressView
from app.models.user import UserRole
from app.services.progress_service import ProgressService

from ._shared import get_authorized_student_record

logger = structlog.get_logger()
router = APIRouter()


@router.get("/student", response_model=ProgressAnalytics)
async def get_student_progress_analytics(
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress analytics for current student."""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_student_analytics(
            current_user.clerk_id,
            tutor_id=current_user.tenant_id,
        )
    except Exception as e:
        logger.error("Failed to get student progress analytics", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve progress analytics",
        )


@router.get("/student/{student_id}/analytics", response_model=Dict[str, Any])
async def get_student_progress_analytics_by_id(
    student_id: str = Path(..., description="Student Clerk ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress analytics for a specific student (tutor/student/parent)."""
    try:
        student = await get_authorized_student_record(
            database,
            student_id=student_id,
            current_user=current_user,
        )
        student_tutor_id = str(
            student.get("tutor_id") or current_user.tenant_id
        ).strip()

        progress_service = ProgressService(database)
        analytics = await progress_service.get_student_analytics(
            student_id,
            tutor_id=student_tutor_id or None,
        )

        now = datetime.now(timezone.utc)
        six_months_ago = (now.replace(day=1) - relativedelta(months=5)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )

        monthly_pipeline = [
            {
                "$match": {
                    "student_id": student_id,
                    "submitted_at": {"$gte": six_months_ago},
                    "score": {"$ne": None},
                    **(
                        {"results_released_at": {"$ne": None}}
                        if current_user.role != UserRole.TUTOR
                        else {}
                    ),
                    **({"tutor_id": student_tutor_id} if student_tutor_id else {}),
                }
            },
            {
                "$group": {
                    "_id": {
                        "year": {"$year": "$submitted_at"},
                        "month": {"$month": "$submitted_at"},
                    },
                    "avg_score": {"$avg": "$score"},
                    "count": {"$sum": 1},
                }
            },
            {"$sort": {"_id.year": 1, "_id.month": 1}},
        ]

        monthly_results = await database.progress.aggregate(monthly_pipeline).to_list(
            length=12
        )

        month_lookup = {}
        for result in monthly_results:
            key = (result["_id"]["year"], result["_id"]["month"])
            month_lookup[key] = round(result["avg_score"]) if result["avg_score"] else 0

        monthly_scores = []
        for i in range(5, -1, -1):
            month_date = now.replace(day=1) - relativedelta(months=i)
            month_name = month_abbr[month_date.month]
            key = (month_date.year, month_date.month)
            avg_score = month_lookup.get(key, 0)
            monthly_scores.append({"month": month_name, "score": avg_score})

        return {**analytics.model_dump(), "monthly_scores": monthly_scores}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get student progress analytics",
            error=str(e),
            student_id=student_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve progress analytics",
        )


@router.get("/parent", response_model=List[ParentProgressView])
async def get_parent_progress_view(
    current_user: ClerkUserContext = Depends(require_parent),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress view for parent's children."""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_parent_progress_view(
            current_user.clerk_id,
            parent_tutor_id=current_user.tutor_id,
        )
    except Exception as e:
        logger.error("Failed to get parent progress view", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve parent progress view",
        )
