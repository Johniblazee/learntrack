"""Question review endpoints: approve, reject, request-revision."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
import structlog

from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.exceptions import ValidationError
from app.models.generation_session import QuestionStatus

from ._shared import get_session_service

logger = structlog.get_logger()
router = APIRouter()


@router.post("/sessions/{session_id}/questions/{question_id}/approve")
async def approve_question(
    session_id: str,
    question_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Approve a generated draft question for publishing."""
    try:
        success = await session_service.update_question_status(
            session_id=session_id,
            user_id=current_user.clerk_id,
            question_id=question_id,
            status=QuestionStatus.APPROVED,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Question not found")
        return {"message": "Question approved for publishing", "question_id": question_id}
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sessions/{session_id}/questions/{question_id}/reject")
async def reject_question(
    session_id: str,
    question_id: str,
    reason: Optional[str] = Query(None, description="Optional rejection reason"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Reject a generated question."""
    try:
        success = await session_service.update_question_status(
            session_id=session_id,
            user_id=current_user.clerk_id,
            question_id=question_id,
            status=QuestionStatus.REJECTED,
            review_comments=reason,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Question not found")
        return {"message": "Question rejected", "question_id": question_id}
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sessions/{session_id}/questions/{question_id}/request-revision")
async def request_question_revision(
    session_id: str,
    question_id: str,
    notes: str = Query(..., description="Revision guidance for the draft"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Attach review guidance while keeping the draft in the review queue."""
    try:
        success = await session_service.request_question_revision(
            session_id=session_id,
            user_id=current_user.clerk_id,
            question_id=question_id,
            notes=notes,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Question not found")
        return {
            "message": "Revision requested",
            "question_id": question_id,
            "review_comments": notes,
        }
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
