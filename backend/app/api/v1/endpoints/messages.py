"""
Message endpoints for chat system
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, Path
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from pydantic import BaseModel, Field
from bson import ObjectId

from app.core.database import get_database
from app.core.enhanced_auth import require_authenticated_user, ClerkUserContext
from app.models.activity import ActivityCreate, ActivityType
from app.models.message import (
    Message,
    MessageCreate,
    MessageDeliveryMethod,
    MessageType,
    MessageUpdate,
    MessageListResponse,
)
from app.models.conversation import ConversationCreate
from app.models.notification import NotificationCreate, NotificationType
from app.services.activity_service import ActivityService
from app.services.message_service import MessageService
from app.services.conversation_service import ConversationService
from app.services.email_service import EmailService
from app.services.notification_service import NotificationService
from app.core.exceptions import NotFoundError, ValidationError

logger = structlog.get_logger()
router = APIRouter()


def _resolve_tenant_id(current_user: ClerkUserContext) -> str:
    return current_user.tutor_id or current_user.clerk_id


def _sender_name(current_user: ClerkUserContext) -> str:
    return current_user.name or "Unknown User"


def _message_preview(content: str, limit: int = 120) -> str:
    normalized = " ".join((content or "").split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 3].rstrip()}..."


async def _record_message_activity(
    db: AsyncIOMotorDatabase,
    *,
    sender_id: str,
    tutor_id: str,
    conversation_id: str,
    delivery_method: MessageDeliveryMethod,
    description: str,
) -> None:
    try:
        activity_service = ActivityService(db)
        await activity_service.create_activity(
            activity_data=ActivityCreate(
                activity_type=ActivityType.MESSAGE_SENT,
                user_id=sender_id,
                tutor_id=tutor_id,
                description=description,
                related_entity_id=conversation_id,
                related_entity_type="conversation",
                metadata={
                    "delivery_method": delivery_method.value,
                },
            ),
            user_id=sender_id,
            tutor_id=tutor_id,
        )
    except Exception as error:
        logger.warning(
            "Failed to record message activity",
            conversation_id=conversation_id,
            sender_id=sender_id,
            error=str(error),
        )


async def _notify_recipient(
    db: AsyncIOMotorDatabase,
    *,
    recipient_id: str,
    sender_id: str,
    sender_name: str,
    tutor_id: str,
    conversation_id: str,
    delivery_method: MessageDeliveryMethod,
    preview: str,
) -> None:
    if not recipient_id or recipient_id == sender_id:
        return

    title = (
        f"New email from {sender_name}"
        if delivery_method == MessageDeliveryMethod.EMAIL
        else f"New message from {sender_name}"
    )
    action_url = (
        "/dashboard/messages?mode=email"
        if delivery_method == MessageDeliveryMethod.EMAIL
        else "/dashboard/messages?mode=chat"
    )

    try:
        notification_service = NotificationService(db)
        await notification_service.create_notification(
            NotificationCreate(
                title=title,
                message=preview,
                notification_type=NotificationType.MESSAGE_RECEIVED,
                recipient_id=recipient_id,
                tutor_id=tutor_id,
                related_entity_id=conversation_id,
                related_entity_type="conversation",
                action_url=action_url,
            )
        )
    except Exception as error:
        logger.warning(
            "Failed to create message notification",
            recipient_id=recipient_id,
            sender_id=sender_id,
            conversation_id=conversation_id,
            error=str(error),
        )


async def _notify_conversation_participants(
    db: AsyncIOMotorDatabase,
    *,
    conversation_id: str,
    sender_id: str,
    sender_name: str,
    tutor_id: str,
    delivery_method: MessageDeliveryMethod,
    preview: str,
) -> None:
    conversation = None
    try:
        conversation = await db.conversations.find_one(
            {
                "_id": ObjectId(conversation_id),
                "tutor_id": tutor_id,
            }
        )
    except Exception as error:
        logger.warning(
            "Failed to load conversation for notification",
            conversation_id=conversation_id,
            error=str(error),
        )
        return

    participant_ids = [
        participant
        for participant in (conversation or {}).get("participants", [])
        if isinstance(participant, str)
    ]

    for recipient_id in participant_ids:
        await _notify_recipient(
            db,
            recipient_id=recipient_id,
            sender_id=sender_id,
            sender_name=sender_name,
            tutor_id=tutor_id,
            conversation_id=conversation_id,
            delivery_method=delivery_method,
            preview=preview,
        )


async def _find_user_by_clerk_id(
    db: AsyncIOMotorDatabase, clerk_id: str
) -> Optional[dict]:
    collections = [db.users, db.tutors, db.students, db.parents]
    for collection in collections:
        user = await collection.find_one({"clerk_id": clerk_id})
        if user:
            return user
    return None


class SendEmailMessageRequest(BaseModel):
    recipient_id: str = Field(..., description="Recipient Clerk user ID")
    subject: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)


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
        tenant_id = _resolve_tenant_id(current_user)
        sender_name = _sender_name(current_user)

        service = MessageService(db)
        message = await service.create_message(
            message_data=message_data,
            sender_id=current_user.clerk_id,
            sender_name=sender_name,
            sender_role=current_user.role,
            tutor_id=tenant_id,
        )

        # Update conversation's last message
        conversation_service = ConversationService(db)
        await conversation_service.update_last_message(
            conversation_id=message_data.conversation_id,
            message_content=message_data.content,
            sender_id=current_user.clerk_id,
            delivery_method=message_data.delivery_method.value,
        )

        preview = _message_preview(message_data.content)
        await _record_message_activity(
            db,
            sender_id=current_user.clerk_id,
            tutor_id=tenant_id,
            conversation_id=message_data.conversation_id,
            delivery_method=message_data.delivery_method,
            description=(
                f"Sent an email: {preview}"
                if message_data.delivery_method == MessageDeliveryMethod.EMAIL
                else f"Sent a message: {preview}"
            ),
        )
        await _notify_conversation_participants(
            db,
            conversation_id=message_data.conversation_id,
            sender_id=current_user.clerk_id,
            sender_name=sender_name,
            tutor_id=tenant_id,
            delivery_method=message_data.delivery_method,
            preview=preview,
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


@router.post("/email", response_model=Message, status_code=status.HTTP_201_CREATED)
async def send_email_message(
    email_data: SendEmailMessageRequest,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Send a message via email and store it in conversation history."""
    try:
        tenant_id = _resolve_tenant_id(current_user)
        conversation_service = ConversationService(db)

        conversation = await conversation_service.create_conversation(
            conversation_data=ConversationCreate(
                participant_ids=[email_data.recipient_id],
            ),
            current_user_id=current_user.clerk_id,
            tutor_id=tenant_id,
            current_user_role=current_user.role,
        )

        recipient = await _find_user_by_clerk_id(db, email_data.recipient_id)
        if not recipient or not recipient.get("email"):
            raise ValidationError("Recipient email not found")

        delivery_result = EmailService.send_direct_message_email(
            to_email=str(recipient.get("email")),
            to_name=str(recipient.get("name") or "Learner"),
            from_name=_sender_name(current_user),
            subject=email_data.subject,
            content=email_data.content,
        )

        if not delivery_result.delivered:
            logger.warning(
                "Email provider delivery failed",
                recipient_id=email_data.recipient_id,
                recipient_email=str(recipient.get("email") or ""),
                provider=delivery_result.provider,
                error=delivery_result.error,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=delivery_result.error or "Failed to deliver email via Plunk",
            )

        logger.info(
            "Email provider delivery succeeded",
            recipient_id=email_data.recipient_id,
            recipient_email=str(recipient.get("email") or ""),
            provider=delivery_result.provider,
            provider_message_id=delivery_result.provider_message_id,
        )

        message_service = MessageService(db)
        message = await message_service.create_message(
            message_data=MessageCreate(
                conversation_id=conversation.id,
                content=email_data.content,
                message_type=MessageType.TEXT,
                delivery_method=MessageDeliveryMethod.EMAIL,
                subject=email_data.subject,
            ),
            sender_id=current_user.clerk_id,
            sender_name=_sender_name(current_user),
            sender_role=current_user.role,
            tutor_id=tenant_id,
        )

        await conversation_service.update_last_message(
            conversation_id=conversation.id,
            message_content=f"Email: {email_data.subject}",
            sender_id=current_user.clerk_id,
            delivery_method=MessageDeliveryMethod.EMAIL.value,
        )

        preview = _message_preview(email_data.subject)
        await _record_message_activity(
            db,
            sender_id=current_user.clerk_id,
            tutor_id=tenant_id,
            conversation_id=conversation.id,
            delivery_method=MessageDeliveryMethod.EMAIL,
            description=f"Sent an email: {preview}",
        )
        await _notify_recipient(
            db,
            recipient_id=email_data.recipient_id,
            sender_id=current_user.clerk_id,
            sender_name=_sender_name(current_user),
            tutor_id=tenant_id,
            conversation_id=conversation.id,
            delivery_method=MessageDeliveryMethod.EMAIL,
            preview=preview,
        )

        return message
    except HTTPException:
        raise
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to send email message", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send email message",
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
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(
            "Failed to mark message as read", error=str(e), message_id=message_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark message as read",
        )
