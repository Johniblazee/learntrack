"""Question/session CRUD and stats endpoints."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.dependencies import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext

from ._shared import (
    UpdateQuestionRequest,
    get_session_service,
    _create_tenant_config_service,
)

logger = structlog.get_logger()
router = APIRouter()


@router.put("/sessions/{session_id}/questions/{question_id}")
async def update_question(
    session_id: str,
    question_id: str,
    request: UpdateQuestionRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Manually update a question's content."""
    update_data = {}
    if request.question_text is not None:
        update_data["question_text"] = request.question_text
    if request.options is not None:
        update_data["options"] = request.options
    if request.correct_answer is not None:
        update_data["correct_answer"] = request.correct_answer
    if request.explanation is not None:
        update_data["explanation"] = request.explanation

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    success = await session_service.update_question_content(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        update_data=update_data,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question updated", "question_id": question_id}


@router.delete("/sessions/{session_id}/questions/{question_id}")
async def delete_session_question(
    session_id: str,
    question_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Delete a generated draft question from a session."""
    success = await session_service.delete_question(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question deleted", "question_id": question_id}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Delete a generation session and all its questions."""
    success = await session_service.delete_session(
        session_id=session_id, user_id=current_user.clerk_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted", "session_id": session_id}


@router.get("/stats")
async def get_generation_stats(
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Get generation statistics for the current user."""
    stats = await session_service.get_stats(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
    )
    return stats


@router.get("/available-models")
async def get_available_models(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get the tenant-approved AI providers and models for question generation."""
    from app.ai.services.tenant_ai_resolver import PROVIDER_DESCRIPTIONS

    service = _create_tenant_config_service(database)
    providers = await service.get_tutor_provider_status(current_user.tutor_id)
    return {
        "providers": [
            {
                "id": provider.provider_id,
                "name": provider.name,
                "description": PROVIDER_DESCRIPTIONS.get(
                    provider.provider_id, provider.name
                ),
                "available": provider.available,
                "has_byok_key": provider.has_custom_key,
                "key_source": provider.key_source,
                "models": [
                    {
                        "id": model.model_id,
                        "name": model.name,
                        "description": model.description,
                        "available": model.available,
                        "context_window": model.context_window,
                        "priority": model.priority,
                    }
                    for model in provider.models
                ],
            }
            for provider in providers
        ]
    }
