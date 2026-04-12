"""Tutor-facing progress endpoints: reports, assignment overview, subject analytics."""

from typing import List, Dict, Any
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Path, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.models.progress import StudentProgress, ProgressReportsResponse, SubmissionStatus
from app.services.progress_service import ProgressService
from app.core.exceptions import NotFoundError
from app.core.utils import to_object_id

logger = structlog.get_logger()
router = APIRouter()


@router.get("/reports", response_model=ProgressReportsResponse)
async def get_progress_reports(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress reports data for the reports dashboard (tutor only)."""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_progress_reports(current_user.clerk_id)
    except Exception as e:
        logger.error("Failed to get progress reports", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve progress reports",
        )


@router.get("/assignment/{assignment_id}", response_model=List[StudentProgress])
async def get_assignment_progress(
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress for all students in an assignment (tutor only)."""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_assignment_progress(
            assignment_id=assignment_id,
            tutor_id=current_user.clerk_id,
        )
    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )
    except Exception as e:
        logger.error("Failed to get assignment progress", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve assignment progress",
        )


@router.get("/subject/{subject_id}/analytics", response_model=Dict[str, Any])
async def get_subject_analytics(
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get analytics for a subject."""
    try:
        subject_object_id = None
        try:
            converted_subject_id = to_object_id(subject_id)
            if isinstance(converted_subject_id, ObjectId):
                subject_object_id = converted_subject_id
        except Exception:
            subject_object_id = None

        subject_query: Dict[str, Any] = {"tutor_id": current_user.clerk_id}
        if subject_object_id:
            subject_query["_id"] = subject_object_id
        else:
            subject_query["id"] = subject_id

        subject_doc = await database.subjects.find_one(subject_query)
        if not subject_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found"
            )

        assignment_subject_filters: List[Dict[str, Any]] = [{"subject_id": subject_id}]
        if subject_object_id:
            assignment_subject_filters.append({"subject_id": subject_object_id})

        assignments = await database.assignments.find(
            {
                "tutor_id": current_user.clerk_id,
                "$or": assignment_subject_filters,
            }
        ).to_list(length=1000)

        assignment_ids = [
            str(assignment.get("_id"))
            for assignment in assignments
            if assignment.get("_id")
        ]

        expected_submissions = sum(
            len(assignment.get("student_ids", []) or []) for assignment in assignments
        )

        progress_docs = []
        if assignment_ids:
            progress_docs = await database.progress.find(
                {
                    "tutor_id": current_user.clerk_id,
                    "assignment_id": {"$in": assignment_ids},
                }
            ).to_list(length=5000)

        completed_statuses = {
            SubmissionStatus.SUBMITTED.value,
            SubmissionStatus.GRADED.value,
            "completed",
        }

        completed_progress = [
            progress
            for progress in progress_docs
            if progress.get("status") in completed_statuses
        ]
        graded_progress = [
            progress
            for progress in progress_docs
            if progress.get("status") == SubmissionStatus.GRADED.value
        ]

        scores = [
            float(progress.get("score"))
            for progress in completed_progress
            if progress.get("score") is not None
        ]

        submissions_received = len(completed_progress)
        pending_submissions = max(expected_submissions - submissions_received, 0)
        completion_rate = (
            round((submissions_received / expected_submissions) * 100, 1)
            if expected_submissions > 0
            else 0.0
        )

        return {
            "subject_id": str(subject_doc.get("_id", subject_id)),
            "subject_name": subject_doc.get("name", "Unknown"),
            "total_assignments": len(assignments),
            "students_assigned": expected_submissions,
            "submissions_received": submissions_received,
            "pending_submissions": pending_submissions,
            "graded_submissions": len(graded_progress),
            "completion_rate": completion_rate,
            "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get subject analytics",
            subject_id=subject_id,
            tutor_id=current_user.clerk_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve subject analytics",
        )
