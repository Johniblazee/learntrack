"""Save approved session questions to the tutor question bank."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.dependencies import get_database, get_question_service
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.utils import to_object_id
from app.models.generation_session import QuestionStatus
from app.models.question import (
    QuestionCreate,
    QuestionUpdate,
    QuestionStatus as BankQuestionStatus,
    QuestionType as BankQuestionType,
)

from ._shared import (
    SaveToQuestionBankRequest,
    build_mcq_options,
    build_session_chat_message,
    get_session_service,
    normalize_bank_difficulty,
    normalize_bank_question_type,
)

logger = structlog.get_logger()
router = APIRouter()


@router.post("/sessions/{session_id}/save-to-question-bank")
async def save_session_questions_to_bank(
    session_id: str,
    request: SaveToQuestionBankRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
    question_service: Any = Depends(get_question_service),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Persist approved generated session questions into the tutor question bank."""
    session = await session_service.get_session(session_id, current_user.clerk_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    selected_question_ids = set(request.question_ids or [])
    approved_questions = [
        question
        for question in session.questions
        if question.status == QuestionStatus.APPROVED
        and (not selected_question_ids or question.question_id in selected_question_ids)
    ]

    if not approved_questions:
        raise HTTPException(status_code=400, detail="No approved questions to save")

    subject_id = request.subject_id
    if not subject_id:
        configured_subject_name = (session.config or {}).get("subject")
        if configured_subject_name:
            subject_doc = await database.subjects.find_one(
                {
                    "tutor_id": current_user.clerk_id,
                    "name": configured_subject_name,
                    "is_active": True,
                }
            )
            if subject_doc and subject_doc.get("_id"):
                subject_id = str(subject_doc["_id"])

    if not subject_id:
        configured_subject_name = (session.config or {}).get("subject")
        raise HTTPException(
            status_code=400,
            detail=(
                "Unable to resolve subject_id from the session subject"
                + (f" '{configured_subject_name}'" if configured_subject_name else "")
                + ". Provide subject_id or select a valid subject before publishing."
            ),
        )

    topic = request.topic or (session.config or {}).get("topic") or "AI Generated"
    ai_provider = (session.config or {}).get("ai_provider")
    model_name = (session.config or {}).get("model_name")
    generation_model = (
        f"{ai_provider}/{model_name}" if ai_provider and model_name else model_name
    )

    saved_count = 0
    failed_items: List[Dict[str, Any]] = []
    published_map: Dict[str, str] = {}

    for question in approved_questions:
        try:
            bank_type = normalize_bank_question_type(question.type)
            bank_difficulty = normalize_bank_difficulty(question.difficulty)
            reference_materials = question.source_ids or session.material_ids

            option_payload = []
            correct_answer = question.correct_answer
            if bank_type == BankQuestionType.MULTIPLE_CHOICE:
                option_payload, correct_answer = build_mcq_options(
                    question.options,
                    question.correct_answer,
                )

            question_update = QuestionUpdate(
                question_text=question.question_text,
                question_type=bank_type,
                subject_id=subject_id,
                topic=topic,
                difficulty=bank_difficulty,
                points=1,
                explanation=question.explanation,
                tags=question.tags,
                options=option_payload,
                correct_answer=correct_answer,
                status=BankQuestionStatus.ACTIVE,
            )

            if question.published_question_id:
                try:
                    await question_service.get_question_by_id(
                        question.published_question_id,
                        tutor_id=current_user.clerk_id,
                    )
                    metadata_update = question_update.model_dump(exclude_unset=True)
                    metadata_update.update(
                        {
                            "status": BankQuestionStatus.ACTIVE.value,
                            "approved_by": current_user.clerk_id,
                            "approved_at": question.reviewed_at
                            or datetime.now(timezone.utc),
                            "ai_generated": True,
                            "ai_provider": ai_provider,
                            "ai_confidence": question.quality_score,
                            "reference_materials": reference_materials,
                            "source_documents": reference_materials,
                            "source_chunks": question.source_citations,
                            "generation_model": generation_model,
                            "generation_id": session_id,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    )
                    await question_service.collection.update_one(
                        {
                            "_id": to_object_id(question.published_question_id),
                            "tutor_id": current_user.clerk_id,
                        },
                        {"$set": metadata_update},
                    )
                except Exception:
                    question.published_question_id = None

            if not question.published_question_id:
                payload = QuestionCreate(
                    question_text=question.question_text,
                    question_type=bank_type,
                    subject_id=subject_id,
                    topic=topic,
                    difficulty=bank_difficulty,
                    points=1,
                    explanation=question.explanation,
                    tags=question.tags,
                    tutor_id=current_user.clerk_id,
                    options=option_payload,
                    correct_answer=correct_answer,
                )

                saved_question = await question_service.create_question(
                    question_data=payload,
                    tutor_id=current_user.clerk_id,
                    ai_generated=True,
                    generation_id=session_id,
                    extra_fields={
                        "status": BankQuestionStatus.ACTIVE.value,
                        "approved_by": current_user.clerk_id,
                        "approved_at": question.reviewed_at
                        or datetime.now(timezone.utc),
                        "ai_generated": True,
                        "ai_provider": ai_provider,
                        "ai_confidence": question.quality_score,
                        "reference_materials": reference_materials,
                        "source_documents": reference_materials,
                        "source_chunks": question.source_citations,
                        "generation_model": generation_model,
                    },
                )
                question.published_question_id = str(saved_question.id)

            published_map[question.question_id] = str(question.published_question_id)
            saved_count += 1
        except Exception as exc:
            failed_items.append(
                {"question_id": question.question_id, "reason": str(exc)}
            )

    if published_map:
        await session_service.mark_questions_published(
            session_id=session_id,
            user_id=current_user.clerk_id,
            published_map=published_map,
        )
        await session_service.append_chat_message(
            session_id,
            current_user.clerk_id,
            build_session_chat_message(
                "assistant",
                f"Published {len(published_map)} approved question(s) to the question bank.",
            ),
        )

    return {
        "session_id": session_id,
        "requested": len(approved_questions),
        "saved_count": saved_count,
        "published_count": saved_count,
        "failed_count": len(failed_items),
        "failed_items": failed_items,
        "published_items": published_map,
    }
