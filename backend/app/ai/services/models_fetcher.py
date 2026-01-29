"""
Dynamic model fetcher service - fetches available models from AI provider APIs.
"""
import httpx
import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import structlog

from app.core.config import settings

logger = structlog.get_logger()

# Cache for models with TTL
_models_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_MINUTES = 30


def _is_cache_valid(provider: str) -> bool:
    """Check if cache is still valid for a provider."""
    if provider not in _models_cache:
        return False
    cached = _models_cache[provider]
    return datetime.now() < cached.get("expires_at", datetime.min)


def _set_cache(provider: str, models: List[Dict[str, Any]]) -> None:
    """Cache models for a provider."""
    _models_cache[provider] = {
        "models": models,
        "expires_at": datetime.now() + timedelta(minutes=CACHE_TTL_MINUTES)
    }


def _get_cache(provider: str) -> Optional[List[Dict[str, Any]]]:
    """Get cached models for a provider if valid."""
    if _is_cache_valid(provider):
        return _models_cache[provider]["models"]
    return None


async def fetch_groq_models(api_key: str, limit: int = 3) -> List[Dict[str, Any]]:
    """Fetch models from Groq API (OpenAI compatible endpoint)."""
    cached = _get_cache("groq")
    if cached:
        return cached

    must_include_prefixes = ["openai/gpt-oss", "llama-3.3"]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"}
            )
            response.raise_for_status()
            data = response.json()

            models = []
            for m in data.get("data", []):
                model_id = m.get("id", "")
                if any(x in model_id.lower() for x in ["embed", "whisper", "guard", "tts", "rerank"]):
                    continue
                if not any(model_id.startswith(prefix) or prefix in model_id for prefix in must_include_prefixes):
                    continue

                if "gpt-oss-120b" in model_id:
                    priority = 0
                elif "gpt-oss-20b" in model_id:
                    priority = 1
                elif "llama-3.3" in model_id:
                    priority = 2
                else:
                    priority = 99

                models.append({
                    "id": model_id,
                    "name": model_id.replace("-", " ").title(),
                    "description": f"Context: {m.get('context_window', 'N/A')} tokens",
                    "context_window": m.get("context_window", 0),
                    "priority": priority
                })

            models.sort(key=lambda x: x.get("priority", 999))
            _set_cache("groq", models)
            return models
    except Exception as e:
        logger.error("Failed to fetch Groq models", error=str(e))
        return []


async def fetch_openai_models(api_key: str, limit: int = 3) -> List[Dict[str, Any]]:
    """Fetch models from OpenAI API."""
    cached = _get_cache("openai")
    if cached:
        return cached

    include_prefixes = ["gpt-4o", "gpt-4.1", "o1", "o3", "o4-mini"]
    exclude_patterns = ["realtime", "audio", "transcribe", "tts", "search"]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"}
            )
            response.raise_for_status()
            data = response.json()

            models = []
            for m in data.get("data", []):
                model_id = m.get("id", "")
                if any(x in model_id.lower() for x in exclude_patterns):
                    continue
                if not any(model_id.startswith(prefix) for prefix in include_prefixes):
                    continue

                if model_id.startswith("gpt-4o"):
                    priority = 0 if model_id == "gpt-4o" else 1
                elif model_id.startswith("gpt-4.1"):
                    priority = 10
                elif model_id.startswith("o4-mini"):
                    priority = 20
                elif model_id.startswith("o3"):
                    priority = 30
                elif model_id.startswith("o1"):
                    priority = 40
                else:
                    priority = 99

                models.append({
                    "id": model_id,
                    "name": model_id.upper().replace("-", " "),
                    "description": f"OpenAI {model_id}",
                    "priority": priority
                })

            models.sort(key=lambda x: x.get("priority", 999))
            _set_cache("openai", models)
            return models
    except Exception as e:
        logger.error("Failed to fetch OpenAI models", error=str(e))
        return []


async def fetch_gemini_models(api_key: str, limit: int = 3) -> List[Dict[str, Any]]:
    """Fetch models from Google Gemini API."""
    cached = _get_cache("gemini")
    if cached:
        return cached

    include_prefixes = ["gemini-3", "gemini-2.5"]
    exclude_patterns = ["embed", "aqa", "vision", "image", "video", "audio", "live"]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            )
            response.raise_for_status()
            data = response.json()

            models = []
            for m in data.get("models", []):
                model_name = m.get("name", "").replace("models/", "")
                display_name = m.get("displayName", model_name)

                if "generateContent" not in str(m.get("supportedGenerationMethods", [])):
                    continue
                if any(x in model_name.lower() for x in exclude_patterns):
                    continue
                if not any(model_name.startswith(prefix) for prefix in include_prefixes):
                    continue

                if model_name.startswith("gemini-3"):
                    priority = 0
                elif model_name.startswith("gemini-2.5"):
                    priority = 10
                else:
                    priority = 99

                models.append({
                    "id": model_name,
                    "name": display_name,
                    "description": m.get("description", "")[:100],
                    "priority": priority
                })

            models.sort(key=lambda x: x.get("priority", 999))
            _set_cache("gemini", models)
            return models
    except Exception as e:
        logger.error("Failed to fetch Gemini models", error=str(e))
        return []


async def fetch_anthropic_models(api_key: str, limit: int = 3) -> List[Dict[str, Any]]:
    """Fetch models from Anthropic API."""
    cached = _get_cache("anthropic")
    if cached:
        return cached[:limit]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01"
                }
            )
            response.raise_for_status()
            data = response.json()

            models = []
            for m in data.get("data", []):
                model_id = m.get("id", "")
                display_name = m.get("display_name", model_id)

                models.append({
                    "id": model_id,
                    "name": display_name,
                    "description": f"Anthropic {display_name}",
                })

            _set_cache("anthropic", models)
            return models[:limit]
    except Exception as e:
        logger.error("Failed to fetch Anthropic models", error=str(e))
        return []


async def fetch_all_provider_models(limit: int = 3) -> Dict[str, List[Dict[str, Any]]]:
    """Fetch models from all configured providers in parallel."""
    results = {}
    tasks = []
    providers = []

    if settings.GROQ_API_KEY:
        tasks.append(fetch_groq_models(settings.GROQ_API_KEY, limit))
        providers.append("groq")

    if settings.OPENAI_API_KEY:
        tasks.append(fetch_openai_models(settings.OPENAI_API_KEY, limit))
        providers.append("openai")

    if settings.GEMINI_API_KEY:
        tasks.append(fetch_gemini_models(settings.GEMINI_API_KEY, limit))
        providers.append("gemini")

    if settings.ANTHROPIC_API_KEY:
        tasks.append(fetch_anthropic_models(settings.ANTHROPIC_API_KEY, limit))
        providers.append("anthropic")

    if tasks:
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        for provider, response in zip(providers, responses):
            if isinstance(response, Exception):
                logger.error(f"Error fetching {provider} models", error=str(response))
                results[provider] = []
            else:
                results[provider] = response

    return results

