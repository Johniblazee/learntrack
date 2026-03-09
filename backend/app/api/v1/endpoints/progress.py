"""
Progress tracking endpoints
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Path, Query, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from dateutil.relativedelta import relativedelta
import structlog
from bson import ObjectId

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
    GradeSubmissionRequest,
    AnswerSubmissionRequest,
    StudentProgress,
    ProgressAnalytics,
    ParentProgressView,
    ProgressReportsResponse,
    ProgressCreate,
    AnswerType,
    QuestionAnswer,
    SubmissionStatus,
    StudentPerformanceData,
    WeeklyProgressData,
)
from app.models.activity import ActivityCreate, ActivityType
from app.models.notification import NotificationCreate, NotificationType
from app.services.progress_service import ProgressService
from app.services.activity_service import ActivityService
from app.services.notification_service import NotificationService
from app.core.utils import to_object_id
from app.core.exceptions import NotFoundError

logger = structlog.get_logger()
router = APIRouter()


async def _record_activity_event(
    database: AsyncIOMotorDatabase,
    *,
    activity_type: ActivityType,
    user_id: str,
    tutor_id: str,
    description: str,
    related_entity_id: Optional[str] = None,
    related_entity_type: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        activity_service = ActivityService(database)
        await activity_service.create_activity(
            activity_data=ActivityCreate(
                activity_type=activity_type,
                user_id=user_id,
                tutor_id=tutor_id,
                description=description,
                related_entity_id=related_entity_id,
                related_entity_type=related_entity_type,
                metadata=metadata or {},
            ),
            user_id=user_id,
            tutor_id=tutor_id,
        )
    except Exception as event_error:
        logger.warning(
            "Failed to record activity event",
            activity_type=activity_type.value,
            user_id=user_id,
            tutor_id=tutor_id,
            error=str(event_error),
        )


async def _create_notification_event(
    database: AsyncIOMotorDatabase,
    *,
    recipient_id: str,
    tutor_id: str,
    title: str,
    message: str,
    notification_type: NotificationType,
    related_entity_id: Optional[str] = None,
    related_entity_type: Optional[str] = None,
    action_url: Optional[str] = None,
) -> None:
    try:
        notification_service = NotificationService(database)
        await notification_service.create_notification(
            NotificationCreate(
                title=title,
                message=message,
                notification_type=notification_type,
                recipient_id=recipient_id,
                tutor_id=tutor_id,
                related_entity_id=related_entity_id,
                related_entity_type=related_entity_type,
                action_url=action_url,
            )
        )
    except Exception as event_error:
        logger.warning(
            "Failed to create notification event",
            recipient_id=recipient_id,
            tutor_id=tutor_id,
            notification_type=notification_type.value,
            error=str(event_error),
        )


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
        students = await database.students.find(
            {"tutor_id": current_user.clerk_id, "is_active": True},
            {"clerk_id": 1, "name": 1},
        ).to_list(length=500)

        student_ids = [s.get("clerk_id") for s in students if s.get("clerk_id")]

        assignments = await database.assignments.find(
            {"tutor_id": current_user.clerk_id},
            {"_id": 1, "subject_id": 1},
        ).to_list(length=5000)

        subject_object_ids = {
            assignment.get("subject_id")
            for assignment in assignments
            if isinstance(assignment.get("subject_id"), ObjectId)
        }

        subject_docs = []
        if subject_object_ids:
            subject_docs = await database.subjects.find(
                {"_id": {"$in": list(subject_object_ids)}},
                {"_id": 1, "name": 1},
            ).to_list(length=500)

        subject_name_by_id = {
            str(subject.get("_id")): subject.get("name", "") for subject in subject_docs
        }

        assignment_subject_name = {
            str(assignment.get("_id")): subject_name_by_id.get(
                str(assignment.get("subject_id")), ""
            )
            for assignment in assignments
            if assignment.get("_id")
        }

        progress_query: Dict[str, Any] = {"tutor_id": current_user.clerk_id}
        if student_ids:
            progress_query["student_id"] = {"$in": student_ids}

        progress_docs = await database.progress.find(progress_query).to_list(
            length=10000
        )

        score_buckets: Dict[str, Dict[str, List[float]]] = {
            student_id: {"math": [], "physics": [], "chemistry": [], "overall": []}
            for student_id in student_ids
        }

        completed_statuses = {
            SubmissionStatus.SUBMITTED.value,
            SubmissionStatus.GRADED.value,
            "completed",
        }

        def _ensure_tz_aware(value: Any) -> Optional[datetime]:
            if not isinstance(value, datetime):
                return None
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value

        now = datetime.now(timezone.utc)
        weekly_progress: List[WeeklyProgressData] = []

        for week_num in range(4, 0, -1):
            week_start = now - timedelta(weeks=week_num)
            week_end = now - timedelta(weeks=week_num - 1)

            assigned = 0
            completed = 0

            for progress in progress_docs:
                created_at = _ensure_tz_aware(progress.get("created_at"))
                if not created_at or not (week_start <= created_at < week_end):
                    continue

                assigned += 1
                status_value = str(progress.get("status") or "").lower()
                if status_value in completed_statuses:
                    completed += 1

            weekly_progress.append(
                WeeklyProgressData(
                    week=f"Week {5 - week_num}",
                    completed=completed,
                    assigned=assigned,
                )
            )

        for progress in progress_docs:
            score = progress.get("score")
            if score is None:
                continue

            student_id = progress.get("student_id")
            if student_id not in score_buckets:
                continue

            try:
                numeric_score = float(score)
            except (TypeError, ValueError):
                continue

            bucket = score_buckets[student_id]
            bucket["overall"].append(numeric_score)

            assignment_id = str(progress.get("assignment_id") or "")
            subject_name = assignment_subject_name.get(assignment_id, "").lower()

            if "math" in subject_name:
                bucket["math"].append(numeric_score)
            elif "physics" in subject_name:
                bucket["physics"].append(numeric_score)
            elif "chem" in subject_name:
                bucket["chemistry"].append(numeric_score)

        def _avg(values: List[float]) -> int:
            if not values:
                return 0
            return int(round(sum(values) / len(values)))

        student_performance: List[StudentPerformanceData] = []
        for student in students:
            student_id = student.get("clerk_id")
            bucket = score_buckets.get(
                student_id,
                {"math": [], "physics": [], "chemistry": [], "overall": []},
            )
            overall_score = _avg(bucket["overall"])

            student_performance.append(
                StudentPerformanceData(
                    name=student.get("name", "Student"),
                    math=_avg(bucket["math"]) or overall_score,
                    physics=_avg(bucket["physics"]),
                    chemistry=_avg(bucket["chemistry"]),
                )
            )

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


@router.get("/assignment/{assignment_id}/student/{student_id}", response_model=Progress)
async def get_student_assignment_progress(
    assignment_id: str = Path(..., description="Assignment ID"),
    student_id: str = Path(..., description="Student ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get specific student's progress on an assignment"""
    try:
        from app.services.user_service import UserService
        from app.models.user import UserRole

        user_service = UserService(database)

        # Get the student for authorization check
        student = await user_service.get_user_by_clerk_id(student_id)
        if not student or student.role != UserRole.STUDENT:
            raise HTTPException(status_code=404, detail="Student not found")

        # Authorization check - same logic as get_student_progress_analytics_by_id
        if current_user.is_super_admin:
            pass  # Super admins can view any student
        elif current_user.role == UserRole.TUTOR:
            # Tutors can view their students
            if student.tutor_id != current_user.clerk_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: Student does not belong to your tenant",
                )
        elif current_user.role == UserRole.STUDENT:
            # Students can only view themselves
            if student_id != current_user.clerk_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You can only view your own progress",
                )
        elif current_user.role == UserRole.PARENT:
            # Parents can view their children
            if student_id not in (current_user.student_ids or []):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: This student is not your child",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden"
            )

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
    except HTTPException:
        raise
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
    submission: AnswerSubmissionRequest,
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Submit answers for an assignment and optionally finalize submission."""
    try:
        assignment_oid = to_object_id(assignment_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignment ID"
        )

    assignment = await database.assignments.find_one({"_id": assignment_oid})
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )

    assigned_students = assignment.get("student_ids", [])
    if current_user.clerk_id not in assigned_students:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this assignment",
        )

    progress_service = ProgressService(database)
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

    incoming_answers = submission.answers or progress.answers
    if not incoming_answers and submission.submit_assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot submit assignment without answers",
        )

    assignment_questions = assignment.get("questions", [])
    points_by_question = {
        str(question.get("question_id")): float(question.get("points", 1))
        for question in assignment_questions
        if question.get("question_id")
    }

    question_id_set = {
        str(answer.question_id) for answer in incoming_answers if answer.question_id
    }
    question_docs: Dict[str, Any] = {}
    question_object_ids = []
    for question_id in question_id_set:
        try:
            question_object_ids.append(to_object_id(question_id))
        except Exception:
            continue

    if question_object_ids:
        docs = await database.questions.find(
            {"_id": {"$in": question_object_ids}}
        ).to_list(length=500)
        for doc in docs:
            question_docs[str(doc.get("_id"))] = doc

    def normalize_text(value: Optional[str]) -> str:
        return (value or "").strip().lower()

    scored_answers: List[QuestionAnswer] = []
    total_points_earned = 0.0
    total_points_possible = 0.0
    now = datetime.now(timezone.utc)

    for answer in incoming_answers:
        question_id = str(answer.question_id)
        question_doc = question_docs.get(question_id)

        points_possible = float(
            points_by_question.get(
                question_id, question_doc.get("points", 1) if question_doc else 1
            )
        )
        answer_type = AnswerType.UNANSWERED
        points_earned = 0.0

        selected_options = answer.selected_options or []
        answer_text = (answer.answer or "").strip()
        has_response = bool(answer_text or selected_options)

        if question_doc:
            question_type = str(question_doc.get("question_type", "")).lower()
            correct_answer = question_doc.get("correct_answer")

            if question_type == "multiple-choice":
                correct_options = [
                    normalize_text(option.get("text"))
                    for option in question_doc.get("options", [])
                    if option.get("is_correct")
                ]
                submitted_options = [normalize_text(opt) for opt in selected_options]

                if (
                    submitted_options
                    and correct_options
                    and set(submitted_options) == set(correct_options)
                ):
                    answer_type = AnswerType.CORRECT
                    points_earned = points_possible
                elif submitted_options:
                    answer_type = AnswerType.INCORRECT
                else:
                    answer_type = AnswerType.UNANSWERED

            elif question_type == "true-false":
                submitted_value = answer_text or (
                    selected_options[0] if selected_options else ""
                )
                if not submitted_value:
                    answer_type = AnswerType.UNANSWERED
                elif normalize_text(submitted_value) == normalize_text(
                    str(correct_answer or "")
                ):
                    answer_type = AnswerType.CORRECT
                    points_earned = points_possible
                else:
                    answer_type = AnswerType.INCORRECT

            elif question_type == "short-answer":
                if not answer_text:
                    answer_type = AnswerType.UNANSWERED
                elif normalize_text(answer_text) == normalize_text(
                    str(correct_answer or "")
                ):
                    answer_type = AnswerType.CORRECT
                    points_earned = points_possible
                else:
                    answer_type = AnswerType.INCORRECT

            else:
                answer_type = (
                    AnswerType.PARTIAL if has_response else AnswerType.UNANSWERED
                )
        else:
            answer_type = AnswerType.PARTIAL if has_response else AnswerType.UNANSWERED

        total_points_possible += points_possible
        total_points_earned += points_earned

        scored_answers.append(
            QuestionAnswer(
                question_id=question_id,
                answer=answer.answer,
                selected_options=selected_options,
                answer_type=answer_type,
                points_earned=round(points_earned, 2),
                points_possible=round(points_possible, 2),
                time_spent=answer.time_spent,
                answered_at=answer.answered_at or (now if has_response else None),
            )
        )

    score = (
        round((total_points_earned / total_points_possible) * 100, 2)
        if total_points_possible > 0 and submission.submit_assignment
        else None
    )

    progress_update = ProgressUpdate(
        answers=scored_answers,
        status=SubmissionStatus.SUBMITTED
        if submission.submit_assignment
        else SubmissionStatus.IN_PROGRESS,
        submitted_at=now if submission.submit_assignment else None,
        score=score,
        points_earned=round(total_points_earned, 2),
        points_possible=round(total_points_possible, 2),
        time_spent=sum(answer.time_spent or 0 for answer in scored_answers),
    )

    updated_progress = await progress_service.update_progress(
        str(progress.id), progress_update
    )

    if submission.submit_assignment:
        assignment_title = str(assignment.get("title") or "Assignment")
        tutor_id = str(
            assignment.get("tutor_id") or current_user.tutor_id or current_user.clerk_id
        )
        student_name = current_user.name or ""   # empty → dashboard falls through to DB lookup

        await _record_activity_event(
            database,
            activity_type=ActivityType.ASSIGNMENT_SUBMITTED,
            user_id=current_user.clerk_id,
            tutor_id=tutor_id,
            description=f"Submitted {assignment_title}",
            related_entity_id=assignment_id,
            related_entity_type="assignment",
            metadata={
                "assignment_title": assignment_title,
                "student_name": student_name,
                "score": score,
            },
        )

        if tutor_id != current_user.clerk_id:
            await _create_notification_event(
                database,
                recipient_id=tutor_id,
                tutor_id=tutor_id,
                title="Assignment submitted",
                message=f"{student_name} submitted {assignment_title}",
                notification_type=NotificationType.ASSIGNMENT_SUBMITTED,
                related_entity_id=assignment_id,
                related_entity_type="assignment",
                action_url="/dashboard/assignments/grading",
            )

    return updated_progress


@router.get("/submissions", response_model=List[Dict[str, Any]])
async def list_submissions_for_grading(
    status_filter: Optional[str] = Query(
        None, description="Filter by status (pending, graded)"
    ),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """List assignment submissions for grading center (tutor only)."""
    normalized_filter = (status_filter or "").strip().lower()
    allowed_filters = {"", "all", "pending", "graded", "reviewed"}
    if normalized_filter not in allowed_filters:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid status filter. Allowed: pending, graded, reviewed, all",
        )

    status_query_map = {
        "pending": [SubmissionStatus.SUBMITTED.value],
        "graded": [SubmissionStatus.GRADED.value],
        "reviewed": [SubmissionStatus.GRADED.value],
        "all": [SubmissionStatus.SUBMITTED.value, SubmissionStatus.GRADED.value],
        "": [SubmissionStatus.SUBMITTED.value, SubmissionStatus.GRADED.value],
    }
    statuses = status_query_map.get(normalized_filter, status_query_map[""])

    query = {
        "tutor_id": current_user.clerk_id,
        "status": {"$in": statuses},
    }
    progress_docs = (
        await database.progress.find(query).sort("submitted_at", -1).to_list(length=300)
    )

    assignment_ids = []
    for doc in progress_docs:
        assignment_id = doc.get("assignment_id")
        if assignment_id:
            assignment_ids.append(str(assignment_id))

    assignment_object_ids = []
    for assignment_id in assignment_ids:
        try:
            assignment_object_ids.append(to_object_id(assignment_id))
        except Exception:
            continue

    assignments = []
    if assignment_object_ids:
        assignments = await database.assignments.find(
            {"_id": {"$in": assignment_object_ids}}
        ).to_list(length=len(assignment_object_ids))
    assignments_by_id = {str(item.get("_id")): item for item in assignments}

    student_ids = list(
        {doc.get("student_id") for doc in progress_docs if doc.get("student_id")}
    )
    students = []
    if student_ids:
        students = await database.students.find(
            {"clerk_id": {"$in": student_ids}}
        ).to_list(length=len(student_ids))
    students_by_id = {student.get("clerk_id"): student for student in students}

    subject_ids: List[Any] = []
    for assignment in assignments:
        subject_id = assignment.get("subject_id")
        if isinstance(subject_id, ObjectId):
            subject_ids.append(subject_id)
        elif isinstance(subject_id, str):
            try:
                converted_subject_id = to_object_id(subject_id)
                if isinstance(converted_subject_id, ObjectId):
                    subject_ids.append(converted_subject_id)
            except Exception:
                continue

    subjects = []
    if subject_ids:
        subjects = await database.subjects.find({"_id": {"$in": subject_ids}}).to_list(
            length=len(subject_ids)
        )
    subjects_by_id = {str(subject.get("_id")): subject for subject in subjects}

    response_items: List[Dict[str, Any]] = []
    for doc in progress_docs:
        assignment_id = str(doc.get("assignment_id", ""))
        assignment = assignments_by_id.get(assignment_id, {})
        subject_raw = assignment.get("subject_id")
        subject_key = str(subject_raw) if subject_raw is not None else ""
        subject = subjects_by_id.get(subject_key, {})
        student = students_by_id.get(doc.get("student_id"), {})

        response_items.append(
            {
                "_id": str(doc.get("_id")),
                "assignment_id": {
                    "_id": assignment_id,
                    "title": assignment.get("title", "Untitled Assignment"),
                    "subject_id": {
                        "name": subject.get("name", "General"),
                    },
                },
                "student_id": {
                    "_id": student.get("clerk_id", doc.get("student_id")),
                    "clerk_id": student.get("clerk_id", doc.get("student_id")),
                    "name": student.get("name", "Unknown Student"),
                    "email": student.get("email", ""),
                },
                "answers": doc.get("answers", []),
                "score": doc.get("score"),
                "status": "pending"
                if doc.get("status") == SubmissionStatus.SUBMITTED.value
                else "graded",
                "submitted_at": doc.get("submitted_at") or doc.get("updated_at"),
                "graded_at": doc.get("graded_at"),
                "feedback": doc.get("feedback"),
            }
        )

    return response_items


@router.put("/submissions/{progress_id}/grade", response_model=Progress)
async def grade_submission(
    grade_data: GradeSubmissionRequest,
    progress_id: str = Path(..., description="Progress submission ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Grade a student submission (tutor only)."""
    progress_service = ProgressService(database)
    try:
        progress_oid = to_object_id(progress_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid submission ID"
        )

    existing = await database.progress.find_one(
        {"_id": progress_oid, "tutor_id": current_user.clerk_id}
    )
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
        )

    update = ProgressUpdate(
        status=SubmissionStatus.GRADED,
        score=grade_data.score,
        feedback=grade_data.feedback,
        graded_at=datetime.now(timezone.utc),
        graded_by=current_user.clerk_id,
    )
    updated_progress = await progress_service.update_progress(progress_id, update)

    assignment_id = str(existing.get("assignment_id") or "")
    student_id = str(existing.get("student_id") or "")
    assignment_title = "Assignment"
    if assignment_id:
        try:
            assignment_doc = await database.assignments.find_one(
                {"_id": to_object_id(assignment_id)},
                {"title": 1},
            )
            if assignment_doc and assignment_doc.get("title"):
                assignment_title = str(assignment_doc.get("title"))
        except Exception as lookup_error:
            logger.warning(
                "Failed to load assignment title for grading event",
                assignment_id=assignment_id,
                error=str(lookup_error),
            )

    if student_id:
        await _record_activity_event(
            database,
            activity_type=ActivityType.ASSIGNMENT_COMPLETED,
            user_id=student_id,
            tutor_id=current_user.clerk_id,
            description=f"{assignment_title} was graded",
            related_entity_id=assignment_id or None,
            related_entity_type="assignment",
            metadata={
                "assignment_title": assignment_title,
                "score": grade_data.score,
                "graded_by": current_user.clerk_id,
            },
        )

        score_label = (
            f"{grade_data.score:.0f}%"
            if isinstance(grade_data.score, (float, int))
            else "a new score"
        )
        await _create_notification_event(
            database,
            recipient_id=student_id,
            tutor_id=current_user.clerk_id,
            title="Assignment graded",
            message=f"{assignment_title} was graded with {score_label}",
            notification_type=NotificationType.ASSIGNMENT_GRADED,
            related_entity_id=assignment_id or None,
            related_entity_type="assignment",
            action_url="/dashboard/grades",
        )

    return updated_progress


@router.get("/subject/{subject_id}/analytics", response_model=Dict[str, Any])
async def get_subject_analytics(
    subject_id: str = Path(..., description="Subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get analytics for a subject"""
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
            # Fallback for non-ObjectId legacy subject ids
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
            "completed",  # legacy compatibility
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
