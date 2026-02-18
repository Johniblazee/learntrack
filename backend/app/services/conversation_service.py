"""
Conversation service for managing chat conversations
"""

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.conversation import Conversation, ConversationCreate
from app.models.user import UserRole
from app.core.exceptions import NotFoundError, ValidationError, AuthorizationError

logger = structlog.get_logger()


class ConversationService:
    """Service for managing conversations"""

    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.collection = db.conversations

    async def _get_user_profile_by_clerk_id(
        self, clerk_id: str
    ) -> Optional[Dict[str, Any]]:
        collections = [
            self.db.users,
            self.db.tutors,
            self.db.students,
            self.db.parents,
        ]
        for collection in collections:
            user = await collection.find_one({"clerk_id": clerk_id})
            if user:
                return user
        return None

    async def create_conversation(
        self, conversation_data: ConversationCreate, current_user_id: str, tutor_id: str
    ) -> Conversation:
        """
        Create a new conversation or return existing one

        Args:
            conversation_data: Conversation creation data
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation

        Returns:
            Created or existing conversation
        """
        # Automatically add current user to participants if not included
        participant_ids = list(set(conversation_data.participant_ids))
        if current_user_id not in participant_ids:
            participant_ids.append(current_user_id)

        # Validate we have at least 2 participants
        if len(participant_ids) < 2:
            raise ValidationError("Conversation must have at least 2 participants")

        # Check if conversation already exists with same participants
        # Use $all and $size to ensure exact match of participants
        existing = await self.collection.find_one(
            {
                "participants": {
                    "$all": participant_ids,
                    "$size": len(participant_ids),
                },
                "tutor_id": tutor_id,
            }
        )

        if existing:
            logger.info(
                "Conversation already exists", conversation_id=str(existing["_id"])
            )
            existing["_id"] = str(existing["_id"])
            return Conversation(**existing)

        # Get participant details from users collection
        participant_names = {}
        participant_roles = {}

        for participant_id in participant_ids:
            user = await self._get_user_profile_by_clerk_id(participant_id)
            if user:
                participant_names[participant_id] = str(
                    user.get("name") or "Unknown User"
                )
                role_value = user.get("role", "student")
                if isinstance(role_value, UserRole):
                    participant_roles[participant_id] = role_value.value
                else:
                    participant_roles[participant_id] = str(role_value)
            else:
                logger.warning("User not found in database", clerk_id=participant_id)
                participant_names[participant_id] = "Unknown User"
                participant_roles[participant_id] = "student"

        # Create conversation document
        conversation_doc = {
            "participants": participant_ids,
            "participant_names": participant_names,
            "participant_roles": participant_roles,
            "tutor_id": tutor_id,
            "last_message": None,
            "last_delivery_method": "chat",
            "last_message_at": None,
            "unread_count": {pid: 0 for pid in participant_ids},
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        result = await self.collection.insert_one(conversation_doc)
        conversation_doc["_id"] = str(result.inserted_id)

        logger.info("Conversation created", conversation_id=conversation_doc["_id"])

        return Conversation(**conversation_doc)

    async def get_conversation(
        self, conversation_id: str, current_user_id: str, tutor_id: str
    ) -> Conversation:
        """
        Get conversation by ID

        Args:
            conversation_id: Conversation ID
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation

        Returns:
            Conversation
        """
        conversation = await self.collection.find_one(
            {
                "_id": ObjectId(conversation_id),
                "tutor_id": tutor_id,
                "participants": current_user_id,
            }
        )

        if not conversation:
            raise NotFoundError("Conversation", conversation_id)

        conversation["_id"] = str(conversation["_id"])
        return Conversation(**conversation)

    async def list_conversations(
        self, current_user_id: str, tutor_id: str, limit: int = 50
    ) -> List[Conversation]:
        """
        List conversations for current user

        Args:
            current_user_id: Current user's Clerk ID
            tutor_id: Tutor ID for tenant isolation
            limit: Maximum number of conversations to return

        Returns:
            List of conversations
        """
        cursor = (
            self.collection.find(
                {"tutor_id": tutor_id, "participants": current_user_id}
            )
            .sort("updated_at", -1)
            .limit(limit)
        )

        conversations = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            conversations.append(Conversation(**doc))

        return conversations

    async def update_last_message(
        self,
        conversation_id: str,
        message_content: str,
        sender_id: str,
        delivery_method: str = "chat",
    ) -> None:
        """
        Update conversation's last message and increment unread count

        Args:
            conversation_id: Conversation ID
            message_content: Message content
            sender_id: Sender's Clerk ID
        """
        # Get conversation to find participants
        conversation = await self.collection.find_one(
            {"_id": ObjectId(conversation_id)}
        )
        if not conversation:
            return

        # Increment unread count for all participants except sender
        unread_updates = {}
        for participant_id in conversation["participants"]:
            if participant_id != sender_id:
                current_count = conversation.get("unread_count", {}).get(
                    participant_id, 0
                )
                unread_updates[f"unread_count.{participant_id}"] = current_count + 1

        # Update conversation
        await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {
                "$set": {
                    "last_message": message_content[:100],  # Truncate to 100 chars
                    "last_delivery_method": delivery_method,
                    "last_message_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    **unread_updates,
                }
            },
        )

    async def mark_as_read(self, conversation_id: str, user_id: str) -> None:
        """
        Mark conversation as read for user (reset unread count)

        Args:
            conversation_id: Conversation ID
            user_id: User's Clerk ID
        """
        await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {
                "$set": {
                    f"unread_count.{user_id}": 0,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def get_total_unread_count(self, user_id: str, tutor_id: str) -> int:
        """
        Get total unread message count across all conversations for user

        Args:
            user_id: User's Clerk ID
            tutor_id: Tutor ID for tenant isolation

        Returns:
            Total unread count
        """
        pipeline = [
            {"$match": {"tutor_id": tutor_id, "participants": user_id}},
            {"$project": {"unread": f"$unread_count.{user_id}"}},
            {"$group": {"_id": None, "total": {"$sum": "$unread"}}},
        ]

        result = await self.collection.aggregate(pipeline).to_list(1)
        return result[0]["total"] if result else 0

    async def validate_conversation_participants(
        self,
        participant_ids: List[str],
        current_user_id: str,
        current_user_role: UserRole,
    ) -> bool:
        """
        Validate that current user can create conversation with given participants.
        Enforces visibility rules based on role.

        Returns:
            True if valid, raises AuthorizationError if not
        """
        from app.services.visibility_service import VisibilityService

        visibility_service = VisibilityService(self.db)

        # Check each participant
        for participant_id in participant_ids:
            if participant_id == current_user_id:
                continue  # Skip self

            can_see = await visibility_service.can_user_see_user(
                current_user_id, participant_id, current_user_role
            )

            if not can_see:
                raise AuthorizationError(
                    f"Cannot create conversation with user {participant_id}: not visible to you"
                )

        return True
