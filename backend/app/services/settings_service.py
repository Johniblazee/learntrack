"""
Settings management service
"""
import os
from typing import Optional, Dict, Any
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.settings import (
    AppSettings, AISettings, AIProviderConfig, AIProvider,
    GeneralSettings, UploadSettings, SettingsUpdateRequest
)
from app.core.config import settings as app_config
from app.core.ai_models_config import get_model_ids, get_default_model

logger = structlog.get_logger()


class SettingsService:
    """Service for managing application settings"""
    
    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.settings
    
    async def get_settings(self) -> AppSettings:
        """Get current application settings"""
        try:
            # Try to get from database first
            settings_doc = await self.collection.find_one({"_id": "app_settings"})
            
            if settings_doc:
                # Remove MongoDB _id field
                settings_doc.pop("_id", None)
                return AppSettings(**settings_doc)
            else:
                # Return default settings with current environment values
                return await self._get_default_settings()
                
        except Exception as e:
            logger.error("Failed to get settings from database", error=str(e))
            return await self._get_default_settings()
    
    async def _get_default_settings(self) -> AppSettings:
        """Get default settings from environment and config"""
        # Initialize AI providers based on environment using centralized config
        ai_providers = {}

        # OpenAI
        if app_config.OPENAI_API_KEY:
            ai_providers["openai"] = AIProviderConfig(
                provider=AIProvider.OPENAI,
                api_key=app_config.OPENAI_API_KEY,
                enabled=True,
                models=get_model_ids("openai"),
                default_model=get_default_model("openai")
            )

        # Anthropic
        if app_config.ANTHROPIC_API_KEY:
            ai_providers["anthropic"] = AIProviderConfig(
                provider=AIProvider.ANTHROPIC,
                api_key=app_config.ANTHROPIC_API_KEY,
                enabled=True,
                models=get_model_ids("anthropic"),
                default_model=get_default_model("anthropic")
            )

        # Gemini (Google)
        gemini_key = app_config.GEMINI_API_KEY or app_config.GOOGLE_API_KEY
        if gemini_key:
            ai_providers["gemini"] = AIProviderConfig(
                provider=AIProvider.GEMINI,
                api_key=gemini_key,
                enabled=True,
                models=get_model_ids("gemini"),
                default_model=get_default_model("gemini")
            )
        
        ai_settings = AISettings(
            providers=ai_providers,
            default_provider=AIProvider.OPENAI
        )
        
        general_settings = GeneralSettings(
            max_file_size_mb=app_config.MAX_FILE_SIZE // (1024 * 1024),
            allowed_file_types=app_config.ALLOWED_FILE_TYPES
        )
        
        upload_settings = UploadSettings(
            r2_configured=bool(app_config.R2_ENDPOINT_URL),
            max_file_size=app_config.MAX_FILE_SIZE
        )
        
        return AppSettings(
            ai=ai_settings,
            general=general_settings,
            upload=upload_settings
        )
    
    async def update_settings(self, update_request: SettingsUpdateRequest) -> AppSettings:
        """Update application settings"""
        try:
            # Get current settings
            current_settings = await self.get_settings()
            
            # Update with new values
            if update_request.ai:
                current_settings.ai = update_request.ai
            if update_request.general:
                current_settings.general = update_request.general
            if update_request.upload:
                current_settings.upload = update_request.upload
            
            # Save to database
            settings_dict = current_settings.model_dump()
            await self.collection.replace_one(
                {"_id": "app_settings"},
                {"_id": "app_settings", **settings_dict},
                upsert=True
            )
            
            logger.info("Settings updated successfully")
            return current_settings
            
        except Exception as e:
            logger.error("Failed to update settings", error=str(e))
            raise
    
    async def update_ai_provider(
        self, 
        provider: AIProvider, 
        api_key: Optional[str] = None,
        enabled: Optional[bool] = None,
        default_model: Optional[str] = None
    ) -> AppSettings:
        """Update a specific AI provider configuration"""
        settings = await self.get_settings()
        
        provider_key = provider.value
        if provider_key not in settings.ai.providers:
            # Create new provider config
            settings.ai.providers[provider_key] = AIProviderConfig(
                provider=provider,
                enabled=False
            )
        
        provider_config = settings.ai.providers[provider_key]
        
        if api_key is not None:
            provider_config.api_key = api_key
        if enabled is not None:
            provider_config.enabled = enabled
        if default_model is not None:
            provider_config.default_model = default_model

        # Update models list from centralized config
        provider_config.models = get_model_ids(provider.value)

        # Save updated settings
        return await self.update_settings(SettingsUpdateRequest(ai=settings.ai))
    
    async def test_ai_provider(self, provider: AIProvider) -> Dict[str, Any]:
        """Test connection to an AI provider"""
        settings = await self.get_settings()
        provider_config = settings.ai.get_provider_config(provider)
        
        if not provider_config or not provider_config.api_key:
            return {
                "success": False,
                "error": "Provider not configured or missing API key"
            }
        
        try:
            # Import and test the AI manager with current settings
            from app.ai.services.ai_manager import AIManager
            current_settings = await self.get_settings()
            ai_settings = {
                "providers": current_settings.ai.providers,
                "default_provider": current_settings.ai.default_provider
            }
            ai_manager = AIManager(ai_settings)

            # Simple test - try to get available providers
            health_results = await ai_manager.health_check_all()
            provider_healthy = health_results.get(provider.value, False)
            
            return {
                "success": provider_healthy,
                "provider": provider.value,
                "models": provider_config.models,
                "default_model": provider_config.default_model
            }
            
        except Exception as e:
            logger.error(f"AI provider test failed for {provider.value}", error=str(e))
            return {
                "success": False,
                "error": str(e)
            }
