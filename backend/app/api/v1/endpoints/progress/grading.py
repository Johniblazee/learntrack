"""Grading endpoints: list submissions, grade, release results."""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.models.progress import (
    Progress,
    ProgressUpdate,
    GradeSubmissionRequest,
    AnswerType,
    SubmissionStatus,
)
from app.models.activity import ActivityType
from app.models.notification import NotificationType
from app.services.progress_service import ProgressService
from app.core.utils import to_object_id

from ._shared import (
    coerce_float,
    create_notification_event,
    derive_submission_totals,
    record_activity_event,
)

logger = structlog.get_logger()
router = APIRouter()


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
        assignment_question_lookup = {
            str(question.get("question_id")): question
            for question in assignment.get("questions", []) or []
            if question.get("question_id")
        }
        answers = []
        pending_manual_review_count = 0

        for raw_answer in doc.get("answers", []) or []:
            question_id = str(raw_answer.get("question_id") or "")
            assignment_question = assignment_question_lookup.get(question_id, {})
            question_snapshot = assignment_question.get("snapshot") or {}
            requires_manual_review = bool(raw_answer.get("requires_manual_review"))
            if requires_manual_review and raw_answer.get("reviewed_at") is None:
                pending_manual_review_count += 1

            answers.append(
                {
                    **raw_answer,
                    "question_id": question_id,
                    "question_text": raw_answer.get("question_text")
                    or question_snapshot.get("question_text"),
                    "question_type": raw_answer.get("question_type")
                    or question_snapshot.get("question_type"),
                    "points_possible": raw_answer.get("points_possible")
                    if raw_answer.get("points_possible") is not None
                    else assignment_question.get("points", 1),
                    "auto_points_earned": raw_answer.get("auto_points_earned")
                    if raw_answer.get("auto_points_earned") is not None
                    else raw_answer.get("points_earned"),
                    "final_points_earned": raw_answer.get("final_points_earned")
                    if raw_answer.get("final_points_earned") is not None
                    else raw_answer.get("points_earned"),
                    "requires_manual_review": requires_manual_review,
                }
            )

        response_items.append(
            {
                "_id": str(doc.get("_id")),
                "assignment_id": {
                    "_id": assignment_id,
                    "title": assignment.get("title", "Untitled Assignment"),
                    "subject_id": {
                        "name": subject.get("name", "General"),
                    },
                    "questions": assignment.get("questions", []),
                },
                "student_id": {
                    "_id": student.get("clerk_id", doc.get("student_id")),
                    "clerk_id": student.get("clerk_id", doc.get("student_id")),
                    "name": student.get("name", "Unknown Student"),
                    "email": student.get("email", ""),
                },
                "answers": answers,
                "score": doc.get("score"),
                "status": "pending"
                if doc.get("status") == SubmissionStatus.SUBMITTED.value
                else "graded",
                "submitted_at": doc.get("submitted_at") or doc.get("updated_at"),
                "graded_at": doc.get("graded_at"),
                "feedback": doc.get("feedback"),
                "pending_manual_review_count": pending_manual_review_count,
                "results_released_at": doc.get("results_released_at"),
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

    raw_existing_status = existing.get("status")
    existing_status = (
        str(raw_existing_status.value or "").strip().lower()
        if isinstance(raw_existing_status, Enum)
        else str(raw_existing_status or "").strip().lower()
    )
    if existing_status not in {
        SubmissionStatus.SUBMITTED.value,
        SubmissionStatus.GRADED.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted work can be graded",
        )

    existing_answers = list(existing.get("answers") or [])
    review_map = {
        str(review.question_id): review
        for review in (grade_data.answer_reviews or [])
        if str(review.question_id).strip()
    }
    now = datetime.now(timezone.utc)
    updated_answers: List[Dict[str, Any]] = []
    missing_manual_reviews: List[str] = []

    for raw_answer in existing_answers:
        answer = dict(raw_answer)
        question_id = str(answer.get("question_id") or "")
        points_possible = coerce_float(answer.get("points_possible"), 0.0)
        requires_manual_review = bool(answer.get("requires_manual_review"))
        auto_points_earned = coerce_float(
            answer.get("auto_points_earned", answer.get("points_earned")),
            0.0,
        )
        final_points_earned = coerce_float(
            answer.get("final_points_earned", answer.get("points_earned")),
            auto_points_earned,
        )
        manual_points_earned = answer.get("manual_points_earned")

        if requires_manual_review:
            review = review_map.get(question_id)
            if review is None:
                if answer.get("reviewed_at") is None:
                    missing_manual_reviews.append(question_id)
                updated_answers.append(answer)
                continue

            clamped_manual_points = min(
                max(float(review.manual_points_earned), 0.0),
                points_possible,
            )
            manual_points_earned = round(clamped_manual_points, 2)
            final_points_earned = manual_points_earned

            if final_points_earned >= points_possible and points_possible > 0:
                answer_type = AnswerType.CORRECT.value
            elif final_points_earned <= 0:
                answer_type = AnswerType.INCORRECT.value
            else:
                answer_type = AnswerType.PARTIAL.value

            answer.update(
                {
                    "answer_type": answer_type,
                    "manual_points_earned": manual_points_earned,
                    "final_points_earned": round(final_points_earned, 2),
                    "points_earned": round(final_points_earned, 2),
                    "review_comment": (review.review_comment or "").strip() or None,
                    "reviewed_at": now,
                    "reviewed_by": current_user.clerk_id,
                }
            )
        else:
            answer.update(
                {
                    "auto_points_earned": round(auto_points_earned, 2),
                    "final_points_earned": round(final_points_earned, 2),
                    "points_earned": round(final_points_earned, 2),
                }
            )

        updated_answers.append(answer)

    if missing_manual_reviews:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All manually reviewed answers must be scored before grading is finalized",
        )

    total_points_earned, total_points_possible, derived_score = (
        derive_submission_totals(updated_answers)
    )

    if derived_score is None and grade_data.score is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to determine a final score for this submission",
        )

    update = ProgressUpdate(
        answers=updated_answers,
        status=SubmissionStatus.GRADED,
        score=derived_score if derived_score is not None else grade_data.score,
        points_earned=total_points_earned,
        points_possible=total_points_possible,
        feedback=grade_data.feedback,
        graded_at=now,
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
        await record_activity_event(
            database,
            activity_type=ActivityType.ASSIGNMENT_COMPLETED,
            user_id=student_id,
            tutor_id=current_user.clerk_id,
            description=f"{assignment_title} was graded",
            related_entity_id=assignment_id or None,
            related_entity_type="assignment",
            metadata={
                "assignment_title": assignment_title,
                "score": updated_progress.score,
                "graded_by": current_user.clerk_id,
            },
        )

    return updated_progress


@router.post("/submissions/{progress_id}/release", response_model=Progress)
async def release_submission_results(
    progress_id: str = Path(..., description="Progress submission ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Release graded results to the student and parent surfaces."""
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

    raw_existing_status = existing.get("status")
    existing_status = (
        str(raw_existing_status.value or "").strip().lower()
        if isinstance(raw_existing_status, Enum)
        else str(raw_existing_status or "").strip().lower()
    )
    if existing_status != SubmissionStatus.GRADED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only graded submissions can be released",
        )

    if existing.get("results_released_at") is not None:
        return await progress_service.get_progress_by_id(progress_id)

    now = datetime.now(timezone.utc)
    update = ProgressUpdate(
        results_released_at=now,
        results_released_by=current_user.clerk_id,
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
                "Failed to load assignment title for release event",
                assignment_id=assignment_id,
                error=str(lookup_error),
            )

    if student_id:
        score_label = (
            f"{updated_progress.score:.0f}%"
            if isinstance(updated_progress.score, (float, int))
            else "updated"
        )
        await create_notification_event(
            database,
            recipient_id=student_id,
            tutor_id=current_user.clerk_id,
            title="Assignment results released",
            message=f"{assignment_title} results are now available with {score_label}",
            notification_type=NotificationType.ASSIGNMENT_GRADED,
            related_entity_id=assignment_id or None,
            related_entity_type="assignment",
            action_url="/dashboard/grades",
        )

    return updated_progress
