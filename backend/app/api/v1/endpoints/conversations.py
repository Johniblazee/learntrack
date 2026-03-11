"""
Conversation endpoints for chat system
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_authenticated_user, ClerkUserContext
from app.models.conversation import (
    Conversation,
    ConversationCreate,
    ConversationListResponse,
)
from app.services.conversation_service import ConversationService
from app.core.exceptions import AuthorizationError, NotFoundError, ValidationError

logger = structlog.get_logger()
router = APIRouter()


def _resolve_tenant_id(current_user: ClerkUserContext) -> str:
    return current_user.tutor_id or current_user.clerk_id


@router.post("/", response_model=Conversation, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: ConversationCreate,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Create a new conversation or return existing one

    - **participant_ids**: List of participant Clerk IDs (current user is automatically added if not included)

    If a conversation with the exact same participants already exists, it will be returned instead of creating a duplicate.
    """
    try:
        service = ConversationService(db)
        conversation = await service.create_conversation(
            conversation_data=conversation_data,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
            current_user_role=current_user.role,
        )
        return conversation
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to create conversation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create conversation",
        )


@router.get("/", response_model=ConversationListResponse)
async def list_conversations(
    limit: int = Query(
        default=50,
        ge=1,
        le=100,
        description="Maximum number of conversations to return",
    ),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    List conversations for current user

    - **limit**: Maximum number of conversations to return (1-100)
    """
    try:
        service = ConversationService(db)
        conversations = await service.list_conversations(
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
            limit=limit,
        )
        return ConversationListResponse(
            conversations=conversations, total=len(conversations)
        )
    except Exception as e:
        logger.error("Failed to list conversations", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list conversations",
        )


@router.get("/{conversation_id}", response_model=Conversation)
async def get_conversation(
    conversation_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get conversation by ID

    - **conversation_id**: Conversation ID
    """
    try:
        service = ConversationService(db)
        conversation = await service.get_conversation(
            conversation_id=conversation_id,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
        )
        return conversation
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to get conversation", error=str(e), conversation_id=conversation_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get conversation",
        )


@router.put("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_conversation_as_read(
    conversation_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Mark conversation as read (reset unread count for current user)

    - **conversation_id**: Conversation ID
    """
    try:
        service = ConversationService(db)
        await service.mark_as_read(
            conversation_id=conversation_id,
            user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
        )
        return None
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to mark conversation as read",
            error=str(e),
            conversation_id=conversation_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark conversation as read",
        )


@router.get("/unread/count", response_model=dict)
async def get_unread_count(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get total unread message count across all conversations for current user
    """
    try:
        service = ConversationService(db)
        count = await service.get_total_unread_count(
            user_id=current_user.clerk_id, tutor_id=_resolve_tenant_id(current_user)
        )
        return {"unread_count": count}
    except Exception as e:
        logger.error("Failed to get unread count", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get unread count",
        )


@router.post(
    "/with-user/{user_id}",
    response_model=Conversation,
    status_code=status.HTTP_201_CREATED,
)
async def get_or_create_conversation_with_user(
    user_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get or create a direct conversation with a specific user

    - **user_id**: Clerk ID of the user to start a conversation with

    This is a convenience endpoint that creates a 1-on-1 conversation with the specified user.
    If a conversation already exists between the two users, it will be returned.
    """
    try:
        service = ConversationService(db)

        # Create conversation data with just the target user
        # The service will automatically add the current user
        conversation_data = ConversationCreate(participant_ids=[user_id])

        conversation = await service.create_conversation(
            conversation_data=conversation_data,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
            current_user_role=current_user.role,
        )
        return conversation
    except AuthorizationError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to get or create conversation", error=str(e), user_id=user_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get or create conversation",
        )
