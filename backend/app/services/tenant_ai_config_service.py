"""
Tenant AI Configuration Service
Manages per-tenant AI provider and model configurations with caching
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.tenant_ai_config import (
    TenantAIConfig,
    TenantAIConfigCreate,
    TenantAIConfigUpdate,
    ProviderConfig,
    ProviderAvailability,
    ModelAvailability,
    ConfigChangeAuditLog,
    TenantAIConfigInDB,
    EmbeddingProviderAvailability,
    EmbeddingModelAvailability,
    TutorProviderStatus,
)
from app.ai.services.tenant_ai_resolver import (
    PROVIDER_DESCRIPTIONS,
    PROVIDER_NAMES,
    filter_models_for_tenant,
    get_global_model_registry,
    get_provider_default_model_id,
    get_tenant_provider_key_source,
    has_system_api_key,
)
from app.core.exceptions import NotFoundError, ValidationError
from app.core.utils import escape_regex
from app.utils.enums import normalize_provider

logger = structlog.get_logger()


def _json_safe(obj: Any) -> Any:
    """Recursively convert MongoDB types (ObjectId, datetime) for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    if type(obj).__name__ == "ObjectId":
        return str(obj)
    return obj


# In-memory cache for tenant configurations
_config_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_MINUTES = 10

EMBEDDING_MODEL_CATALOG: Dict[str, Dict[str, Dict[str, Any]]] = {
    "openai": {
        "text-embedding-3-small": {
            "name": "Text Embedding 3 Small",
            "description": "OpenAI text embedding model (1536 dims)",
            "dimension": 1536,
        },
        "text-embedding-3-large": {
            "name": "Text Embedding 3 Large",
            "description": "OpenAI large embedding model (3072 dims)",
            "dimension": 3072,
        },
    },
    "gemini": {
        "text-embedding-004": {
            "name": "Text Embedding 004",
            "description": "Gemini embedding model (768 dims)",
            "dimension": 768,
        },
    },
}


class TenantAIConfigService:
    """Service for managing tenant AI configurations"""

    COLLECTION_NAME = "tenant_ai_configurations"
    AUDIT_COLLECTION = "tenant_ai_config_audit"

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database[self.COLLECTION_NAME]
        self.audit_collection = database[self.AUDIT_COLLECTION]

    def _get_cache_key(self, tenant_id: str) -> str:
        return f"tenant_ai_config:{tenant_id}"

    def _is_cache_valid(self, tenant_id: str) -> bool:
        key = self._get_cache_key(tenant_id)
        if key not in _config_cache:
            return False
        cached = _config_cache[key]
        return datetime.now() < cached.get("expires_at", datetime.min)

    def _set_cache(self, tenant_id: str, config: TenantAIConfig) -> None:
        key = self._get_cache_key(tenant_id)
        _config_cache[key] = {
            "config": config,
            "expires_at": datetime.now() + timedelta(minutes=CACHE_TTL_MINUTES),
        }

    def _get_cache(self, tenant_id: str) -> Optional[TenantAIConfig]:
        if self._is_cache_valid(tenant_id):
            return _config_cache[self._get_cache_key(tenant_id)]["config"]
        return None

    def _invalidate_cache(self, tenant_id: str) -> None:
        key = self._get_cache_key(tenant_id)
        if key in _config_cache:
            del _config_cache[key]

        # Also invalidate the AIManager cache for this tenant
        from app.ai.services.ai_manager import invalidate_tenant_ai_manager

        invalidate_tenant_ai_manager(tenant_id)

    async def get_config(
        self, tenant_id: str, use_cache: bool = True
    ) -> Optional[TenantAIConfig]:
        """Get tenant AI configuration, with caching"""
        if use_cache:
            cached = self._get_cache(tenant_id)
            if cached:
                return cached

        doc = await self.collection.find_one({"tenant_id": tenant_id})
        if doc:
            doc["_id"] = str(doc["_id"])
            config = TenantAIConfig(**doc)
            self._set_cache(tenant_id, config)
            return config
        return None

    async def get_or_create_default(self, tenant_id: str) -> TenantAIConfig:
        """Get config or create with defaults if not exists"""
        config = await self.get_config(tenant_id)
        if config:
            return config

        default_provider = "groq"
        registry = await get_global_model_registry(self.db)
        default_models = filter_models_for_tenant(
            None, default_provider, registry.get(default_provider, [])
        )
        default_model = (
            get_provider_default_model_id(default_models) or "llama-3.3-70b-versatile"
        )

        # Create default configuration
        default_config = TenantAIConfigCreate(
            tenant_id=tenant_id,
            enabled_providers=["groq", "openai", "gemini", "anthropic"],
            default_provider=default_provider,
            default_model=default_model,
            embedding_provider="openai",
            embedding_model="text-embedding-3-small",
            allow_custom_api_keys=True,
        )
        return await self.create_config(default_config)

    async def create_config(
        self, config_data: TenantAIConfigCreate, admin_id: Optional[str] = None
    ) -> TenantAIConfig:
        """Create a new tenant AI configuration"""
        existing = await self.collection.find_one({"tenant_id": config_data.tenant_id})
        if existing:
            raise ValidationError(
                f"Configuration already exists for tenant {config_data.tenant_id}"
            )

        now = datetime.now(timezone.utc)
        doc = config_data.model_dump()
        doc["created_at"] = now
        doc["updated_at"] = now
        doc["created_by"] = admin_id
        doc["updated_by"] = admin_id

        result = await self.collection.insert_one(doc)
        doc["_id"] = str(result.inserted_id)

        config = TenantAIConfig(**doc)
        self._set_cache(config_data.tenant_id, config)

        # Log audit
        if admin_id:
            await self._log_audit(admin_id, "", config_data.tenant_id, "create", doc)

        logger.info("Created tenant AI config", tenant_id=config_data.tenant_id)
        return config

    async def update_config(
        self,
        tenant_id: str,
        update_data: TenantAIConfigUpdate,
        admin_id: str,
        admin_email: str,
    ) -> TenantAIConfig:
        """Update tenant AI configuration"""
        existing = await self.get_config(tenant_id, use_cache=False)
        if not existing:
            raise NotFoundError("TenantAIConfig", tenant_id)

        # Build update dict
        update_dict = update_data.model_dump(exclude_unset=True)
        if not update_dict:
            return existing

        update_dict["updated_at"] = datetime.now(timezone.utc)
        update_dict["updated_by"] = admin_id

        # Validate provider/model selection
        if "default_provider" in update_dict or "default_model" in update_dict:
            await self._validate_model_selection(
                update_dict.get("default_provider", existing.default_provider),
                update_dict.get("default_model", existing.default_model),
                update_dict.get("enabled_providers", existing.enabled_providers),
            )

        if "embedding_provider" in update_dict or "embedding_model" in update_dict:
            await self._validate_embedding_selection(
                update_dict.get("embedding_provider", existing.embedding_provider),
                update_dict.get("embedding_model", existing.embedding_model),
            )

        await self.collection.update_one(
            {"tenant_id": tenant_id}, {"$set": update_dict}
        )

        self._invalidate_cache(tenant_id)

        # Log audit
        await self._log_audit(
            admin_id,
            admin_email,
            tenant_id,
            "update",
            update_dict,
            existing.model_dump(),
        )

        updated_config = await self.get_config(tenant_id)
        if not updated_config:
            raise NotFoundError("TenantAIConfig", tenant_id)
        return updated_config

    async def _get_allowed_provider_models(
        self,
        config: TenantAIConfig,
        provider_id: str,
        registry: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    ) -> List[Dict[str, Any]]:
        registry = registry or await get_global_model_registry(self.db)
        return filter_models_for_tenant(
            config, provider_id, registry.get(provider_id, [])
        )

    async def get_recommended_default_model(
        self, tenant_id: str, provider_id: str
    ) -> Optional[str]:
        config = await self.get_or_create_default(tenant_id)
        models = await self._get_allowed_provider_models(config, provider_id)
        return get_provider_default_model_id(models)

    async def _build_provider_availability(
        self, config: TenantAIConfig
    ) -> List[ProviderAvailability]:
        static_registry = await get_global_model_registry(self.db)
        registry: Dict[str, List[Dict[str, Any]]] = {
            provider_id: static_registry.get(provider_id, [])
            for provider_id in PROVIDER_NAMES
        }

        providers: List[ProviderAvailability] = []

        for provider_id, name in PROVIDER_NAMES.items():
            key_source = get_tenant_provider_key_source(config, provider_id)
            provider_models = filter_models_for_tenant(
                config, provider_id, registry.get(provider_id, [])
            )
            provider_available = (
                provider_id in config.enabled_providers
                and key_source is not None
                and len(provider_models) > 0
            )

            model_items = [
                ModelAvailability(
                    model_id=model["id"],
                    name=model.get("name", model["id"]),
                    description=model.get("description", ""),
                    available=provider_available,
                    context_window=model.get("context_window"),
                    priority=index,
                )
                for index, model in enumerate(provider_models)
            ]

            error_message = None
            if provider_id not in config.enabled_providers:
                error_message = "Provider is disabled for this tenant"
            elif not provider_models:
                error_message = "No active models are approved for this provider"
            elif key_source is None:
                error_message = "No system key or allowed tenant BYOK key configured"

            providers.append(
                ProviderAvailability(
                    provider_id=provider_id,
                    name=name,
                    description=PROVIDER_DESCRIPTIONS.get(provider_id, name),
                    available=provider_available,
                    api_key_configured=key_source is not None,
                    models=model_items,
                    error_message=error_message,
                )
            )

        return providers

    async def _validate_model_selection(
        self, provider_id: str, model_id: str, enabled_providers: List[str]
    ) -> None:
        """Validate that selected provider/model are available"""
        provider_id = normalize_provider(provider_id)
        enabled_providers = [
            normalize_provider(provider) for provider in enabled_providers
        ]
        if provider_id not in enabled_providers:
            raise ValidationError(
                f"Provider {provider_id} is not enabled for this tenant"
            )

        registry = await get_global_model_registry(self.db)
        provider_models = [
            model
            for model in registry.get(provider_id, [])
            if model.get("is_active", True)
        ]
        model_ids = [m["id"] for m in provider_models]
        if model_id and model_id not in model_ids:
            raise ValidationError(
                f"Model {model_id} is not available for provider {provider_id}"
            )

    async def _validate_embedding_selection(
        self, provider_id: str, model_id: str
    ) -> None:
        """Validate embedding provider/model selection."""
        if provider_id not in EMBEDDING_MODEL_CATALOG:
            raise ValidationError(f"Embedding provider {provider_id} is not supported")

        models = EMBEDDING_MODEL_CATALOG.get(provider_id, {})
        if model_id not in models:
            raise ValidationError(
                f"Embedding model {model_id} is not available for provider {provider_id}"
            )

        if not self._check_api_key(provider_id):
            raise ValidationError(
                f"API key not configured for embedding provider {provider_id}"
            )

    async def get_available_providers(
        self, tenant_id: str
    ) -> List[ProviderAvailability]:
        """Get all available providers with their models for a tenant"""
        config = await self.get_or_create_default(tenant_id)
        return await self._build_provider_availability(config)

    async def get_embedding_providers(self) -> List[EmbeddingProviderAvailability]:
        """Get available embedding providers and models."""
        provider_info = {
            "openai": ("OpenAI", "OpenAI embedding models"),
            "gemini": ("Google Gemini", "Gemini embedding models"),
        }

        providers: List[EmbeddingProviderAvailability] = []
        for provider_id, models in EMBEDDING_MODEL_CATALOG.items():
            name, description = provider_info.get(
                provider_id, (provider_id.title(), "Embedding provider")
            )
            api_key_configured = self._check_api_key(provider_id)

            model_list = []
            for model_id, meta in models.items():
                model_list.append(
                    EmbeddingModelAvailability(
                        model_id=model_id,
                        name=meta.get("name", model_id),
                        description=meta.get("description", ""),
                        dimension=meta.get("dimension", 0),
                        available=api_key_configured,
                    )
                )

            providers.append(
                EmbeddingProviderAvailability(
                    provider_id=provider_id,
                    name=name,
                    description=description,
                    available=api_key_configured,
                    api_key_configured=api_key_configured,
                    models=model_list,
                    error_message=None
                    if api_key_configured
                    else "API key not configured",
                )
            )

        return providers

    def _check_api_key(self, provider_id: str) -> bool:
        """Check if API key is configured for provider"""
        return has_system_api_key(provider_id)

    async def bulk_operation(
        self,
        tenant_id: str,
        operation: str,
        provider_id: Optional[str],
        admin_id: str,
        admin_email: str,
    ) -> TenantAIConfig:
        """Perform bulk operations on model configuration"""
        config = await self.get_config(tenant_id)
        if not config:
            raise NotFoundError("TenantAIConfig", tenant_id)

        registry = await get_global_model_registry(self.db)
        provider_configs = dict(config.provider_configs)

        if operation == "enable_all":
            providers_to_update = (
                [provider_id] if provider_id else list(PROVIDER_NAMES.keys())
            )
            for pid in providers_to_update:
                active_models = [
                    model["id"]
                    for model in registry.get(pid, [])
                    if model.get("is_active", True)
                ]
                if active_models:
                    provider_configs[pid] = ProviderConfig(
                        provider_id=pid,
                        enabled=True,
                        enabled_models=active_models,
                    )

        elif operation == "disable_all":
            providers_to_update = (
                [provider_id] if provider_id else list(provider_configs.keys())
            )
            for pid in providers_to_update:
                if pid in provider_configs:
                    provider_configs[pid].enabled_models = []

        elif operation == "reset_defaults":
            provider_configs = {}

        update = TenantAIConfigUpdate(provider_configs=provider_configs)
        return await self.update_config(tenant_id, update, admin_id, admin_email)

    async def list_configs(
        self, page: int = 1, per_page: int = 20, search: Optional[str] = None
    ) -> Tuple[List[TenantAIConfig], int]:
        """List all tenant AI configurations with pagination"""
        query = {}
        if search:
            query["tenant_id"] = {"$regex": escape_regex(search), "$options": "i"}

        total = await self.collection.count_documents(query)
        skip = (page - 1) * per_page

        cursor = self.collection.find(query).skip(skip).limit(per_page)
        configs = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            configs.append(TenantAIConfig(**doc))

        return configs, total

    async def delete_config(
        self, tenant_id: str, admin_id: str, admin_email: str
    ) -> bool:
        """Delete tenant AI configuration"""
        result = await self.collection.delete_one({"tenant_id": tenant_id})
        if result.deleted_count > 0:
            self._invalidate_cache(tenant_id)
            await self._log_audit(admin_id, admin_email, tenant_id, "delete", {})
            return True
        return False

    # ------------------------------------------------------------------
    # BYOK key management
    # ------------------------------------------------------------------

    async def set_tutor_api_key(
        self, tenant_id: str, provider_id: str, plaintext_key: str
    ) -> None:
        """Encrypt and store a tutor's BYOK API key."""
        from app.core.encryption import encrypt_api_key

        provider_id = normalize_provider(provider_id)
        if provider_id not in PROVIDER_NAMES:
            raise ValidationError(f"Unsupported provider: {provider_id}")

        config = await self.get_or_create_default(tenant_id)
        if not config.allow_custom_api_keys:
            raise ValidationError("Custom API keys are disabled for this tenant")

        cleaned_key = plaintext_key.strip()
        if not cleaned_key:
            raise ValidationError("API key cannot be empty")

        encrypted = encrypt_api_key(cleaned_key)

        # Upsert provider_configs.<provider_id>
        existing_pc = config.provider_configs.get(provider_id)
        pc_dict = (
            existing_pc.model_dump()
            if existing_pc
            else {
                "provider_id": provider_id,
                "enabled": True,
                "enabled_models": [],
                "priority": 0,
            }
        )
        pc_dict["encrypted_api_key"] = encrypted
        pc_dict["has_custom_key"] = True

        await self.collection.update_one(
            {"tenant_id": tenant_id},
            {
                "$set": {
                    f"provider_configs.{provider_id}": pc_dict,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        self._invalidate_cache(tenant_id)
        logger.info("Stored BYOK key", tenant_id=tenant_id, provider=provider_id)

    async def delete_tutor_api_key(self, tenant_id: str, provider_id: str) -> None:
        """Remove a tutor's BYOK API key."""
        provider_id = normalize_provider(provider_id)
        if provider_id not in PROVIDER_NAMES:
            raise ValidationError(f"Unsupported provider: {provider_id}")

        await self.collection.update_one(
            {"tenant_id": tenant_id},
            {
                "$set": {
                    f"provider_configs.{provider_id}.encrypted_api_key": None,
                    f"provider_configs.{provider_id}.has_custom_key": False,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        self._invalidate_cache(tenant_id)
        logger.info("Deleted BYOK key", tenant_id=tenant_id, provider=provider_id)

    async def get_tutor_provider_status(
        self, tenant_id: str
    ) -> List[TutorProviderStatus]:
        """Return per-provider status visible to the tutor."""
        from app.core.encryption import mask_api_key, decrypt_api_key

        config = await self.get_or_create_default(tenant_id)
        provider_availability = {
            provider.provider_id: provider
            for provider in await self._build_provider_availability(config)
        }

        statuses: List[TutorProviderStatus] = []
        for pid, display_name in PROVIDER_NAMES.items():
            availability = provider_availability.get(pid)
            has_system = self._check_api_key(pid)
            pc = config.provider_configs.get(pid)
            has_custom = bool(pc and pc.encrypted_api_key)
            masked = None
            if has_custom and pc and pc.encrypted_api_key:
                try:
                    masked = mask_api_key(decrypt_api_key(pc.encrypted_api_key))
                except Exception:
                    masked = "***"

            statuses.append(
                TutorProviderStatus(
                    provider_id=pid,
                    name=display_name,
                    has_system_key=has_system,
                    has_custom_key=has_custom,
                    key_source=get_tenant_provider_key_source(config, pid),
                    available=availability.available if availability else False,
                    masked_key=masked,
                    enabled_models=(
                        pc.enabled_models
                        if pc and pc.enabled_models
                        else [model.model_id for model in availability.models]
                        if availability
                        else []
                    ),
                    models=availability.models if availability else [],
                )
            )

        return statuses

    async def _log_audit(
        self,
        admin_id: str,
        admin_email: str,
        tenant_id: str,
        action: str,
        changes: Dict[str, Any],
        previous_values: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log configuration change for audit"""
        log_entry = ConfigChangeAuditLog(
            admin_id=admin_id,
            admin_email=admin_email,
            tenant_id=tenant_id,
            action=action,
            changes=changes,
            previous_values=previous_values,
        )
        await self.audit_collection.insert_one(log_entry.model_dump())

    async def get_audit_logs(
        self, tenant_id: Optional[str] = None, page: int = 1, per_page: int = 50
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Get audit logs for tenant configurations"""
        query = {}
        if tenant_id:
            query["tenant_id"] = tenant_id

        total = await self.audit_collection.count_documents(query)
        skip = (page - 1) * per_page

        cursor = (
            self.audit_collection.find(query)
            .sort("timestamp", -1)
            .skip(skip)
            .limit(per_page)
        )
        logs = await cursor.to_list(length=per_page)
        logs = [_json_safe(log) for log in logs]

        return logs, total
