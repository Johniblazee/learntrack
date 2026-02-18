"""
Message endpoints for chat system
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Path
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import require_authenticated_user, ClerkUserContext
from app.models.message import (
    Message,
    MessageCreate,
    MessageUpdate,
    MessageListResponse,
)
from app.services.message_service import MessageService
from app.services.conversation_service import ConversationService
from app.core.exceptions import NotFoundError, ValidationError

logger = structlog.get_logger()
router = APIRouter()


def _resolve_tenant_id(current_user: ClerkUserContext) -> str:
    return current_user.tutor_id or current_user.clerk_id


def _sender_name(current_user: ClerkUserContext) -> str:
    return current_user.name or "Unknown User"


@router.post("/", response_model=Message, status_code=status.HTTP_201_CREATED)
async def create_message(
    message_data: MessageCreate,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Create a new message (HTTP fallback, prefer WebSocket for real-time)

    - **conversation_id**: Conversation ID
    - **content**: Message content
    - **message_type**: Message type (text, image, file, system)
    """
    try:
        service = MessageService(db)
        message = await service.create_message(
            message_data=message_data,
            sender_id=current_user.clerk_id,
            sender_name=_sender_name(current_user),
            sender_role=current_user.role,
            tutor_id=_resolve_tenant_id(current_user),
        )

        # Update conversation's last message
        conversation_service = ConversationService(db)
        await conversation_service.update_last_message(
            conversation_id=message_data.conversation_id,
            message_content=message_data.content,
            sender_id=current_user.clerk_id,
        )

        return message
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to create message", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create message",
        )


@router.get("/conversation/{conversation_id}", response_model=MessageListResponse)
async def list_messages(
    conversation_id: str = Path(..., description="Conversation ID"),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=50, ge=1, le=100, description="Number of messages per page"
    ),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    List messages in a conversation (paginated)

    - **conversation_id**: Conversation ID
    - **page**: Page number (1-indexed)
    - **page_size**: Number of messages per page (1-100)
    """
    try:
        service = MessageService(db)
        result = await service.list_messages(
            conversation_id=conversation_id,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
            page=page,
            page_size=page_size,
        )
        return MessageListResponse(**result)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to list messages", error=str(e), conversation_id=conversation_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list messages",
        )


@router.get("/{message_id}", response_model=Message)
async def get_message(
    message_id: str = Path(..., description="Message ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get message by ID

    - **message_id**: Message ID
    """
    try:
        service = MessageService(db)
        message = await service.get_message(
            message_id=message_id,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
        )
        return message
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error("Failed to get message", error=str(e), message_id=message_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get message",
        )


@router.put("/{message_id}", response_model=Message)
async def update_message(
    message_data: MessageUpdate,
    message_id: str = Path(..., description="Message ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Update message (only by sender, within 5 minutes)

    - **message_id**: Message ID
    - **content**: Updated message content
    """
    try:
        service = MessageService(db)
        message = await service.update_message(
            message_id=message_id,
            message_data=message_data,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
        )
        return message
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to update message", error=str(e), message_id=message_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update message",
        )


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: str = Path(..., description="Message ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Delete message (soft delete, only by sender)

    - **message_id**: Message ID
    """
    try:
        service = MessageService(db)
        await service.delete_message(
            message_id=message_id,
            current_user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
        )
        return None
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error("Failed to delete message", error=str(e), message_id=message_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete message",
        )


@router.put("/{message_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_message_as_read(
    message_id: str = Path(..., description="Message ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Mark message as read by current user

    - **message_id**: Message ID
    """
    try:
        service = MessageService(db)
        await service.mark_as_read(
            message_id=message_id,
            user_id=current_user.clerk_id,
            tutor_id=_resolve_tenant_id(current_user),
        )
        return None
    except Exception as e:
        logger.error(
            "Failed to mark message as read", error=str(e), message_id=message_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark message as read",
        )
