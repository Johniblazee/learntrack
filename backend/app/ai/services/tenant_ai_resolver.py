from dataclasses import dataclass
from typing import Any, Dict, List, Optional, cast

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.ai_models_config import ALL_PROVIDER_MODELS
from app.core.config import settings
from app.core.exceptions import AIProviderError
from app.utils.enums import normalize_provider

logger = structlog.get_logger()

GLOBAL_OVERRIDES_COLLECTION = "global_ai_model_overrides"

PROVIDER_NAMES = {
    "groq": "Groq",
    "openai": "OpenAI",
    "gemini": "Google Gemini",
    "anthropic": "Anthropic",
}

PROVIDER_DESCRIPTIONS = {
    "groq": "Ultra-fast inference with open models",
    "openai": "GPT models from OpenAI",
    "gemini": "Gemini models from Google",
    "anthropic": "Claude models from Anthropic",
}

_SYSTEM_KEY_ATTRS = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}


@dataclass
class ResolvedTenantModel:
    provider_id: str
    provider_name: str
    model_id: str
    tenant_config: Any
    encrypted_tutor_key: Optional[str]
    key_source: str
    llm: Any


def get_system_api_key(provider_id: str) -> Optional[str]:
    attr = _SYSTEM_KEY_ATTRS.get(provider_id)
    value = getattr(settings, attr, None) if attr else None
    return value if value and len(value) > 10 else None


def has_system_api_key(provider_id: str) -> bool:
    return bool(get_system_api_key(provider_id))


async def _get_global_overrides(db: AsyncIOMotorDatabase) -> Dict[str, Dict[str, Any]]:
    overrides: Dict[str, Dict[str, Any]] = {}
    cursor = db[GLOBAL_OVERRIDES_COLLECTION].find()
    async for doc in cursor:
        key = f"{doc['provider']}:{doc['model_id']}"
        overrides[key] = doc
    return overrides


async def get_global_model_registry(
    db: AsyncIOMotorDatabase,
) -> Dict[str, List[Dict[str, Any]]]:
    overrides = await _get_global_overrides(db)
    registry: Dict[str, List[Dict[str, Any]]] = {}

    for provider_id, models in ALL_PROVIDER_MODELS.items():
        registry[provider_id] = []
        for model in models:
            model_data = (
                model.model_dump() if hasattr(model, "model_dump") else dict(model)
            )
            override = overrides.get(f"{provider_id}:{model_data['id']}", {})
            if "is_active" in override:
                model_data["is_active"] = override["is_active"]
            if "is_default" in override:
                model_data["is_default"] = override["is_default"]
            registry[provider_id].append(model_data)

    return registry


def get_provider_default_model_id(models: List[Dict[str, Any]]) -> Optional[str]:
    for model in models:
        if model.get("is_default") and model.get("is_active", True):
            return model["id"]
    for model in models:
        if model.get("is_active", True):
            return model["id"]
    return models[0]["id"] if models else None


def filter_models_for_tenant(
    tenant_config: Any,
    provider_id: str,
    models: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    active_models = [model for model in models if model.get("is_active", True)]
    provider_config = (
        tenant_config.provider_configs.get(provider_id)
        if tenant_config and getattr(tenant_config, "provider_configs", None)
        else None
    )
    enabled_model_ids = provider_config.enabled_models if provider_config else []
    if enabled_model_ids:
        enabled_set = set(enabled_model_ids)
        active_models = [model for model in active_models if model["id"] in enabled_set]
    return active_models


def get_tenant_provider_key_source(
    tenant_config: Any, provider_id: str
) -> Optional[str]:
    provider_config = (
        tenant_config.provider_configs.get(provider_id)
        if tenant_config and getattr(tenant_config, "provider_configs", None)
        else None
    )
    if (
        tenant_config
        and getattr(tenant_config, "allow_custom_api_keys", False)
        and provider_config
        and provider_config.encrypted_api_key
    ):
        return "custom"
    if has_system_api_key(provider_id):
        return "system"
    return None


async def resolve_tenant_chat_model(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    requested_provider: Optional[str] = None,
    requested_model: Optional[str] = None,
    tenant_config: Optional[Any] = None,
) -> ResolvedTenantModel:
    from app.ai.litellm_provider import create_litellm_chat_model
    from app.services.tenant_ai_config_service import TenantAIConfigService

    config_service = TenantAIConfigService(db)
    tenant_config = tenant_config or await config_service.get_or_create_default(
        tenant_id
    )
    tenant_config = cast(Any, tenant_config)

    requested_provider_id = (
        normalize_provider(requested_provider) if requested_provider else None
    )
    enabled_providers = tenant_config.enabled_providers or list(PROVIDER_NAMES)
    preferred_provider_id = requested_provider_id or tenant_config.default_provider
    if preferred_provider_id not in enabled_providers:
        raise AIProviderError(
            f"Provider '{preferred_provider_id}' is not enabled for this tenant"
        )

    registry = await get_global_model_registry(db)
    candidate_provider_ids = [preferred_provider_id]
    if not requested_provider_id:
        candidate_provider_ids.extend(
            provider_id
            for provider_id in enabled_providers
            if provider_id not in candidate_provider_ids
        )

    provider_id = preferred_provider_id
    provider_models: List[Dict[str, Any]] = []
    key_source: Optional[str] = None
    for candidate_provider_id in candidate_provider_ids:
        candidate_models = filter_models_for_tenant(
            tenant_config,
            candidate_provider_id,
            registry.get(candidate_provider_id, []),
        )
        candidate_key_source = get_tenant_provider_key_source(
            tenant_config, candidate_provider_id
        )
        if candidate_models and candidate_key_source is not None:
            provider_id = candidate_provider_id
            provider_models = candidate_models
            key_source = candidate_key_source
            break

    if not provider_models:
        raise AIProviderError(
            f"No active models with an available API key were found for provider '{preferred_provider_id}'"
            if requested_provider_id
            else "No enabled AI provider with an available API key was found for this tenant"
        )

    allowed_model_ids = {model["id"] for model in provider_models}
    model_id = requested_model or (
        tenant_config.default_model
        if provider_id == tenant_config.default_provider
        else None
    )
    if not model_id or model_id not in allowed_model_ids:
        if requested_model:
            raise AIProviderError(
                f"Model '{requested_model}' is not enabled for provider '{provider_id}'"
            )
        model_id = get_provider_default_model_id(provider_models)

    if not model_id:
        raise AIProviderError(
            f"No default model is available for provider '{provider_id}'"
        )

    provider_config = (
        tenant_config.provider_configs.get(provider_id)
        if tenant_config.provider_configs
        else None
    )
    encrypted_tutor_key = (
        provider_config.encrypted_api_key
        if (
            tenant_config.allow_custom_api_keys
            and provider_config
            and provider_config.encrypted_api_key
        )
        else None
    )

    key_source = key_source or ("custom" if encrypted_tutor_key else "system")
    if key_source == "system" and not has_system_api_key(provider_id):
        raise AIProviderError(
            f"No API key available for provider '{provider_id}'. "
            "Configure a system key or add your own in Settings -> AI."
        )

    llm = create_litellm_chat_model(
        provider_id=provider_id,
        model_id=model_id,
        encrypted_tutor_key=encrypted_tutor_key,
    )

    logger.debug(
        "Resolved tenant chat model",
        tenant_id=tenant_id,
        provider=provider_id,
        model=model_id,
        key_source=key_source,
    )

    return ResolvedTenantModel(
        provider_id=provider_id,
        provider_name=PROVIDER_NAMES.get(provider_id, provider_id.title()),
        model_id=model_id,
        tenant_config=tenant_config,
        encrypted_tutor_key=encrypted_tutor_key,
        key_source=key_source,
        llm=llm,
    )
