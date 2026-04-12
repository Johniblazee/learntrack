"""Session CRUD and query endpoints."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
import structlog

from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.models.generation_session import SessionStatus, QuestionStatus

from ._shared import get_session_service

logger = structlog.get_logger()
router = APIRouter()


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Get a generation session by ID."""
    session = await session_service.get_session(session_id, current_user.clerk_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump()


@router.get("/sessions")
async def list_sessions(
    status: Optional[str] = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """List generation sessions for the current user."""
    status_enum = SessionStatus(status) if status else None
    sessions, total = await session_service.list_sessions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        status=status_enum,
        page=page,
        per_page=per_page,
    )
    return {
        "items": [s.model_dump() for s in sessions],
        "page": page,
        "per_page": per_page,
        "total": total,
    }


@router.get("/pending-questions")
async def get_pending_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Get all pending questions across all sessions for the current tutor."""
    questions, total = await session_service.get_pending_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        page=page,
        per_page=per_page,
    )
    return {"items": questions, "page": page, "per_page": per_page, "total": total}


@router.get("/all-questions")
async def get_all_questions(
    status: Optional[str] = Query(
        None, description="Filter by status: pending, approved, rejected"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=200, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Get all questions across all sessions for the current tutor."""
    status_enum = QuestionStatus(status) if status else None
    questions, total = await session_service.get_all_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        status=status_enum,
        page=page,
        per_page=per_page,
    )
    return {"items": questions, "page": page, "per_page": per_page, "total": total}


@router.get("/sessions-with-questions")
async def get_sessions_with_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=50, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Get all generation sessions with their questions and status counts."""
    sessions, total = await session_service.get_sessions_with_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        page=page,
        per_page=per_page,
    )
    return {"items": sessions, "page": page, "per_page": per_page, "total": total}
