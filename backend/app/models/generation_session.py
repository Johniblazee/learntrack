"""
Generation Session Model

Stores question generation sessions for persistence and resume capability.
"""

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field
from enum import Enum


class SessionStatus(str, Enum):
    """Status of a generation session"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


class QuestionStatus(str, Enum):
    """Status of a generated question"""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EDITED = "edited"


class StoredQuestion(BaseModel):
    """Question stored in session"""

    question_id: str
    type: str
    difficulty: str
    blooms_level: str
    question_text: str
    options: Optional[List[str]] = None
    correct_answer: str
    explanation: str
    source_citations: List[Dict[str, Any]] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    quality_score: Optional[float] = None
    status: QuestionStatus = QuestionStatus.PENDING
    edit_history: List[Dict[str, Any]] = Field(default_factory=list)


class SessionChatMessage(BaseModel):
    """Chat message persisted with a generation session."""

    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    referenced_question_id: Optional[str] = None


class GenerationSessionModel(BaseModel):
    """
    MongoDB model for generation sessions.

    Stores all data needed to resume or review a generation session.
    """

    id: Optional[str] = Field(default=None, alias="_id")
    session_id: str = Field(..., description="Unique session identifier")
    user_id: str = Field(..., description="Clerk user ID")
    tenant_id: str = Field(..., description="Tenant ID for multi-tenancy")

    # Generation config
    original_prompt: str
    enhanced_prompt: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)

    # Materials used
    material_ids: List[str] = Field(default_factory=list)
    retrieved_chunks: List[Dict[str, Any]] = Field(default_factory=list)

    # Generated questions
    questions: List[StoredQuestion] = Field(default_factory=list)

    # Session planning/generation chat transcript
    chat_messages: List[SessionChatMessage] = Field(default_factory=list)

    # Status tracking
    status: SessionStatus = SessionStatus.PENDING
    current_question_index: int = 0
    total_questions: int = 0

    # Thinking steps for transparency
    thinking_steps: List[Dict[str, Any]] = Field(default_factory=list)

    # Error tracking
    error_message: Optional[str] = None

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


class SessionCreate(BaseModel):
    """Request to create a new session"""

    prompt: str
    config: Dict[str, Any]
    material_ids: Optional[List[str]] = None


class SessionUpdate(BaseModel):
    """Request to update a session"""

    status: Optional[SessionStatus] = None
    questions: Optional[List[StoredQuestion]] = None
    error_message: Optional[str] = None


class SessionSummary(BaseModel):
    """Summary of a session for listing"""

    session_id: str
    status: SessionStatus
    prompt: str  # Renamed from original_prompt for frontend compatibility
    original_prompt: str  # Keep for backward compatibility
    question_count: int  # Renamed from questions_count for frontend compatibility
    questions_count: int  # Keep for backward compatibility
    approved_count: int
    pending_count: int
    rejected_count: int
    created_at: datetime
    updated_at: datetime
