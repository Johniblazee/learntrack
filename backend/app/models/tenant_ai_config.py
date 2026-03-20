"""
Tenant AI Configuration Models
Defines the schema for per-tenant AI provider and model configurations
"""
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


class AIProviderType(str, Enum):
    """Available AI providers"""
    GROQ = "groq"
    OPENAI = "openai"
    GEMINI = "gemini"
    ANTHROPIC = "anthropic"


class ProviderConfig(BaseModel):
    """Configuration for a single AI provider"""
    provider_id: str  # groq, openai, gemini, anthropic
    enabled: bool = True
    enabled_models: List[str] = []  # List of enabled model IDs
    custom_api_key: Optional[str] = None  # DEPRECATED — kept for migration
    encrypted_api_key: Optional[str] = None  # Fernet-encrypted BYOK key
    has_custom_key: bool = False  # Frontend flag
    priority: int = 0  # Lower = higher priority for fallback


class TenantAIConfigBase(BaseModel):
    """Base tenant AI configuration model"""
    tenant_id: str  # Tutor's clerk_id
    enabled_providers: List[str] = ["groq", "openai", "gemini", "anthropic"]
    provider_configs: Dict[str, ProviderConfig] = {}
    default_provider: str = "groq"
    default_model: str = "llama-3.3-70b-versatile"

    # Embedding configuration
    embedding_provider: str = "openai"
    embedding_model: str = "text-embedding-3-small"
    
    # Restrictions
    max_questions_per_generation: int = 20
    allow_custom_api_keys: bool = False
    
    # Feature flags
    enable_rag: bool = True
    enable_web_search: bool = True
    enable_streaming: bool = True


class TenantAIConfigCreate(TenantAIConfigBase):
    """Model for creating a new tenant AI configuration"""
    pass


class TenantAIConfigUpdate(BaseModel):
    """Model for updating tenant AI configuration"""
    enabled_providers: Optional[List[str]] = None
    provider_configs: Optional[Dict[str, ProviderConfig]] = None
    default_provider: Optional[str] = None
    default_model: Optional[str] = None
    embedding_provider: Optional[str] = None
    embedding_model: Optional[str] = None
    max_questions_per_generation: Optional[int] = None
    allow_custom_api_keys: Optional[bool] = None
    enable_rag: Optional[bool] = None
    enable_web_search: Optional[bool] = None
    enable_streaming: Optional[bool] = None


class TenantAIConfigInDB(TenantAIConfigBase):
    """Tenant AI configuration as stored in database"""
    id: str = Field(default=None, alias="_id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: Optional[str] = None  # Admin who created/modified
    updated_by: Optional[str] = None

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )


class TenantAIConfig(TenantAIConfigInDB):
    """Tenant AI configuration response model"""
    pass


class ModelAvailability(BaseModel):
    """Model availability status from provider API"""
    model_id: str
    name: str
    description: str
    available: bool = True
    context_window: Optional[int] = None
    priority: int = 0


class ProviderAvailability(BaseModel):
    """Provider availability status"""
    provider_id: str
    name: str
    description: str
    available: bool = True
    api_key_configured: bool = False
    models: List[ModelAvailability] = []
    error_message: Optional[str] = None


class EmbeddingModelAvailability(BaseModel):
    model_id: str
    name: str
    description: str
    dimension: int
    available: bool = True


class EmbeddingProviderAvailability(BaseModel):
    provider_id: str
    name: str
    description: str
    available: bool = True
    api_key_configured: bool = False
    models: List[EmbeddingModelAvailability] = []
    error_message: Optional[str] = None


class TenantAIConfigResponse(BaseModel):
    """Full response with config and availability"""
    config: TenantAIConfig
    providers: List[ProviderAvailability] = []
    embedding_providers: List[EmbeddingProviderAvailability] = []


class BulkModelOperation(BaseModel):
    """Request for bulk model operations"""
    operation: str  # "enable_all", "disable_all", "reset_defaults"
    provider_id: Optional[str] = None  # If None, applies to all providers


class ConfigChangeAuditLog(BaseModel):
    """Audit log entry for configuration changes"""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    admin_id: str
    admin_email: str
    tenant_id: str
    action: str  # "create", "update", "bulk_operation"
    changes: Dict[str, Any] = {}
    previous_values: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Tutor-facing BYOK models
# ---------------------------------------------------------------------------

class TutorProviderKeyUpdate(BaseModel):
    """Request to set/update a tutor's API key for a provider"""
    provider_id: str
    api_key: str


class TutorProviderKeyDelete(BaseModel):
    """Request to remove a tutor's API key for a provider"""
    provider_id: str


class TutorProviderStatus(BaseModel):
    """Status of a single AI provider from the tutor's perspective"""
    provider_id: str
    name: str
    has_system_key: bool = False
    has_custom_key: bool = False
    available: bool = False
    masked_key: Optional[str] = None
    enabled_models: List[str] = []


class TutorAIConfigUpdate(BaseModel):
    """Tutor request to update default provider/model"""
    default_provider: Optional[str] = None
    default_model: Optional[str] = None


class TutorAIConfigResponse(BaseModel):
    """Response for tutor AI config status"""
    default_provider: str
    default_model: str
    providers: List[TutorProviderStatus] = []
