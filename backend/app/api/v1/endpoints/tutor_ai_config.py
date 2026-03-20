"""
Tutor-facing AI configuration endpoints (BYOK key management).

All routes are scoped to the authenticated tutor's own configuration.
"""

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.dependencies import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.models.tenant_ai_config import (
    TutorProviderKeyUpdate,
    TutorAIConfigUpdate,
    TutorAIConfigResponse,
)
from app.services.tenant_ai_config_service import TenantAIConfigService

logger = structlog.get_logger()
router = APIRouter()


def _config_service(db: AsyncIOMotorDatabase) -> TenantAIConfigService:
    return TenantAIConfigService(db)


@router.get("/status", response_model=TutorAIConfigResponse)
async def get_ai_config_status(
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get the tutor's provider statuses and default selections."""
    svc = _config_service(db)
    config = await svc.get_or_create_default(current_user.tutor_id)
    providers = await svc.get_tutor_provider_status(current_user.tutor_id)

    return TutorAIConfigResponse(
        default_provider=config.default_provider,
        default_model=config.default_model,
        providers=providers,
    )


@router.put("/defaults", response_model=TutorAIConfigResponse)
async def update_ai_defaults(
    body: TutorAIConfigUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update default provider and/or model for this tutor."""
    svc = _config_service(db)
    config = await svc.get_or_create_default(current_user.tutor_id)

    update_fields: dict = {}
    if body.default_provider is not None:
        update_fields["default_provider"] = body.default_provider
    if body.default_model is not None:
        update_fields["default_model"] = body.default_model

    if update_fields:
        from app.models.tenant_ai_config import TenantAIConfigUpdate as AdminUpdate

        await svc.update_config(
            current_user.tutor_id,
            AdminUpdate(**update_fields),
            admin_id=current_user.clerk_id,
            admin_email="",
        )

    config = await svc.get_or_create_default(current_user.tutor_id)
    providers = await svc.get_tutor_provider_status(current_user.tutor_id)
    return TutorAIConfigResponse(
        default_provider=config.default_provider,
        default_model=config.default_model,
        providers=providers,
    )


@router.post("/keys")
async def set_provider_key(
    body: TutorProviderKeyUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Set or update an API key for a provider (encrypts before storage)."""
    valid_providers = {"openai", "anthropic", "gemini", "groq"}
    if body.provider_id not in valid_providers:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {body.provider_id}")

    svc = _config_service(db)
    await svc.set_tutor_api_key(current_user.tutor_id, body.provider_id, body.api_key)
    return {"status": "ok", "provider_id": body.provider_id}


@router.delete("/keys/{provider_id}")
async def delete_provider_key(
    provider_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Remove the tutor's BYOK key for a provider."""
    svc = _config_service(db)
    await svc.delete_tutor_api_key(current_user.tutor_id, provider_id)
    return {"status": "ok", "provider_id": provider_id}


@router.post("/keys/{provider_id}/test")
async def test_provider_key(
    provider_id: str,
    body: TutorProviderKeyUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
):
    """Test an API key without saving it (fires a minimal LLM call)."""
    from app.ai.litellm_provider import test_api_key

    try:
        await test_api_key(provider_id, body.api_key)
        return {"status": "ok", "message": "Key is valid"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Key test failed: {str(e)}")
