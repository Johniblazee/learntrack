"""
Admin System Settings API endpoints
Provides system configuration management for super admins
"""

from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_super_admin,
    ClerkUserContext,
    require_admin_permission,
)
from app.models.user import AdminPermission
from app.models.admin import AuditAction
from app.api.v1.admin.audit_utils import log_admin_action as _log_admin_action

logger = structlog.get_logger()
router = APIRouter()


class SystemSettings(BaseModel):
    """System-wide settings"""

    ai_providers_enabled: List[str] = ["groq", "openai", "anthropic", "gemini"]
    default_ai_provider: str = "groq"
    max_questions_per_generation: int = 20
    max_file_size_mb: int = 50
    allowed_file_types: List[str] = ["pdf", "docx", "txt", "md"]
    enable_user_registration: bool = True
    require_email_verification: bool = True
    maintenance_mode: bool = False
    maintenance_message: Optional[str] = None


class FeatureFlag(BaseModel):
    """Feature flag configuration"""

    name: str
    enabled: bool
    description: Optional[str] = None
    rollout_percentage: int = 100  # 0-100 for gradual rollout


class FeatureFlagsResponse(BaseModel):
    """Response for feature flags endpoint"""

    flags: List[FeatureFlag]


class UpdateSettingsRequest(BaseModel):
    """Request to update system settings"""

    settings: Dict[str, Any]


@router.get("/", response_model=SystemSettings)
async def get_system_settings(
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.MANAGE_SYSTEM_SETTINGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get current system settings"""
    try:
        settings_doc = await database.system_settings.find_one({"_id": "global"})

        if not settings_doc:
            # Return default settings
            return SystemSettings()

        return SystemSettings(**{k: v for k, v in settings_doc.items() if k != "_id"})
    except Exception as e:
        logger.error("Failed to get system settings", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get settings: {str(e)}")


@router.put("/")
async def update_system_settings(
    request: UpdateSettingsRequest,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.MANAGE_SYSTEM_SETTINGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update system settings"""
    try:
        update_data = {
            **request.settings,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": current_user.clerk_id,
        }

        await database.system_settings.update_one(
            {"_id": "global"}, {"$set": update_data}, upsert=True
        )

        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            AuditAction.SETTINGS_CHANGED,
            "system_settings",
            "global",
            {"updated_fields": list(request.settings.keys())},
        )

        logger.info(
            "System settings updated",
            admin=current_user.email,
            fields=list(request.settings.keys()),
        )

        return {"status": "updated", "message": "System settings updated successfully"}
    except Exception as e:
        logger.error("Failed to update system settings", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to update settings: {str(e)}"
        )


@router.get("/feature-flags", response_model=FeatureFlagsResponse)
async def get_feature_flags(
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.MANAGE_FEATURE_FLAGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get all feature flags"""
    try:
        cursor = database.feature_flags.find({})
        flags_docs = await cursor.to_list(length=100)

        flags = [
            FeatureFlag(**{k: v for k, v in doc.items() if k != "_id"})
            for doc in flags_docs
        ]

        # Add default flags if none exist
        if not flags:
            default_flags = [
                FeatureFlag(
                    name="ai_question_generation",
                    enabled=True,
                    description="AI-powered question generation",
                ),
                FeatureFlag(
                    name="rag_search",
                    enabled=True,
                    description="RAG-based document search",
                ),
                FeatureFlag(
                    name="real_time_notifications",
                    enabled=True,
                    description="Real-time push notifications",
                ),
                FeatureFlag(
                    name="parent_portal",
                    enabled=True,
                    description="Parent access portal",
                ),
                FeatureFlag(
                    name="bulk_operations",
                    enabled=False,
                    description="Bulk user operations",
                    rollout_percentage=0,
                ),
            ]
            flags = default_flags

        return FeatureFlagsResponse(flags=flags)
    except Exception as e:
        logger.error("Failed to get feature flags", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get feature flags: {str(e)}"
        )


@router.put("/feature-flags/{flag_name}")
async def update_feature_flag(
    flag_name: str,
    flag: FeatureFlag,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.MANAGE_FEATURE_FLAGS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update a feature flag"""
    try:
        await database.feature_flags.update_one(
            {"name": flag_name},
            {
                "$set": {
                    "name": flag.name,
                    "enabled": flag.enabled,
                    "description": flag.description,
                    "rollout_percentage": flag.rollout_percentage,
                    "updated_at": datetime.now(timezone.utc),
                    "updated_by": current_user.clerk_id,
                }
            },
            upsert=True,
        )

        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            AuditAction.FEATURE_FLAG_TOGGLED,
            "feature_flag",
            flag_name,
            {"enabled": flag.enabled, "rollout_percentage": flag.rollout_percentage},
        )

        logger.info(
            "Feature flag updated",
            flag=flag_name,
            enabled=flag.enabled,
            admin=current_user.email,
        )

        return {"status": "updated", "flag": flag_name, "enabled": flag.enabled}
    except Exception as e:
        logger.error("Failed to update feature flag", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to update feature flag: {str(e)}"
        )
