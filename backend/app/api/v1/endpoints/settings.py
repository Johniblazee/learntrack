"""
Settings management endpoints
"""

from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_authenticated_user,
    require_tutor,
    ClerkUserContext,
)
from app.models.settings import (
    AppSettings,
    SettingsUpdateRequest,
    SettingsResponse,
    AIProvider,
    AIProviderConfig,
)
from app.services.settings_service import SettingsService

router = APIRouter()


# User-specific settings models (for profile, notifications, privacy)
class UserNotificationSettings(BaseModel):
    """User notification preferences"""

    email_notifications: bool = True
    assignment_reminders: bool = True
    message_notifications: bool = True
    weekly_digest: bool = False


class UserPrivacySettings(BaseModel):
    """User privacy settings"""

    profile_visibility: str = "students"  # everyone, students, private
    show_email: bool = False
    show_phone: bool = False


class UserPreferenceSettings(BaseModel):
    """User experience preferences"""

    default_student_tab: str = "dashboard"
    show_weekend_schedule: bool = True
    compact_assignment_cards: bool = False
    auto_open_next_assignment: bool = False


class UserProfileSettings(BaseModel):
    """User profile settings"""

    display_name: Optional[str] = None
    timezone: str = "America/New_York"


class UserSettings(BaseModel):
    """Complete user settings"""

    profile: UserProfileSettings = UserProfileSettings()
    notifications: UserNotificationSettings = UserNotificationSettings()
    privacy: UserPrivacySettings = UserPrivacySettings()
    preferences: UserPreferenceSettings = UserPreferenceSettings()


class UserSettingsUpdateRequest(BaseModel):
    """Request to update user settings"""

    profile: Optional[UserProfileSettings] = None
    notifications: Optional[UserNotificationSettings] = None
    privacy: Optional[UserPrivacySettings] = None
    preferences: Optional[UserPreferenceSettings] = None


@router.get("/", response_model=SettingsResponse)
async def get_app_settings(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get current application settings (tutor only)"""
    service = SettingsService(database)
    settings = await service.get_settings()

    # Convert to response model and mask sensitive data
    response = SettingsResponse(
        ai=settings.ai, general=settings.general, upload=settings.upload
    )
    return response.mask_sensitive_data()


@router.put("/", response_model=SettingsResponse)
async def update_app_settings(
    update_request: SettingsUpdateRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update application settings (tutor only)"""
    service = SettingsService(database)

    try:
        updated_settings = await service.update_settings(update_request)

        # Convert to response model and mask sensitive data
        response = SettingsResponse(
            ai=updated_settings.ai,
            general=updated_settings.general,
            upload=updated_settings.upload,
        )
        return response.mask_sensitive_data()

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update settings: {str(e)}"
        )


@router.put("/ai/{provider}")
async def update_ai_provider(
    provider: AIProvider,
    config: AIProviderConfig,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update AI provider configuration (tutor only)"""
    service = SettingsService(database)

    try:
        updated_settings = await service.update_ai_provider(
            provider=provider,
            api_key=config.api_key,
            enabled=config.enabled,
            default_model=config.default_model,
        )

        # Return just the updated provider config
        provider_config = updated_settings.ai.get_provider_config(provider)
        if provider_config and provider_config.api_key:
            # Mask the API key in response
            key = provider_config.api_key
            if len(key) > 12:
                provider_config.api_key = f"{key[:8]}...{key[-4:]}"
            else:
                provider_config.api_key = "***"

        return {
            "provider": provider.value,
            "config": provider_config,
            "message": f"{provider.value} configuration updated successfully",
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update AI provider: {str(e)}"
        )


@router.post("/ai/{provider}/test")
async def test_ai_provider(
    provider: AIProvider,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Test AI provider connection (tutor only)"""
    service = SettingsService(database)

    try:
        result = await service.test_ai_provider(provider)
        return result

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to test AI provider: {str(e)}"
        )


@router.get("/ai/providers")
async def get_available_providers(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get list of available AI providers and their status (tutor only)"""
    service = SettingsService(database)
    settings = await service.get_settings()

    providers_status = {}
    for provider_name, config in settings.ai.providers.items():
        providers_status[provider_name] = {
            "enabled": config.enabled,
            "configured": config.api_key is not None,
            "models": config.models,
            "default_model": config.default_model,
        }

    return {
        "providers": providers_status,
        "default_provider": settings.ai.default_provider.value,
    }


@router.put("/ai/default/{provider}")
async def set_default_ai_provider(
    provider: AIProvider,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Set default AI provider (tutor only)"""
    service = SettingsService(database)
    settings = await service.get_settings()

    # Check if provider is configured and enabled
    if not settings.ai.is_provider_enabled(provider):
        raise HTTPException(
            status_code=400,
            detail=f"Provider {provider.value} is not configured or enabled",
        )

    # Update default provider
    settings.ai.default_provider = provider
    updated_settings = await service.update_settings(
        SettingsUpdateRequest(ai=settings.ai)
    )

    return {
        "default_provider": provider.value,
        "message": f"Default AI provider set to {provider.value}",
    }


# ============================================
# AI Defaults Endpoint for Frontend
# ============================================


class AIDefaultsResponse(BaseModel):
    """Response model for AI defaults"""

    default_provider: str
    default_model: str
    available_providers: list
    temperature: float = 0.7
    max_tokens: int = 4000


@router.get("/ai/defaults")
async def get_ai_defaults(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get AI generation defaults for the frontend.

    Returns the default provider, model, and available providers
    so the frontend can initialize with saved settings instead of hardcoded values.
    """
    service = SettingsService(database)
    settings = await service.get_settings()

    # Find the default provider and its default model
    default_provider = settings.ai.default_provider.value
    default_model = None
    temperature = 0.7
    max_tokens = 4000

    # Get the default model from the default provider config
    default_provider_config = settings.ai.get_provider_config(
        settings.ai.default_provider
    )
    if default_provider_config:
        default_model = default_provider_config.default_model
        temperature = default_provider_config.temperature
        max_tokens = default_provider_config.max_tokens

    # Get list of available (enabled) providers
    available_providers = []
    for provider_name, config in settings.ai.providers.items():
        if config.enabled and config.api_key:
            available_providers.append(
                {
                    "id": provider_name,
                    "name": provider_name.capitalize(),
                    "models": config.models,
                    "default_model": config.default_model,
                    "enabled": config.enabled,
                }
            )

    return {
        "default_provider": default_provider,
        "default_model": default_model or "gpt-4o-mini",  # Fallback
        "available_providers": available_providers,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


# ============================================
# User-specific settings endpoints
# ============================================


@router.get("/user", response_model=UserSettings)
async def get_user_settings(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get current user's personal settings"""
    user_settings = await database.user_settings.find_one(
        {"user_id": current_user.clerk_id}
    )

    if not user_settings:
        # Return defaults
        return UserSettings()

    # Remove MongoDB _id
    user_settings.pop("_id", None)
    user_settings.pop("user_id", None)

    return UserSettings(**user_settings)


@router.put("/user", response_model=UserSettings)
async def update_user_settings(
    update_request: UserSettingsUpdateRequest,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update current user's personal settings"""
    # Get existing settings or create new
    existing = await database.user_settings.find_one({"user_id": current_user.clerk_id})

    if existing:
        current_settings = UserSettings(
            profile=UserProfileSettings(**existing.get("profile", {})),
            notifications=UserNotificationSettings(**existing.get("notifications", {})),
            privacy=UserPrivacySettings(**existing.get("privacy", {})),
            preferences=UserPreferenceSettings(**existing.get("preferences", {})),
        )
    else:
        current_settings = UserSettings()

    # Apply updates
    if update_request.profile:
        current_settings.profile = update_request.profile
    if update_request.notifications:
        current_settings.notifications = update_request.notifications
    if update_request.privacy:
        current_settings.privacy = update_request.privacy
    if update_request.preferences:
        current_settings.preferences = update_request.preferences

    # Save to database
    settings_dict = current_settings.model_dump()
    settings_dict["user_id"] = current_user.clerk_id

    await database.user_settings.replace_one(
        {"user_id": current_user.clerk_id}, settings_dict, upsert=True
    )

    return current_settings
