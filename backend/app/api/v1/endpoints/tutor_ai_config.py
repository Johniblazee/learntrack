"""
Tutor-facing AI configuration endpoints (BYOK key management).

All routes are scoped to the authenticated tutor's own configuration.
"""

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.ai.services.tenant_ai_resolver import PROVIDER_NAMES
from app.core.dependencies import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.exceptions import ValidationError
from app.models.tenant_ai_config import (
    TutorProviderKeyUpdate,
    TutorAIConfigUpdate,
    TutorAIConfigResponse,
)
from app.services.tenant_ai_config_service import TenantAIConfigService
from app.utils.enums import normalize_provider

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
        allow_custom_api_keys=config.allow_custom_api_keys,
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
        provider_id = normalize_provider(body.default_provider)
        update_fields["default_provider"] = provider_id
        if body.default_model is None:
            recommended_model = await svc.get_recommended_default_model(
                current_user.tutor_id, provider_id
            )
            if recommended_model:
                update_fields["default_model"] = recommended_model
    if body.default_model is not None:
        update_fields["default_model"] = body.default_model

    if update_fields:
        from app.models.tenant_ai_config import TenantAIConfigUpdate as AdminUpdate

        try:
            await svc.update_config(
                current_user.tutor_id,
                AdminUpdate(**update_fields),
                admin_id=current_user.clerk_id,
                admin_email="",
            )
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    config = await svc.get_or_create_default(current_user.tutor_id)
    providers = await svc.get_tutor_provider_status(current_user.tutor_id)
    return TutorAIConfigResponse(
        default_provider=config.default_provider,
        default_model=config.default_model,
        allow_custom_api_keys=config.allow_custom_api_keys,
        providers=providers,
    )


@router.post("/keys")
async def set_provider_key(
    body: TutorProviderKeyUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Set or update an API key for a provider (encrypts before storage)."""
    provider_id = normalize_provider(body.provider_id)
    if provider_id not in PROVIDER_NAMES:
        raise HTTPException(
            status_code=400, detail=f"Invalid provider: {body.provider_id}"
        )

    svc = _config_service(db)
    try:
        await svc.set_tutor_api_key(current_user.tutor_id, provider_id, body.api_key)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "provider_id": provider_id}


@router.delete("/keys/{provider_id}")
async def delete_provider_key(
    provider_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Remove the tutor's BYOK key for a provider."""
    svc = _config_service(db)
    provider_id = normalize_provider(provider_id)
    try:
        await svc.delete_tutor_api_key(current_user.tutor_id, provider_id)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "provider_id": provider_id}


@router.post("/keys/{provider_id}/test")
async def test_provider_key(
    provider_id: str,
    body: TutorProviderKeyUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Test an API key without saving it (fires a minimal LLM call)."""
    from app.ai.litellm_provider import test_api_key

    provider_id = normalize_provider(provider_id)
    if provider_id not in PROVIDER_NAMES:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {provider_id}")

    svc = _config_service(db)
    config = await svc.get_or_create_default(current_user.tutor_id)
    if not config.allow_custom_api_keys:
        raise HTTPException(
            status_code=400,
            detail="Custom API keys are disabled for this tenant",
        )

    try:
        await test_api_key(provider_id, body.api_key)
        return {"status": "ok", "message": "Key is valid"}
    except Exception as exc:
        logger.warning(
            "Tutor API key test failed", provider=provider_id, error=str(exc)
        )
        raise HTTPException(
            status_code=400,
            detail="Key test failed. Check the provider and API key, then try again.",
        )
