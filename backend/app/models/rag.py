"""
RAG (Retrieval-Augmented Generation) models
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field, ConfigDict

from app.models.user import PyObjectId


class TutorRAGSettings(BaseModel):
    """RAG settings for each tutor"""
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str = Field(..., description="Tutor's Clerk user ID")

    # Web search credits
    web_search_credits: int = Field(default=100, description="Monthly web search credits")
    web_search_credits_used: int = Field(default=0, description="Credits used this month")
    credits_reset_date: datetime = Field(
        default_factory=lambda: (datetime.now(timezone.utc).replace(day=1) + timedelta(days=32)).replace(day=1),
        description="Date when credits reset"
    )
    auto_web_search: bool = Field(default=False, description="Automatically include web search")

    # Qdrant settings
    qdrant_collection_name: Optional[str] = Field(None, description="Tutor's Qdrant collection")
    qdrant_initialized: bool = Field(default=False, description="Whether Qdrant collection is set up")

    # Preferred AI settings
    preferred_provider: str = Field(default="groq", description="Preferred AI provider")
    preferred_model: Optional[str] = Field(None, description="Preferred model for generation")

    # Embedding settings
    embedding_model: str = Field(default="text-embedding-3-small", description="OpenAI embedding model")
    chunk_size: int = Field(default=1000, description="Chunk size for text splitting")
    chunk_overlap: int = Field(default=200, description="Overlap between chunks")

    # Usage statistics
    total_documents: int = Field(default=0, description="Total documents in library")
    total_embeddings: int = Field(default=0, description="Total embeddings stored")
    total_generations: int = Field(default=0, description="Total RAG generations")

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True
    )


class RAGQuestionGenerationRequest(BaseModel):
    """Request for RAG-enabled question generation"""
    # Content sources
    document_ids: List[str] = Field(default=[], description="Document IDs to use for context")
    text_content: Optional[str] = Field(None, description="Direct text content")

    # Question settings
    subject: str = Field(..., description="Subject area")
    topic: str = Field(..., description="Specific topic")
    question_count: int = Field(default=10, ge=1, le=50, description="Number of questions")
    question_types: List[str] = Field(default=["multiple-choice"])
    difficulty: Optional[str] = Field(default=None, description="Single difficulty override")
    difficulty_levels: List[str] = Field(default=["medium"])

    # AI settings
    ai_provider: str = Field(default="groq", description="AI provider to use")
    model_name: Optional[str] = Field(None, description="Specific model to use")
    custom_prompt: Optional[str] = Field(None, description="Custom generation prompt")
    additional_context: Optional[str] = Field(None, description="Additional context to include")

    # RAG settings
    enable_web_search: bool = Field(default=False, description="Include web search results")
    use_web_search: Optional[bool] = Field(default=None, description="Alias for enable_web_search")
    web_search_query: Optional[str] = Field(None, description="Custom web search query")
    context_chunks: int = Field(default=5, ge=1, le=20, description="Number of context chunks")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "document_ids": ["doc1", "doc2"],
                "subject": "Biology",
                "topic": "Photosynthesis",
                "question_count": 5,
                "question_types": ["multiple-choice", "short-answer"],
                "difficulty_levels": ["medium"],
                "ai_provider": "groq",
                "enable_web_search": False
            }
        }
    )


class QuestionRegenerationRequest(BaseModel):
    """Request to regenerate a specific question"""
    question_id: str = Field(..., description="ID of question to regenerate")
    regeneration_prompt: Optional[str] = Field(None, description="Custom prompt for regeneration")
    keep_type: bool = Field(default=True, description="Keep same question type")
    keep_difficulty: bool = Field(default=True, description="Keep same difficulty")
    use_same_context: bool = Field(default=True, description="Use same RAG context")


class RAGGenerationResponse(BaseModel):
    """Response from RAG question generation"""
    generation_id: str
    questions: List[Dict[str, Any]]  # List of generated questions
    ai_provider: str
    model_used: str
    source_documents: List[str]
    context_chunks_used: int
    web_search_used: bool
    web_search_results: List[Dict[str, Any]] = []
    total_generated: int
    processing_time: float
    status: str = "completed"


class DocumentLibraryItem(BaseModel):
    """Document library item for frontend display"""
    id: str
    filename: str
    content_type: str
    size: int
    uploaded_at: datetime
    status: str  # FileStatus value
    embedding_status: str  # EmbeddingStatus value
    chunk_count: int
    tags: List[str] = []
    category: Optional[str] = None
    subject_id: Optional[str] = None
    topic: Optional[str] = None
    file_url: str

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat() if v else None}
    )


class DocumentProcessingStatus(BaseModel):
    """Real-time document processing status"""
    file_id: str
    status: str
    embedding_status: str
    progress: float = 0.0  # 0 to 1
    current_step: str = ""
    chunks_processed: int = 0
    total_chunks: int = 0
    error_message: Optional[str] = None


class WebSearchResult(BaseModel):
    """Web search result from Tavily"""
    title: str
    url: str
    snippet: str
    score: float
    raw_content: Optional[str] = None

