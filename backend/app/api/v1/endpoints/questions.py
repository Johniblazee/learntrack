"""
Question management endpoints
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, Path, Query, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.dependencies import get_question_service
from app.core.enhanced_auth import (
    require_tutor,
    require_authenticated_user,
    ClerkUserContext,
)
from app.core.rate_limit import limiter, RATE_LIMITS
from app.models.question import (
    Question,
    QuestionCreate,
    QuestionUpdate,
    QuestionForStudent,
)
from app.services.question_service import QuestionService
from app.services.user_service import UserService
from app.utils.pagination import PaginatedResponse, paginate

logger = structlog.get_logger()
router = APIRouter()


@router.post("/", response_model=Question)
async def create_question(
    question_data: QuestionCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Create a new question"""
    try:
        question = await question_service.create_question(
            question_data, current_user.clerk_id
        )
        return question
    except Exception as e:
        logger.error("Failed to create question", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create question")


@router.get("/", response_model=PaginatedResponse[Question])
async def get_questions(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    topic: Optional[str] = Query(None, description="Filter by topic"),
    difficulty: Optional[str] = Query(None, description="Filter by difficulty"),
    question_type: Optional[str] = Query(None, description="Filter by question type"),
    search: Optional[str] = Query(None, description="Search in question text"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Get paginated questions with optional filters"""
    try:
        result = await question_service.get_questions_for_tutor(
            tutor_id=current_user.clerk_id,
            subject_id=subject_id,
            topic=topic,
            difficulty=difficulty,
            question_type=question_type,
            search=search,
            page=page,
            per_page=per_page,
        )
        return paginate(
            items=result["items"], page=page, per_page=per_page, total=result["total"]
        )
    except Exception as e:
        logger.error("Failed to get questions", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get questions")


# NOTE: Static routes like /pending and /generation-history must be defined BEFORE /{question_id}
# to avoid being caught by the dynamic route


@router.get("/pending", response_model=PaginatedResponse[Question])
async def get_pending_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Get paginated pending questions awaiting approval"""
    try:
        result = await question_service.get_questions_for_tutor(
            tutor_id=current_user.clerk_id,
            status="pending",
            page=page,
            per_page=per_page,
        )
        return paginate(
            items=result["items"], page=page, per_page=per_page, total=result["total"]
        )
    except Exception as e:
        logger.error("Failed to get pending questions", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get pending questions")


@router.get("/generation-history", response_model=PaginatedResponse[Question])
async def get_generation_history(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Get AI-generated questions history (both pending and approved)"""
    try:
        result = await question_service.get_generation_history(
            tutor_id=current_user.clerk_id, page=page, per_page=per_page
        )
        return paginate(
            items=result["items"], page=page, per_page=per_page, total=result["total"]
        )
    except Exception as e:
        logger.error("Failed to get generation history", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get generation history")


@router.get("/{question_id}", response_model=Question)
async def get_question(
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    question_service: QuestionService = Depends(get_question_service),
):
    """Get question by ID"""
    try:
        question = await question_service.get_question_by_id(
            question_id, current_user.clerk_id
        )
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")
        return question
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get question", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get question")


@router.get("/{question_id}/student", response_model=QuestionForStudent)
async def get_question_for_student(
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    question_service: QuestionService = Depends(get_question_service),
):
    """Get question for student (without correct answers)"""
    try:
        question = await question_service.get_question_for_student(
            question_id, current_user.clerk_id
        )
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")
        return question
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get question for student", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get question")


@router.put("/{question_id}", response_model=Question)
async def update_question(
    question_update: QuestionUpdate,
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Update question"""
    try:
        question = await question_service.update_question(
            question_id, question_update, current_user.clerk_id
        )
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")
        return question
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update question", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update question")


@router.delete("/{question_id}")
async def delete_question(
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Delete question"""
    try:
        success = await question_service.delete_question(
            question_id, current_user.clerk_id
        )
        if not success:
            raise HTTPException(status_code=404, detail="Question not found")
        return {"message": "Question deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete question", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to delete question")


@router.put("/{question_id}/approve", response_model=Question)
async def approve_question(
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Approve a pending question"""
    try:
        question = await question_service.approve_question(
            question_id, current_user.clerk_id
        )
        return question
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to approve question", question_id=question_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{question_id}/reject", response_model=Question)
async def reject_question(
    question_id: str = Path(..., description="Question ID"),
    reason: Optional[str] = Query(None, description="Rejection reason"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Reject a pending question"""
    try:
        question = await question_service.reject_question(
            question_id, current_user.clerk_id, reason
        )
        return question
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to reject question", question_id=question_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{question_id}/request-revision", response_model=Question)
async def request_revision(
    question_id: str = Path(..., description="Question ID"),
    notes: str = Query(..., description="Revision notes"),
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Request revision for a pending question"""
    try:
        question = await question_service.request_revision(
            question_id, current_user.clerk_id, notes
        )
        return question
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to request revision", question_id=question_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-approve", response_model=dict)
@limiter.limit(RATE_LIMITS["bulk"])
async def bulk_approve_questions(
    request: Request,
    question_ids: List[str],
    current_user: ClerkUserContext = Depends(require_tutor),
    question_service: QuestionService = Depends(get_question_service),
):
    """Approve multiple questions at once"""
    try:
        result = await question_service.bulk_approve_questions(
            question_ids, current_user.clerk_id
        )
        return {
            "approved_count": result.get("approved_count", 0),
            "total_requested": len(question_ids),
        }
    except Exception as e:
        logger.error("Failed to bulk approve questions", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to bulk approve questions")
