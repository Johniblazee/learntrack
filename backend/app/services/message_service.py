"""
Message service for managing chat messages
"""

from typing import Dict
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.message import Message, MessageCreate, MessageUpdate
from app.models.user import UserRole
from app.core.exceptions import NotFoundError, ValidationError

logger = structlog.get_logger()


def _parse_object_id(value: str, field_name: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception as exc:
        raise ValidationError(f"Invalid {field_name}") from exc


class MessageService:
    """Service for managing messages"""

    # Time limit for editing messages (5 minutes)
    EDIT_TIME_LIMIT = timedelta(minutes=5)

    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.collection = db.messages

    async def create_message(
        self,
        message_data: MessageCreate,
        sender_id: str,
        sender_name: str,
        sender_role: UserRole,
        tutor_id: str,
    ) -> Message:
        """
        Create a new message

        Args:
            message_data: Message creation data
            sender_id: Sender's Clerk ID
            sender_name: Sender's name
            sender_role: Sender's role
            tutor_id: Tutor ID for tenant isolation

        Returns:
            Created message
        """
        conversation_oid = _parse_object_id(
            message_data.conversation_id,
            "conversation ID",
        )

        # Verify conversation exists and user is participant
        conversation = await self.db.conversations.find_one(
            {
                "_id": conversation_oid,
                "tutor_id": tutor_id,
                "participants": sender_id,
            }
        )

        if not conversation:
            raise NotFoundError("Conversation", message_data.conversation_id)

        # Create message document
        message_doc = {
            "conversation_id": message_data.conversation_id,
            "sender_id": sender_id,
            "sender_name": sender_name,
            "sender_role": sender_role.value,
            "content": message_data.content,
            "message_type": message_data.message_type.value,
            "delivery_method": message_data.delivery_method.value,
            "subject": message_data.subject,
            "tutor_id": tutor_id,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "edited": False,
            "read_by": [sender_id],  # Sender has read their own message
            "deleted": False,
        }

        result = await self.collection.insert_one(message_doc)
        message_doc["_id"] = str(result.inserted_id)

        logger.info(
            "Message created",
            message_id=message_doc["_id"],
            conversation_id=message_data.conversation_id,
        )

        return Message(**message_doc)

    async def get_message(
        self, message_id: str, current_user_id: str, tutor_id: str
    ) -> Message:
        """
        Get message by ID

        Args:
            message_id: Message ID
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation

        Returns:
            Message
        """
        message_oid = _parse_object_id(message_id, "message ID")
        message = await self.collection.find_one(
            {"_id": message_oid, "tutor_id": tutor_id}
        )

        if not message:
            raise NotFoundError("Message", message_id)

        # Verify user is participant in conversation
        conversation_oid = _parse_object_id(
            message["conversation_id"], "conversation ID"
        )
        conversation = await self.db.conversations.find_one(
            {
                "_id": conversation_oid,
                "participants": current_user_id,
            }
        )

        if not conversation:
            raise NotFoundError("Message", message_id)

        message["_id"] = str(message["_id"])
        return Message(**message)

    async def list_messages(
        self,
        conversation_id: str,
        current_user_id: str,
        tutor_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> Dict:
        """
        List messages in a conversation (paginated)

        Args:
            conversation_id: Conversation ID
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation
            page: Page number (1-indexed)
            page_size: Number of messages per page

        Returns:
            Dict with messages, total, page, page_size, has_more
        """
        conversation_oid = _parse_object_id(conversation_id, "conversation ID")
        # Verify user is participant in conversation
        conversation = await self.db.conversations.find_one(
            {
                "_id": conversation_oid,
                "tutor_id": tutor_id,
                "participants": current_user_id,
            }
        )

        if not conversation:
            raise NotFoundError("Conversation", conversation_id)

        # Count total messages
        total = await self.collection.count_documents(
            {"conversation_id": conversation_id, "deleted": False}
        )

        # Calculate skip
        skip = (page - 1) * page_size

        # Get messages (sorted by created_at descending for pagination, then reverse)
        cursor = (
            self.collection.find({"conversation_id": conversation_id, "deleted": False})
            .sort("created_at", -1)
            .skip(skip)
            .limit(page_size)
        )

        messages = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            messages.append(Message(**doc))

        # Reverse to get chronological order
        messages.reverse()

        has_more = (skip + page_size) < total

        return {
            "messages": messages,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": has_more,
        }

    async def update_message(
        self,
        message_id: str,
        message_data: MessageUpdate,
        current_user_id: str,
        tutor_id: str,
    ) -> Message:
        """
        Update message (only by sender, within time limit)

        Args:
            message_id: Message ID
            message_data: Message update data
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation

        Returns:
            Updated message
        """
        message_oid = _parse_object_id(message_id, "message ID")
        message = await self.collection.find_one(
            {
                "_id": message_oid,
                "tutor_id": tutor_id,
                "sender_id": current_user_id,
                "deleted": False,
            }
        )

        if not message:
            raise NotFoundError("Message", message_id)

        # Check time limit
        created_at = message["created_at"]
        if datetime.now(timezone.utc) - created_at > self.EDIT_TIME_LIMIT:
            raise ValidationError(
                "Message can only be edited within 5 minutes of creation"
            )

        # Update message
        update_data = {"updated_at": datetime.now(timezone.utc), "edited": True}

        if message_data.content is not None:
            update_data["content"] = message_data.content

        await self.collection.update_one({"_id": message_oid}, {"$set": update_data})

        # Get updated message
        updated_message = await self.collection.find_one({"_id": message_oid})
        if not updated_message:
            raise NotFoundError("Message", message_id)
        updated_message["_id"] = str(updated_message["_id"])

        logger.info("Message updated", message_id=message_id)

        return Message(**updated_message)

    async def delete_message(
        self, message_id: str, current_user_id: str, tutor_id: str
    ) -> None:
        """
        Delete message (soft delete, only by sender)

        Args:
            message_id: Message ID
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation
        """
        message_oid = _parse_object_id(message_id, "message ID")
        message = await self.collection.find_one(
            {
                "_id": message_oid,
                "tutor_id": tutor_id,
                "sender_id": current_user_id,
                "deleted": False,
            }
        )

        if not message:
            raise NotFoundError("Message", message_id)

        # Soft delete
        await self.collection.update_one(
            {"_id": message_oid},
            {
                "$set": {
                    "deleted": True,
                    "content": "[Message deleted]",
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        logger.info("Message deleted", message_id=message_id)

    async def mark_as_read(self, message_id: str, user_id: str, tutor_id: str) -> str:
        """
        Mark message as read by user.

        Returns:
            The conversation ID that owns this message.

        Args:
            message_id: Message ID
            user_id: User's Clerk ID
            tutor_id: Tutor ID for tenant isolation
        """
        message_oid = _parse_object_id(message_id, "message ID")
        message = await self.collection.find_one(
            {
                "_id": message_oid,
                "tutor_id": tutor_id,
                "deleted": False,
            }
        )
        if not message:
            raise NotFoundError("Message", message_id)

        conversation_oid = _parse_object_id(
            message["conversation_id"], "conversation ID"
        )
        conversation = await self.db.conversations.find_one(
            {
                "_id": conversation_oid,
                "tutor_id": tutor_id,
                "participants": user_id,
            }
        )
        if not conversation:
            raise NotFoundError("Message", message_id)

        await self.collection.update_one(
            {"_id": message_oid, "tutor_id": tutor_id},
            {"$addToSet": {"read_by": user_id}},
        )

        return str(message["conversation_id"])
