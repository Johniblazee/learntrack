"""
Question models and schemas
"""

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field, validator, ConfigDict
from bson import ObjectId

from app.models.user import PyObjectId


class QuestionType(str, Enum):
    """Question types"""

    MULTIPLE_CHOICE = "multiple-choice"
    TRUE_FALSE = "true-false"
    SHORT_ANSWER = "short-answer"
    ESSAY = "essay"


class QuestionDifficulty(str, Enum):
    """Question difficulty levels"""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class QuestionStatus(str, Enum):
    """Question status"""

    DRAFT = "draft"
    PENDING = "pending"  # AI-generated questions awaiting approval
    ACTIVE = "active"
    APPROVED = "active"  # Backward-compatible alias
    REJECTED = "rejected"  # Rejected during review
    ARCHIVED = "archived"
    DELETED = "deleted"


class QuestionOption(BaseModel):
    """Multiple choice question option"""

    text: str
    is_correct: bool = False


class QuestionBase(BaseModel):
    """Base question model"""

    question_text: str
    question_type: QuestionType
    subject_id: str
    topic: str = "general"
    difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM
    points: int = 1
    explanation: Optional[str] = None
    tags: List[str] = []
    tutor_id: Optional[str] = Field(
        default=None,
        description="Tutor ID - references the tutor's Clerk user ID",
    )


class QuestionCreate(QuestionBase):
    """Question creation model"""

    options: Optional[List[QuestionOption]] = []
    correct_answer: Optional[str] = None

    @validator("options")
    def validate_options(cls, v, values):
        question_type = values.get("question_type")
        if question_type == QuestionType.MULTIPLE_CHOICE:
            if not v or len(v) < 2:
                raise ValueError(
                    "Multiple choice questions must have at least 2 options"
                )
            correct_count = sum(1 for option in v if option.is_correct)
            if correct_count != 1:
                raise ValueError(
                    "Multiple choice questions must have exactly one correct answer"
                )
        return v


class QuestionUpdate(BaseModel):
    """Question update model"""

    question_text: Optional[str] = None
    question_type: Optional[QuestionType] = None
    topic: Optional[str] = None
    difficulty: Optional[QuestionDifficulty] = None
    points: Optional[int] = None
    explanation: Optional[str] = None
    tags: Optional[List[str]] = None
    options: Optional[List[QuestionOption]] = None
    correct_answer: Optional[str] = None
    status: Optional[QuestionStatus] = None


class QuestionInDB(QuestionBase):
    """Question model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str
    options: List[QuestionOption] = []
    correct_answer: Optional[str] = None
    status: QuestionStatus = QuestionStatus.ACTIVE
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # AI Generation metadata
    ai_generated: bool = False
    ai_provider: Optional[str] = None
    ai_confidence: Optional[float] = None
    source_file: Optional[str] = None
    generation_id: Optional[str] = None  # Links questions from same generation batch

    # Approval workflow
    approved_by: Optional[str] = None  # Clerk ID of approver
    approved_at: Optional[datetime] = None
    rejected_by: Optional[str] = None  # Clerk ID of rejector
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    revision_notes: Optional[str] = None

    # Usage statistics
    times_used: int = 0
    average_score: Optional[float] = None
    attempt_count: int = 0  # Number of attempts used for calculating average_score

    # Reference materials
    reference_materials: List[str] = []  # Material IDs

    # RAG-specific fields
    source_documents: List[str] = []  # Document IDs used for generation
    source_chunks: List[Dict[str, Any]] = []  # Chunk metadata with references
    rag_context_used: Optional[str] = None  # Context fed to LLM
    web_search_used: bool = False
    web_search_results: List[Dict[str, Any]] = []
    generation_model: Optional[str] = None  # e.g., "groq/llama-3.1-70b"
    rag_generation_id: Optional[str] = None  # Links to RAG generation batch

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Question(QuestionInDB):
    """Question response model"""

    pass


class QuestionForStudent(BaseModel):
    """Question model for student (without correct answers)"""

    id: str
    question_text: str
    question_type: QuestionType
    topic: str
    difficulty: QuestionDifficulty
    points: int
    options: Optional[List[Dict[str, Any]]] = []  # Without is_correct field

    @validator("options", pre=True)
    def remove_correct_answers(cls, v):
        if v:
            return [
                {"text": option.text if hasattr(option, "text") else option["text"]}
                for option in v
            ]
        return v


class QuestionGenerationRequest(BaseModel):
    """Request for generating questions from content"""

    file_id: Optional[str] = Field(
        None,
        description="ID of uploaded file to generate questions from",
        example="507f1f77bcf86cd799439011",
    )
    text_content: Optional[str] = Field(
        None,
        description="Direct text content to generate questions from",
        example="Photosynthesis is the process by which plants convert light energy into chemical energy...",
    )
    subject: str = Field(
        ..., description="Subject area for the questions", example="Biology"
    )
    topic: str = Field(
        ..., description="Specific topic within the subject", example="Photosynthesis"
    )
    question_count: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Number of questions to generate",
        example=5,
    )
    question_types: List[QuestionType] = Field(
        default=[QuestionType.MULTIPLE_CHOICE],
        description="Types of questions to generate",
    )
    difficulty_levels: List[QuestionDifficulty] = Field(
        default=[QuestionDifficulty.MEDIUM],
        description="Difficulty levels for questions",
    )
    ai_provider: str = Field(
        default="openai",
        description="AI provider to use for generation",
        example="openai",
    )
    custom_prompt: Optional[str] = Field(
        None,
        description="Custom instructions for question generation",
        example="Focus on practical applications and real-world examples",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "text_content": "Photosynthesis is the process by which plants and other organisms convert light energy into chemical energy that can be later released to fuel the organism's activities.",
                "subject": "Biology",
                "topic": "Photosynthesis",
                "question_count": 3,
                "question_types": ["multiple-choice"],
                "difficulty_levels": ["medium"],
                "ai_provider": "openai",
                "custom_prompt": "Create questions that test understanding of the basic process and its importance",
            }
        }
    )


class QuestionGenerationResponse(BaseModel):
    """Response from question generation"""

    questions: List[QuestionCreate]
    generation_id: str
    ai_provider: str
    source_file: Optional[str] = None
    total_generated: int
    status: str = "completed"


class QuestionBatch(BaseModel):
    """Batch of AI-generated questions"""

    source_file: str
    subject_id: str
    topic: str
    ai_provider: str
    questions: List[QuestionCreate]
    processing_time: Optional[float] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
