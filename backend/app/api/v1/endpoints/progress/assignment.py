"""Student assignment progress endpoints: get, update (save), submit answers."""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, status
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_authenticated_user,
    require_student,
    ClerkUserContext,
)
from app.models.progress import (
    Progress,
    ProgressUpdate,
    ProgressCreate,
    AnswerSubmissionRequest,
    AnswerType,
    QuestionAnswer,
    SubmissionStatus,
)
from app.models.activity import ActivityType
from app.models.notification import NotificationType
from app.models.user import UserRole
from app.services.progress_service import ProgressService
from app.core.utils import to_object_id

from ._shared import (
    build_empty_progress_response,
    create_notification_event,
    get_authorized_student_record,
    is_assignment_available_to_student,
    is_progress_locked,
    normalize_text_answer,
    record_activity_event,
    sanitize_progress_for_student,
    should_auto_release_results,
)

logger = structlog.get_logger()
router = APIRouter()


@router.get("/assignment/{assignment_id}/student/{student_id}", response_model=Progress)
async def get_student_assignment_progress(
    assignment_id: str = Path(..., description="Assignment ID"),
    student_id: str = Path(..., description="Student ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get specific student's progress on an assignment."""
    try:
        student = await get_authorized_student_record(
            database,
            student_id=student_id,
            current_user=current_user,
        )

        try:
            assignment_oid = to_object_id(assignment_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid assignment ID",
            )

        student_tutor_id = str(
            student.get("tutor_id") or current_user.tenant_id
        ).strip()
        assignment = await database.assignments.find_one({"_id": assignment_oid})
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assignment not found",
            )

        if student_id not in (assignment.get("student_ids") or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this assignment",
            )

        if student_tutor_id and assignment.get("tutor_id") not in {
            None,
            student_tutor_id,
        }:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: Assignment does not belong to your tenant",
            )

        if not is_assignment_available_to_student(assignment):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assignment not found",
            )

        progress_service = ProgressService(database)
        progress = await progress_service.get_student_assignment_progress(
            student_id,
            assignment_id,
            tutor_id=student_tutor_id or None,
        )
        if not progress:
            seed_time = assignment.get("created_at") or datetime.now(timezone.utc)
            return build_empty_progress_response(
                assignment_id=assignment_id,
                student_id=student_id,
                tutor_id=student_tutor_id or student_id,
                seed_time=seed_time,
            )
        if current_user.role != UserRole.TUTOR:
            return sanitize_progress_for_student(progress)
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
    """Update progress on an assignment (student only)."""
    try:
        progress_service = ProgressService(database)

        try:
            assignment_oid = to_object_id(assignment_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid assignment ID",
            )

        assignment = await database.assignments.find_one({"_id": assignment_oid})
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assignment not found",
            )

        tenant_tutor_id = current_user.tenant_id
        if assignment.get("tutor_id") not in {None, tenant_tutor_id}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: Assignment does not belong to your tenant",
            )

        if current_user.clerk_id not in (assignment.get("student_ids") or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this assignment",
            )

        if not is_assignment_available_to_student(assignment):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assignment not found",
            )

        if (
            progress_update.status
            and progress_update.status != SubmissionStatus.IN_PROGRESS
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Students can only save assignments in progress",
            )

        if any(
            value is not None
            for value in [
                progress_update.submitted_at,
                progress_update.score,
                progress_update.points_earned,
                progress_update.points_possible,
                progress_update.feedback,
                progress_update.graded_at,
                progress_update.graded_by,
                progress_update.results_released_at,
                progress_update.results_released_by,
            ]
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Students cannot submit grading fields through save-progress",
            )

        progress = await progress_service.get_student_assignment_progress(
            current_user.clerk_id,
            assignment_id,
            tutor_id=tenant_tutor_id,
        )
        if not progress:
            progress = await progress_service.create_progress(
                ProgressCreate(
                    assignment_id=assignment_id,
                    student_id=current_user.clerk_id,
                    tutor_id=tenant_tutor_id,
                )
            )

        if is_progress_locked(progress.status):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This assignment has already been submitted",
            )

        safe_update = ProgressUpdate(
            answers=progress_update.answers,
            status=SubmissionStatus.IN_PROGRESS,
            time_spent=progress_update.time_spent,
        )
        return await progress_service.update_progress(str(progress.id), safe_update)
    except HTTPException:
        raise
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

    tenant_tutor_id = current_user.tenant_id
    if assignment.get("tutor_id") not in {None, tenant_tutor_id}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Assignment does not belong to your tenant",
        )

    assigned_students = assignment.get("student_ids", [])
    if current_user.clerk_id not in assigned_students:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this assignment",
        )

    if not is_assignment_available_to_student(assignment):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found",
        )

    progress_service = ProgressService(database)
    progress = await progress_service.get_student_assignment_progress(
        current_user.clerk_id,
        assignment_id,
        tutor_id=tenant_tutor_id,
    )
    if not progress:
        progress = await progress_service.create_progress(
            ProgressCreate(
                assignment_id=assignment_id,
                student_id=current_user.clerk_id,
                tutor_id=tenant_tutor_id,
            )
        )

    if is_progress_locked(progress.status):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This assignment has already been submitted",
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
    assignment_question_meta = {
        str(question.get("question_id")): question
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

    scored_answers: List[QuestionAnswer] = []
    total_points_earned = 0.0
    total_points_possible = 0.0
    now = datetime.now(timezone.utc)
    requires_manual_review = False

    for answer in incoming_answers:
        question_id = str(answer.question_id)
        question_doc = question_docs.get(question_id)
        assignment_question = assignment_question_meta.get(question_id, {})
        question_snapshot = assignment_question.get("snapshot") or {}

        points_possible = float(
            points_by_question.get(
                question_id, question_doc.get("points", 1) if question_doc else 1
            )
        )
        answer_type = AnswerType.UNANSWERED
        auto_points_earned = 0.0
        final_points_earned = 0.0
        answer_requires_manual_review = False

        selected_options = answer.selected_options or []
        answer_text = (answer.answer or "").strip()
        has_response = bool(answer_text or selected_options)
        question_source = question_snapshot or question_doc or {}
        question_text = str(question_source.get("question_text") or "").strip() or None
        question_type = str(question_source.get("question_type") or "").strip() or None

        if question_source:
            normalized_question_type = str(
                question_source.get("question_type", "")
            ).lower()
            correct_answer = question_source.get("correct_answer")

            if normalized_question_type == "multiple-choice":
                correct_options = [
                    normalize_text_answer(option.get("text"))
                    for option in question_source.get("options", [])
                    if option.get("is_correct")
                ]
                submitted_options = [
                    normalize_text_answer(opt) for opt in selected_options
                ]

                if (
                    submitted_options
                    and correct_options
                    and set(submitted_options) == set(correct_options)
                ):
                    answer_type = AnswerType.CORRECT
                    auto_points_earned = points_possible
                elif submitted_options:
                    answer_type = AnswerType.INCORRECT
                else:
                    answer_type = AnswerType.UNANSWERED

            elif normalized_question_type == "true-false":
                submitted_value = answer_text or (
                    selected_options[0] if selected_options else ""
                )
                if not submitted_value:
                    answer_type = AnswerType.UNANSWERED
                elif normalize_text_answer(submitted_value) == normalize_text_answer(
                    str(correct_answer or "")
                ):
                    answer_type = AnswerType.CORRECT
                    auto_points_earned = points_possible
                else:
                    answer_type = AnswerType.INCORRECT

            elif (
                normalized_question_type == "short-answer"
                and str(correct_answer or "").strip()
            ):
                if not answer_text:
                    answer_type = AnswerType.UNANSWERED
                elif normalize_text_answer(answer_text) == normalize_text_answer(
                    str(correct_answer or "")
                ):
                    answer_type = AnswerType.CORRECT
                    auto_points_earned = points_possible
                else:
                    answer_type = AnswerType.INCORRECT

            else:
                answer_type = (
                    AnswerType.PARTIAL if has_response else AnswerType.UNANSWERED
                )
                answer_requires_manual_review = has_response
        else:
            answer_type = AnswerType.PARTIAL if has_response else AnswerType.UNANSWERED
            answer_requires_manual_review = has_response

        final_points_earned = (
            0.0 if answer_requires_manual_review else auto_points_earned
        )
        total_points_possible += points_possible
        total_points_earned += final_points_earned
        requires_manual_review = requires_manual_review or answer_requires_manual_review

        scored_answers.append(
            QuestionAnswer(
                question_id=question_id,
                question_text=question_text,
                question_type=question_type,
                answer=answer.answer,
                selected_options=selected_options,
                answer_type=answer_type,
                points_earned=round(final_points_earned, 2),
                points_possible=round(points_possible, 2),
                auto_points_earned=round(auto_points_earned, 2),
                manual_points_earned=None,
                final_points_earned=round(final_points_earned, 2),
                requires_manual_review=answer_requires_manual_review,
                time_spent=answer.time_spent,
                answered_at=answer.answered_at or (now if has_response else None),
            )
        )

    score = (
        round((total_points_earned / total_points_possible) * 100, 2)
        if total_points_possible > 0
        and submission.submit_assignment
        and not requires_manual_review
        else None
    )

    auto_release_results = (
        submission.submit_assignment
        and should_auto_release_results(
            assignment,
            requires_manual_review=requires_manual_review,
        )
    )
    final_status = SubmissionStatus.IN_PROGRESS
    graded_at = None
    graded_by = None
    results_released_at = None
    results_released_by = None

    if submission.submit_assignment:
        if requires_manual_review:
            final_status = SubmissionStatus.SUBMITTED
        else:
            final_status = SubmissionStatus.GRADED
            graded_at = now
            graded_by = "system"
            if auto_release_results:
                results_released_at = now
                results_released_by = "system"

    progress_update = ProgressUpdate(
        answers=scored_answers,
        status=final_status,
        submitted_at=now if submission.submit_assignment else None,
        score=score,
        points_earned=round(total_points_earned, 2),
        points_possible=round(total_points_possible, 2),
        graded_at=graded_at,
        graded_by=graded_by,
        results_released_at=results_released_at,
        results_released_by=results_released_by,
        time_spent=sum(answer.time_spent or 0 for answer in scored_answers),
    )

    updated_progress = await progress_service.update_progress(
        str(progress.id), progress_update
    )

    if submission.submit_assignment:
        assignment_title = str(assignment.get("title") or "Assignment")
        tutor_id = str(assignment.get("tutor_id") or current_user.tenant_id)
        student_name = current_user.name or ""
        if not student_name and current_user.email:
            student_doc = await database.students.find_one(
                {"email": current_user.email, "tutor_id": tutor_id},
                {"name": 1},
            )
            if student_doc:
                student_name = str(student_doc.get("name") or "")

        await record_activity_event(
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
            await create_notification_event(
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

    return sanitize_progress_for_student(updated_progress)
