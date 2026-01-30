"""
Progress tracking endpoints
"""

from typing import List, Dict, Any
from datetime import timedelta
from fastapi import APIRouter, Depends, Path, Query, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from dateutil.relativedelta import relativedelta
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_tutor,
    require_authenticated_user,
    require_student,
    require_parent,
    ClerkUserContext,
)
from app.models.progress import (
    Progress,
    ProgressUpdate,
    StudentProgress,
    ProgressAnalytics,
    ParentProgressView,
    ProgressReportsResponse,
    ProgressCreate,
    StudentPerformanceData,
    WeeklyProgressData,
)
from app.services.progress_service import ProgressService

logger = structlog.get_logger()
router = APIRouter()


@router.get("/student", response_model=ProgressAnalytics)
async def get_student_progress_analytics(
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress analytics for current student"""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_student_analytics(current_user.clerk_id)
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
    """
    Get progress analytics for a specific student.

    Security:
    - Tutors can view analytics for their students
    - Students can view their own analytics
    - Parents can view analytics for their children
    """
    try:
        from app.services.user_service import UserService
        from app.models.user import UserRole
        from datetime import datetime, timezone
        from calendar import month_abbr

        user_service = UserService(database)

        # Get the student
        student = await user_service.get_user_by_clerk_id(student_id)
        if not student or student.role != UserRole.STUDENT:
            raise HTTPException(status_code=404, detail="Student not found")

        # Security check - super admins have full access
        if current_user.is_super_admin:
            pass  # Super admins can view any student
        elif current_user.role == UserRole.TUTOR:
            # Tutors can view their students
            if student.tutor_id != current_user.clerk_id:
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: Student does not belong to your tenant",
                )
        elif current_user.role == UserRole.STUDENT:
            # Students can only view themselves
            if student_id != current_user.clerk_id:
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: You can only view your own analytics",
                )
        elif current_user.role == UserRole.PARENT:
            # Parents can view their children
            if student_id not in (current_user.student_ids or []):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: This student is not your child",
                )
        else:
            raise HTTPException(status_code=403, detail="Access forbidden")

        # Get analytics
        progress_service = ProgressService(database)
        analytics = await progress_service.get_student_analytics(student_id)

        # Calculate monthly scores using single aggregation query (replaces 6 sequential queries)
        now = datetime.now(timezone.utc)
        # Use relativedelta for proper month arithmetic
        six_months_ago = (now.replace(day=1) - relativedelta(months=5)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )

        # Single aggregation to get monthly averages
        monthly_pipeline = [
            {
                "$match": {
                    "student_id": student_id,
                    "submitted_at": {"$gte": six_months_ago},
                    "score": {"$ne": None},
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

        # Build month lookup from aggregation results
        month_lookup = {}
        for result in monthly_results:
            key = (result["_id"]["year"], result["_id"]["month"])
            month_lookup[key] = round(result["avg_score"]) if result["avg_score"] else 0

        # Generate last 6 months with scores (fill gaps with 0)
        monthly_scores = []
        for i in range(5, -1, -1):
            # Use relativedelta for proper month arithmetic
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
    """Get progress view for parent's children"""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_parent_progress_view(current_user.clerk_id)
    except Exception as e:
        logger.error("Failed to get parent progress view", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve parent progress view",
        )


@router.get("/reports", response_model=ProgressReportsResponse)
async def get_progress_reports(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get progress reports data for the reports dashboard (tutor only)"""
    try:
        progress_service = ProgressService(database)

        # For now, return empty data structure since we need to build this from student data
        # This will be populated with actual progress data as the system grows
        from app.services.student_service import StudentService

        student_service = StudentService(database)

        # Get students for this tutor
        students = await student_service.list_students(
            limit=100, current_user=current_user
        )

        # Create mock performance data based on actual students
        student_performance = []
        for student in students:
            student_performance.append(
                StudentPerformanceData(
                    student_name=student.name,
                    subject_scores={"math": 85, "physics": 78, "chemistry": 92},
                    tutor_id=current_user.tutor_id,
                )
            )

        # Create mock weekly progress data
        weekly_progress = [
            WeeklyProgressData(week="Week 1", completed=8, assigned=10),
            WeeklyProgressData(week="Week 2", completed=12, assigned=15),
            WeeklyProgressData(week="Week 3", completed=6, assigned=8),
            WeeklyProgressData(week="Week 4", completed=10, assigned=12),
        ]

        return ProgressReportsResponse(
            student_performance=student_performance, weekly_progress=weekly_progress
        )
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
    """Get progress for all students in an assignment (tutor only)"""
    try:
        progress_service = ProgressService(database)
        return await progress_service.get_assignment_progress(assignment_id)
    except Exception as e:
        logger.error("Failed to get assignment progress", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve assignment progress",
        )


@router.get("/assignment/{assignment_id}/student/{student_id}", response_model=Progress)
async def get_student_assignment_progress(
    assignment_id: str = Path(..., description="Assignment ID"),
    student_id: str = Path(..., description="Student ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get specific student's progress on an assignment"""
    try:
        progress_service = ProgressService(database)
        progress = await progress_service.get_student_assignment_progress(
            student_id, assignment_id
        )
        if not progress:
            progress = await progress_service.create_progress(
                ProgressCreate(
                    assignment_id=assignment_id,
                    student_id=student_id,
                    tutor_id=current_user.tutor_id,
                )
            )
        return progress
    except Exception as e:
        logger.error("Failed to get student assignment progress", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve student assignment progress",
        )


@router.put("/assignment/{assignment_id}")
async def update_assignment_progress(
    progress_update: ProgressUpdate,
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update progress on an assignment (student only)"""
    try:
        progress_service = ProgressService(database)

        # Get or create progress record
        progress = await progress_service.get_student_assignment_progress(
            current_user.clerk_id, assignment_id
        )
        if not progress:
            progress = await progress_service.create_progress(
                ProgressCreate(
                    assignment_id=assignment_id,
                    student_id=current_user.clerk_id,
                    tutor_id=current_user.tutor_id,
                )
            )

        return await progress_service.update_progress(str(progress.id), progress_update)
    except Exception as e:
        logger.error("Failed to update assignment progress", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update assignment progress",
        )


@router.post("/assignment/{assignment_id}/answer")
async def submit_answer(
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Submit answer for a question in assignment"""
    # TODO: Implement progress service
    return {"message": "Submit answer endpoint - to be implemented"}


@router.get("/subject/{subject_id}/analytics", response_model=Dict[str, Any])
async def get_subject_analytics(
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get analytics for a subject"""
    # TODO: Implement progress service
    return {"message": "Subject analytics endpoint - to be implemented"}
