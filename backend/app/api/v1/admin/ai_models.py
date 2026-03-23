"""
Admin API endpoints for AI Model Registry and Global Model Management.

Provides:
- GET  /              — static registry + DB overrides (no vendor API calls)
- GET  /refresh       — force-fetch live models from vendor APIs, merge + return
- PUT  /{provider}/{model_id}/toggle    — toggle global active/inactive
- PUT  /{provider}/{model_id}/set-default — set a model as the provider default
- GET  /tenant-configs — paginated list of all tenant AI configs
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
import structlog

from app.core.ai_models_config import ALL_PROVIDER_MODELS
from app.core.config import settings
from app.core.dependencies import get_database
from app.core.enhanced_auth import ClerkUserContext, require_admin_permission
from app.models.user import AdminPermission
from app.services.tenant_ai_config_service import TenantAIConfigService
from app.ai.services.models_fetcher import (
    fetch_groq_models,
    fetch_openai_models,
    fetch_gemini_models,
    fetch_anthropic_models,
    _models_cache,
    _get_cache,
)

logger = structlog.get_logger()

router = APIRouter()

_perm = require_admin_permission(AdminPermission.MANAGE_AI_PROVIDERS)

GLOBAL_OVERRIDES_COLLECTION = "global_ai_model_overrides"

_LIVE_FETCH_LIMIT = 200

# Provider display names
_PROVIDER_NAMES = {
    "groq": "Groq",
    "openai": "OpenAI",
    "gemini": "Google Gemini",
    "anthropic": "Anthropic",
}

# Map provider → settings key name
_PROVIDER_KEY_ATTRS = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}

# Map provider → fetcher function
_PROVIDER_FETCHERS = {
    "groq": fetch_groq_models,
    "openai": fetch_openai_models,
    "gemini": fetch_gemini_models,
    "anthropic": fetch_anthropic_models,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_overrides(db: AsyncIOMotorDatabase) -> dict:
    """Load all global overrides keyed by 'provider:model_id'."""
    overrides: dict = {}
    cursor = db[GLOBAL_OVERRIDES_COLLECTION].find()
    async for doc in cursor:
        key = f"{doc['provider']}:{doc['model_id']}"
        overrides[key] = doc
    return overrides


def _provider_has_key(provider: str) -> bool:
    attr = _PROVIDER_KEY_ATTRS.get(provider)
    return bool(attr and getattr(settings, attr, None))


async def _fetch_live_models_with_status() -> tuple[dict, dict]:
    """
    Fetch models from each vendor API that has a configured key.
    Returns (live_models_dict, provider_status_dict).
    Status per provider: {"has_key": bool, "connected": bool, "model_count": int}
    """
    live: dict = {}
    status: dict = {}

    for provider, fetcher in _PROVIDER_FETCHERS.items():
        has_key = _provider_has_key(provider)
        if not has_key:
            status[provider] = {"has_key": False, "connected": False, "model_count": 0}
            continue
        try:
            api_key = getattr(settings, _PROVIDER_KEY_ATTRS[provider])
            models = await fetcher(api_key, _LIVE_FETCH_LIMIT)
            live[provider] = models
            status[provider] = {
                "has_key": True,
                "connected": len(models) > 0,
                "model_count": len(models),
            }
        except Exception as e:
            logger.warning("Live model fetch failed", provider=provider, error=str(e))
            status[provider] = {"has_key": True, "connected": False, "model_count": 0}

    return live, status


def _build_provider_status_no_fetch() -> dict:
    """Build provider status without calling any APIs — uses cache if available."""
    status: dict = {}
    for provider in _PROVIDER_FETCHERS:
        has_key = _provider_has_key(provider)
        cached = _get_cache(provider)
        status[provider] = {
            "has_key": has_key,
            "connected": cached is not None and len(cached) > 0,
            "model_count": len(cached) if cached else 0,
            "cached": cached is not None,
        }
    return status


def _merge_registry(
    static: dict,
    live: dict,
    overrides: dict,
    live_primary_providers: set | None = None,
) -> dict:
    """
    Merge static config, live-fetched models, and DB overrides into a single
    provider → model list mapping.

    For providers in *live_primary_providers*, live API data is the primary
    source — static entries only contribute metadata (description, vision,
    tools) for models that also appear in the live list.

    For all other providers, static is primary and live models are appended.

    DB overrides (is_active / is_default) always win regardless.
    """
    merged: dict = {}
    live_primary = live_primary_providers or set()

    all_providers = set(static.keys()) | set(live.keys())

    for provider in all_providers:
        seen_ids: set = set()
        models: list = []

        if provider in live_primary and provider in live:
            # Build a lookup of static metadata keyed by model id
            static_lookup: dict = {}
            for sm in static.get(provider, []):
                s = sm.model_dump() if hasattr(sm, "model_dump") else dict(sm)
                static_lookup[s["id"]] = s

            # Live models are the primary list
            for lm in live[provider]:
                mid = lm["id"]
                sm = static_lookup.get(mid, {})
                key = f"{provider}:{mid}"
                ovr = overrides.get(key, {})

                models.append({
                    "id": mid,
                    "name": sm.get("name") or lm.get("name", mid),
                    "description": sm.get("description") or lm.get("description", ""),
                    "context_window": lm.get("context_window") or sm.get("context_window", 0),
                    "is_active": ovr.get("is_active", sm.get("is_active", False)),
                    "is_default": ovr.get("is_default", sm.get("is_default", False)),
                    "supports_vision": sm.get("supports_vision", False),
                    "supports_tools": sm.get("supports_tools", True),
                    "source": "live",
                })
                seen_ids.add(mid)
        else:
            # Static entries are the primary list
            for sm in static.get(provider, []):
                s = sm.model_dump() if hasattr(sm, "model_dump") else dict(sm)
                key = f"{provider}:{s['id']}"
                ovr = overrides.get(key, {})
                if "is_active" in ovr:
                    s["is_active"] = ovr["is_active"]
                if "is_default" in ovr:
                    s["is_default"] = ovr["is_default"]
                s["source"] = "static"
                models.append(s)
                seen_ids.add(s["id"])

            # Append any live-only models not in static
            for lm in live.get(provider, []):
                if lm["id"] in seen_ids:
                    continue
                key = f"{provider}:{lm['id']}"
                ovr = overrides.get(key, {})
                models.append({
                    "id": lm["id"],
                    "name": lm.get("name", lm["id"]),
                    "description": lm.get("description", ""),
                    "context_window": lm.get("context_window", 0),
                    "is_active": ovr.get("is_active", False),
                    "is_default": ovr.get("is_default", False),
                    "supports_vision": False,
                    "supports_tools": True,
                    "source": "live",
                })
                seen_ids.add(lm["id"])

        merged[provider] = models

    return merged


# ---------------------------------------------------------------------------
# Pydantic helpers
# ---------------------------------------------------------------------------

class ToggleBody(BaseModel):
    is_active: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/")
async def get_model_registry(
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: ClerkUserContext = Depends(_perm),
):
    """
    Return model registry: static config + DB overrides.
    Groq models are always fetched live (30-min cache).
    Other providers use cached live data if available.
    """
    overrides = await _get_overrides(db)

    live: dict = {}
    provider_status: dict = {}

    # Groq: always fetch live (uses 30-min cache internally)
    if settings.GROQ_API_KEY:
        try:
            groq_models = await fetch_groq_models(
                settings.GROQ_API_KEY, _LIVE_FETCH_LIMIT
            )
            live["groq"] = groq_models
            provider_status["groq"] = {
                "has_key": True,
                "connected": len(groq_models) > 0,
                "model_count": len(groq_models),
            }
        except Exception:
            provider_status["groq"] = {
                "has_key": True,
                "connected": False,
                "model_count": 0,
            }
    else:
        provider_status["groq"] = {
            "has_key": False,
            "connected": False,
            "model_count": 0,
        }

    # Other providers: use cached live data only (no API calls)
    for provider in _PROVIDER_FETCHERS:
        if provider == "groq":
            continue
        has_key = _provider_has_key(provider)
        cached = _get_cache(provider)
        if cached:
            live[provider] = cached
        provider_status[provider] = {
            "has_key": has_key,
            "connected": cached is not None and len(cached) > 0,
            "model_count": len(cached) if cached else 0,
            "cached": cached is not None,
        }

    merged = _merge_registry(
        ALL_PROVIDER_MODELS, live, overrides,
        live_primary_providers={"groq"},
    )

    return {
        "providers": merged,
        "provider_status": provider_status,
    }


@router.get("/refresh")
async def refresh_models(
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Clear the live-model cache, fetch from vendor APIs, and return fresh registry."""
    _models_cache.clear()
    live, provider_status = await _fetch_live_models_with_status()
    overrides = await _get_overrides(db)
    # On refresh, any provider that returned live models becomes live-primary
    live_primary = {p for p, models in live.items() if models}
    merged = _merge_registry(
        ALL_PROVIDER_MODELS, live, overrides,
        live_primary_providers=live_primary,
    )
    return {
        "providers": merged,
        "provider_status": provider_status,
    }


@router.put("/{provider}/{model_id:path}/toggle")
async def toggle_model_active(
    provider: str,
    model_id: str,
    body: ToggleBody,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Toggle a model's global is_active flag."""
    coll = db[GLOBAL_OVERRIDES_COLLECTION]
    await coll.update_one(
        {"provider": provider, "model_id": model_id},
        {"$set": {"provider": provider, "model_id": model_id, "is_active": body.is_active}},
        upsert=True,
    )
    logger.info(
        "Model active toggled",
        provider=provider,
        model_id=model_id,
        is_active=body.is_active,
        admin=current_user.user_id,
    )
    return {"provider": provider, "model_id": model_id, "is_active": body.is_active}


@router.put("/{provider}/{model_id:path}/set-default")
async def set_default_model(
    provider: str,
    model_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Set a model as the default for its provider (clears previous default)."""
    coll = db[GLOBAL_OVERRIDES_COLLECTION]

    # Un-default all models for this provider
    await coll.update_many(
        {"provider": provider, "is_default": True},
        {"$set": {"is_default": False}},
    )

    # Set the new default (also ensure it's active)
    await coll.update_one(
        {"provider": provider, "model_id": model_id},
        {"$set": {
            "provider": provider,
            "model_id": model_id,
            "is_default": True,
            "is_active": True,
        }},
        upsert=True,
    )

    logger.info(
        "Default model set",
        provider=provider,
        model_id=model_id,
        admin=current_user.user_id,
    )
    return {"provider": provider, "model_id": model_id, "is_default": True}


@router.get("/tenant-configs")
async def get_tenant_configs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    current_user: ClerkUserContext = Depends(_perm),
):
    """List all tenant AI configurations with pagination."""
    service = TenantAIConfigService(db)
    configs, total = await service.list_configs(page, per_page, search)
    return {
        "items": [c.model_dump() for c in configs],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }
