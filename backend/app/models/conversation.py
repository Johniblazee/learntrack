"""
Conversation model for real-time chat system
"""

from datetime import datetime, timezone
from typing import Optional, List, Dict
from pydantic import BaseModel, Field

from app.models.user import UserRole


class ConversationCreate(BaseModel):
    """Conversation creation model"""

    participant_ids: List[str] = Field(
        ..., description="List of participant Clerk IDs (must include current user)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "participant_ids": [
                    "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m",
                    "user_3k6e2pAbQ9dF8c7bG5hI4j3lM2n",
                ]
            }
        }


class Conversation(BaseModel):
    """Conversation response model"""

    id: str = Field(..., alias="_id", description="Conversation ID")
    participants: List[str] = Field(..., description="List of participant Clerk IDs")
    participant_names: Dict[str, str] = Field(
        default_factory=dict, description="Map of clerk_id to name"
    )
    participant_roles: Dict[str, str] = Field(
        default_factory=dict, description="Map of clerk_id to role"
    )
    tutor_id: str = Field(..., description="Tutor ID for tenant isolation")
    last_message: Optional[str] = Field(None, description="Last message content")
    last_delivery_method: Optional[str] = Field(
        default="chat",
        description="Delivery method of last message (chat/email)",
    )
    last_message_at: Optional[datetime] = Field(
        None, description="Timestamp of last message"
    )
    unread_count: Dict[str, int] = Field(
        default_factory=dict, description="Unread message count per user"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Creation timestamp",
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Last update timestamp",
    )

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "_id": "507f1f77bcf86cd799439012",
                "participants": [
                    "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m",
                    "user_3k6e2pAbQ9dF8c7bG5hI4j3lM2n",
                ],
                "participant_names": {
                    "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m": "Dr. Evelyn Reed",
                    "user_3k6e2pAbQ9dF8c7bG5hI4j3lM2n": "Alex Johnson",
                },
                "participant_roles": {
                    "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m": "tutor",
                    "user_3k6e2pAbQ9dF8c7bG5hI4j3lM2n": "student",
                },
                "tutor_id": "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m",
                "last_message": "Hello! How can I help you today?",
                "last_delivery_method": "chat",
                "last_message_at": "2024-01-15T10:30:00Z",
                "unread_count": {"user_3k6e2pAbQ9dF8c7bG5hI4j3lM2n": 2},
                "created_at": "2024-01-15T10:00:00Z",
                "updated_at": "2024-01-15T10:30:00Z",
            }
        }


class ConversationListResponse(BaseModel):
    """Response for listing conversations"""

    conversations: List[Conversation] = Field(..., description="List of conversations")
    total: int = Field(..., description="Total number of conversations")

    class Config:
        json_schema_extra = {"example": {"conversations": [], "total": 10}}


class ConversationWithMessages(Conversation):
    """Conversation with recent messages"""

    recent_messages: List[Dict] = Field(
        default_factory=list, description="Recent messages in conversation"
    )

    class Config:
        populate_by_name = True
