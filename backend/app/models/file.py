"""
File handling models for UploadThing integration
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from enum import Enum
from pydantic import BaseModel, Field, HttpUrl, ConfigDict

from app.models.user import PyObjectId


class FileType(str, Enum):
    """Supported file types"""

    PDF = "application/pdf"
    PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    PPT = "application/vnd.ms-powerpoint"
    DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    DOC = "application/msword"
    TXT = "text/plain"


class FileStatus(str, Enum):
    """File processing status"""

    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    ERROR = "error"


class EmbeddingStatus(str, Enum):
    """RAG embedding status for files"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class SyncStatus(str, Enum):
    """Document sync status for change detection"""

    SYNCED = "synced"
    OUT_OF_SYNC = "out_of_sync"
    NEVER_SYNCED = "never_synced"


class ErrorCategory(str, Enum):
    """Categorized processing error types"""

    FORMAT_ERROR = "format_error"
    API_LIMIT = "api_limit"
    NETWORK_ERROR = "network_error"
    TIMEOUT = "timeout"
    UNKNOWN = "unknown"


class ProcessingHistoryEntry(BaseModel):
    """Single entry in document processing history"""

    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action: str  # "embed", "re-embed", "delete", "sync"
    status: str  # "started", "completed", "failed"
    details: Optional[Dict[str, Any]] = None
    processor_used: Optional[str] = None
    error_message: Optional[str] = None


class UploadedFile(BaseModel):
    """UploadThing file model"""

    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")

    # UploadThing specific fields
    uploadthing_key: str  # UploadThing file key
    uploadthing_url: HttpUrl  # UploadThing file URL
    filename: str
    content_type: str
    size: int
    storage_path: Optional[str] = None
    source_url: Optional[str] = None

    # User and metadata
    uploaded_by: str  # user_id
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    tutor_id: Optional[str] = Field(
        None,
        description="Tutor ID - references the tutor's Clerk user ID for tenant isolation",
    )
    tenant_path: Optional[str] = Field(
        None, description="Tenant-prefixed storage path for S3 migration readiness"
    )

    # Processing metadata
    status: FileStatus = FileStatus.UPLOADED
    processing_started_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    error_message: Optional[str] = None

    # AI processing results
    extracted_text: Optional[str] = None
    generated_questions_count: int = 0
    ai_provider_used: Optional[str] = None
    processing_time: Optional[float] = None

    # Subject/topic assignment
    subject_id: Optional[str] = None
    topic: Optional[str] = None

    # RAG-specific fields
    qdrant_collection_id: Optional[str] = None
    embedding_status: EmbeddingStatus = EmbeddingStatus.PENDING
    chunk_count: int = 0
    embedding_model_used: Optional[str] = None
    last_embedded_at: Optional[datetime] = None
    tags: List[str] = Field(default_factory=list)
    category: Optional[str] = None
    embedding_error: Optional[str] = None

    # Enhanced document processing metadata (from Docling/Unstructured)
    character_count: Optional[int] = None
    token_estimate: Optional[int] = None
    content_hash: Optional[str] = None  # SHA-256 hash for change detection
    page_count: Optional[int] = None
    processor_used: Optional[str] = None  # docling, unstructured, pypdf, etc.

    # Governance fields for lifecycle management
    embedding_version: int = 1  # Track embedding versions
    last_synced_at: Optional[datetime] = None
    sync_status: SyncStatus = SyncStatus.NEVER_SYNCED
    processing_attempts: int = 0
    max_processing_attempts: int = 3  # For retry logic
    last_error_category: Optional[ErrorCategory] = None
    processing_history: List[ProcessingHistoryEntry] = Field(default_factory=list)

    model_config = ConfigDict(
        populate_by_name=True, arbitrary_types_allowed=True, json_encoders={str: str}
    )


class UploadThingWebhookPayload(BaseModel):
    """UploadThing webhook payload"""

    eventType: str
    data: Dict[str, Any]


class FileMetadataRequest(BaseModel):
    """Request to register file metadata after UploadThing upload"""

    uploadthing_key: str
    uploadthing_url: HttpUrl
    filename: str
    content_type: str
    size: int
    subject_id: str
    topic: str
    ai_provider: Optional[str] = "openai"
    question_count: int = 10
    difficulty_level: str = "medium"


class FileRegistrationResponse(BaseModel):
    """Response after registering file metadata"""

    file_id: str
    filename: str
    size: int
    status: FileStatus
    uploadthing_url: str
    message: str


class FileProcessingResult(BaseModel):
    """File processing result"""

    file_id: str
    status: FileStatus
    questions_generated: int = 0
    processing_time: Optional[float] = None
    error_message: Optional[str] = None


class UploadThingFileCreate(BaseModel):
    """Create file record from UploadThing data"""

    uploadthing_key: str
    uploadthing_url: HttpUrl
    filename: str
    content_type: str
    size: int
    uploaded_by: str
    subject_id: Optional[str] = None
    topic: Optional[str] = None


class UploadThingFileUpdate(BaseModel):
    """Update file record"""

    status: Optional[FileStatus] = None
    processing_started_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    extracted_text: Optional[str] = None
    generated_questions_count: Optional[int] = None
    ai_provider_used: Optional[str] = None
    processing_time: Optional[float] = None
    subject_id: Optional[str] = None
    topic: Optional[str] = None
