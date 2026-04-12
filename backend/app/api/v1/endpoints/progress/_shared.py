"""Shared helpers, models and utilities for the progress sub-routers."""

from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.enhanced_auth import ClerkUserContext
from app.models.progress import (
    Progress,
    SubmissionStatus,
    AnswerType,
)
from app.models.assignment import AssignmentStatus
from app.models.user import UserRole
from app.models.activity import ActivityCreate, ActivityType
from app.models.notification import NotificationCreate, NotificationType
from app.services.activity_service import ActivityService
from app.services.notification_service import NotificationService

logger = structlog.get_logger()


async def record_activity_event(
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


async def create_notification_event(
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


def is_progress_locked(status_value: Any) -> bool:
    normalized = (
        str(status_value.value or "").strip().lower()
        if isinstance(status_value, Enum)
        else str(status_value or "").strip().lower()
    )
    return normalized in {
        SubmissionStatus.SUBMITTED.value,
        SubmissionStatus.GRADED.value,
    }


def is_assignment_available_to_student(assignment: Dict[str, Any]) -> bool:
    raw_status = assignment.get("status")
    normalized = (
        str(raw_status.value or "").strip().lower()
        if isinstance(raw_status, Enum)
        else str(raw_status or "").strip().lower()
    )
    return normalized not in {
        AssignmentStatus.DRAFT.value,
        AssignmentStatus.SCHEDULED.value,
    }


def is_results_released(progress_doc: Dict[str, Any] | Progress | None) -> bool:
    if progress_doc is None:
        return False
    if isinstance(progress_doc, Progress):
        return progress_doc.results_released_at is not None
    return progress_doc.get("results_released_at") is not None


def should_auto_release_results(
    assignment: Dict[str, Any], *, requires_manual_review: bool
) -> bool:
    return (
        bool(assignment.get("show_results_immediately", False))
        and not requires_manual_review
    )


def student_visible_progress_status(
    progress_doc: Dict[str, Any] | Progress,
) -> SubmissionStatus:
    raw_status = (
        progress_doc.status.value
        if isinstance(progress_doc, Progress)
        and isinstance(progress_doc.status, SubmissionStatus)
        else str(
            progress_doc.status
            if isinstance(progress_doc, Progress)
            else progress_doc.get("status") or ""
        )
        .strip()
        .lower()
    )

    if raw_status == SubmissionStatus.GRADED.value and not is_results_released(
        progress_doc
    ):
        return SubmissionStatus.SUBMITTED
    if raw_status == SubmissionStatus.GRADED.value:
        return SubmissionStatus.GRADED
    if raw_status == SubmissionStatus.SUBMITTED.value:
        return SubmissionStatus.SUBMITTED
    return SubmissionStatus.IN_PROGRESS


def sanitize_progress_for_student(progress: Progress) -> Progress:
    visible_status = student_visible_progress_status(progress)
    if visible_status == SubmissionStatus.GRADED:
        return progress

    payload = progress.model_dump()
    payload["status"] = visible_status
    payload["score"] = None
    payload["feedback"] = None
    payload["graded_at"] = None
    return Progress(**payload)


def normalize_text_answer(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def derive_answer_points(answer: Dict[str, Any]) -> float:
    if answer.get("final_points_earned") is not None:
        return coerce_float(answer.get("final_points_earned"), 0.0)
    if answer.get("points_earned") is not None:
        return coerce_float(answer.get("points_earned"), 0.0)
    return coerce_float(answer.get("auto_points_earned"), 0.0)


def derive_submission_totals(
    answers: List[Dict[str, Any]],
) -> tuple[float, float, Optional[float]]:
    total_points_possible = sum(
        coerce_float(answer.get("points_possible"), 0.0) for answer in answers
    )
    total_points_earned = sum(derive_answer_points(answer) for answer in answers)
    score = (
        round((total_points_earned / total_points_possible) * 100, 2)
        if total_points_possible > 0
        else None
    )
    return round(total_points_earned, 2), round(total_points_possible, 2), score


def build_empty_progress_response(
    *, assignment_id: str, student_id: str, tutor_id: str, seed_time: datetime
) -> Progress:
    return Progress(
        id="",
        assignment_id=assignment_id,
        student_id=student_id,
        tutor_id=tutor_id,
        attempt_number=0,
        status=SubmissionStatus.IN_PROGRESS,
        answers=[],
        started_at=seed_time,
        submitted_at=None,
        time_spent=0,
        score=None,
        points_earned=0.0,
        points_possible=0.0,
        feedback=None,
        graded_at=None,
        graded_by=None,
        results_released_at=None,
        results_released_by=None,
        created_at=seed_time,
        updated_at=seed_time,
    )


async def get_authorized_student_record(
    database: AsyncIOMotorDatabase,
    *,
    student_id: str,
    current_user: ClerkUserContext,
) -> Dict[str, Any]:
    student = await database.students.find_one({"clerk_id": student_id})
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    student_tutor_id = str(student.get("tutor_id") or "").strip()

    if current_user.is_super_admin:
        return student

    if current_user.role == UserRole.TUTOR:
        if student_tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Student does not belong to your tenant",
            )
        return student

    if current_user.role == UserRole.STUDENT:
        if student_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: You can only view your own data",
            )
        return student

    if current_user.role == UserRole.PARENT:
        linked_student_ids = set(current_user.student_ids or [])
        reciprocal_parent_ids = set(student.get("parent_ids") or [])
        if (
            student_id not in linked_student_ids
            or current_user.clerk_id not in reciprocal_parent_ids
        ):
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: This student is not your child",
            )
        if (
            current_user.tutor_id
            and student_tutor_id
            and student_tutor_id != current_user.tutor_id
        ):
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Student does not belong to your tenant",
            )
        return student

    raise HTTPException(status_code=403, detail="Access forbidden")
