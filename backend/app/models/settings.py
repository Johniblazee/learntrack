"""
Settings models for configuration management
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator
from enum import Enum


class AIProvider(str, Enum):
    """Available AI providers"""
    GROQ = "groq"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"

    @classmethod
    def _missing_(cls, value):
        """Handle legacy 'google' value by mapping to 'gemini'"""
        if value == "google":
            return cls.GEMINI
        return None


class AIProviderConfig(BaseModel):
    """Configuration for an AI provider"""
    provider: AIProvider
    api_key: Optional[str] = None
    enabled: bool = False
    models: List[str] = []
    default_model: Optional[str] = None
    max_tokens: int = 4000
    temperature: float = 0.7

    @field_validator('provider', mode='before')
    @classmethod
    def normalize_provider(cls, v):
        """Normalize 'google' to 'gemini' for backwards compatibility"""
        if v == "google":
            return "gemini"
        return v


class AISettings(BaseModel):
    """AI configuration settings"""
    providers: Dict[str, AIProviderConfig] = {}
    default_provider: AIProvider = AIProvider.GROQ

    @field_validator('providers', mode='before')
    @classmethod
    def normalize_providers_dict(cls, v):
        """Normalize 'google' key to 'gemini' in providers dict"""
        if isinstance(v, dict) and 'google' in v:
            v = dict(v)  # Make a copy
            v['gemini'] = v.pop('google')
        return v

    @field_validator('default_provider', mode='before')
    @classmethod
    def normalize_default_provider(cls, v):
        """Normalize 'google' to 'gemini' for backwards compatibility"""
        if v == "google":
            return "gemini"
        return v

    def get_provider_config(self, provider: AIProvider) -> Optional[AIProviderConfig]:
        """Get configuration for a specific provider"""
        return self.providers.get(provider.value)

    def is_provider_enabled(self, provider: AIProvider) -> bool:
        """Check if a provider is enabled and configured"""
        config = self.get_provider_config(provider)
        return config is not None and config.enabled and config.api_key is not None


class GeneralSettings(BaseModel):
    """General application settings"""
    app_name: str = "LearnTrack"
    max_file_size_mb: int = 10
    allowed_file_types: List[str] = [
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]
    default_question_count: int = 10
    max_question_count: int = 50


class UploadSettings(BaseModel):
    """File upload settings"""
    r2_configured: bool = False
    max_file_size: int = 10 * 1024 * 1024  # 10MB
    allowed_extensions: List[str] = [".pdf", ".txt", ".doc", ".docx", ".ppt", ".pptx"]


class AppSettings(BaseModel):
    """Complete application settings"""
    ai: AISettings = Field(default_factory=AISettings)
    general: GeneralSettings = Field(default_factory=GeneralSettings)
    upload: UploadSettings = Field(default_factory=UploadSettings)
    
    model_config = ConfigDict(
        json_encoders={
            AIProvider: lambda v: v.value
        }
    )


class SettingsUpdateRequest(BaseModel):
    """Request to update settings"""
    ai: Optional[AISettings] = None
    general: Optional[GeneralSettings] = None
    upload: Optional[UploadSettings] = None


class SettingsResponse(BaseModel):
    """Response containing current settings (with sensitive data masked)"""
    ai: AISettings
    general: GeneralSettings
    upload: UploadSettings
    
    def mask_sensitive_data(self):
        """Mask sensitive information like API keys"""
        for provider_config in self.ai.providers.values():
            if provider_config.api_key:
                # Show only first 8 and last 4 characters
                key = provider_config.api_key
                if len(key) > 12:
                    provider_config.api_key = f"{key[:8]}...{key[-4:]}"
                else:
                    provider_config.api_key = "***"
        
        return self
