"""
Message model for real-time chat system
"""

from datetime import datetime, timezone
from typing import Optional, List
from pydantic import BaseModel, Field
from enum import Enum

from app.models.user import UserRole


class MessageType(str, Enum):
    """Message types"""

    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    SYSTEM = "system"


class MessageDeliveryMethod(str, Enum):
    """Delivery channels for messages"""

    CHAT = "chat"
    EMAIL = "email"


class MessageCreate(BaseModel):
    """Message creation model"""

    conversation_id: str = Field(..., description="Conversation ID")
    content: str = Field(..., description="Message content")
    message_type: MessageType = Field(
        default=MessageType.TEXT, description="Message type"
    )
    delivery_method: MessageDeliveryMethod = Field(
        default=MessageDeliveryMethod.CHAT,
        description="Delivery method (chat or email)",
    )
    subject: Optional[str] = Field(
        default=None,
        description="Optional subject when sent as email",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "conversation_id": "507f1f77bcf86cd799439011",
                "content": "Hello! How can I help you today?",
                "message_type": "text",
                "delivery_method": "chat",
            }
        }


class MessageUpdate(BaseModel):
    """Message update model"""

    content: Optional[str] = Field(None, description="Updated message content")

    class Config:
        json_schema_extra = {"example": {"content": "Updated message content"}}


class Message(BaseModel):
    """Message response model"""

    id: str = Field(..., alias="_id", description="Message ID")
    conversation_id: str = Field(..., description="Conversation ID")
    sender_id: str = Field(..., description="Sender's Clerk ID")
    sender_name: str = Field(..., description="Sender's name")
    sender_role: UserRole = Field(..., description="Sender's role")
    content: str = Field(..., description="Message content")
    message_type: MessageType = Field(
        default=MessageType.TEXT, description="Message type"
    )
    delivery_method: MessageDeliveryMethod = Field(
        default=MessageDeliveryMethod.CHAT,
        description="Delivery method (chat or email)",
    )
    subject: Optional[str] = Field(
        default=None,
        description="Optional subject when sent as email",
    )
    tutor_id: str = Field(..., description="Tutor ID for tenant isolation")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Creation timestamp",
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Last update timestamp",
    )
    edited: bool = Field(default=False, description="Whether message was edited")
    read_by: List[str] = Field(
        default_factory=list, description="List of user IDs who read the message"
    )
    deleted: bool = Field(default=False, description="Whether message is deleted")

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "_id": "507f1f77bcf86cd799439011",
                "conversation_id": "507f1f77bcf86cd799439012",
                "sender_id": "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m",
                "sender_name": "Dr. Evelyn Reed",
                "sender_role": "tutor",
                "content": "Hello! How can I help you today?",
                "message_type": "text",
                "delivery_method": "chat",
                "tutor_id": "user_2j5d1oZaP8cE7b6aF4gH3i2kL1m",
                "created_at": "2024-01-15T10:30:00Z",
                "updated_at": "2024-01-15T10:30:00Z",
                "edited": False,
                "read_by": ["user_2j5d1oZaP8cE7b6aF4gH3i2kL1m"],
                "deleted": False,
            }
        }


class MessageListResponse(BaseModel):
    """Response for listing messages"""

    messages: List[Message] = Field(..., description="List of messages")
    total: int = Field(..., description="Total number of messages")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Number of messages per page")
    has_more: bool = Field(..., description="Whether there are more messages")

    class Config:
        json_schema_extra = {
            "example": {
                "messages": [],
                "total": 100,
                "page": 1,
                "page_size": 50,
                "has_more": True,
            }
        }
