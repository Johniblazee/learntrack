"""Unified LiteLLM provider factory."""

from typing import Optional

import structlog
from langchain_community.chat_models import ChatLiteLLM

from app.ai.litellm_runtime import LiteLLMRuntime
from app.core.config import settings
from app.core.encryption import decrypt_api_key
from app.core.exceptions import AIProviderError

logger = structlog.get_logger()

# Map provider_id → LiteLLM model prefix
_PROVIDER_PREFIX = {
    "openai": "openai",
    "anthropic": "anthropic",
    "gemini": "gemini",
    "groq": "groq",
}

# Map provider_id → settings attribute for the system env-var key
_SYSTEM_KEY_ATTR = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
}


def _resolve_api_key(
    provider_id: str,
    encrypted_tutor_key: Optional[str] = None,
) -> str:
    """Return the best available API key for *provider_id*.

    Priority:
    1. Tutor BYOK key (decrypt from DB).
    2. System env-var fallback.
    3. Raise ``AIProviderError``.
    """
    # 1. BYOK key
    if encrypted_tutor_key:
        try:
            return decrypt_api_key(encrypted_tutor_key)
        except Exception:
            logger.warning(
                "Failed to decrypt tutor BYOK key, falling back to system key",
                provider=provider_id,
            )

    # 2. System env-var
    attr = _SYSTEM_KEY_ATTR.get(provider_id)
    if attr:
        system_key = getattr(settings, attr, None)
        if system_key and len(system_key) > 10:
            return system_key

    raise AIProviderError(
        f"No API key available for provider '{provider_id}'. "
        "Configure a system key or add your own in Settings → AI."
    )


def create_litellm_chat_model(
    provider_id: str,
    model_id: str,
    encrypted_tutor_key: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
):
    """Return an app-owned LiteLLM runtime wrapper.

    Args:
        provider_id: One of ``"openai"``, ``"anthropic"``, ``"gemini"``, ``"groq"``.
        model_id: The provider-specific model identifier (e.g. ``"gpt-4o"``).
        encrypted_tutor_key: Optional Fernet-encrypted BYOK key from MongoDB.
        temperature: Sampling temperature.
        max_tokens: Maximum output tokens.

    Returns:
        A runtime wrapper that implements ``ainvoke`` / ``astream`` plus
        app-level structured output, tool calling, retry, and usage helpers.
    """
    prefix = _PROVIDER_PREFIX.get(provider_id)
    if prefix is None:
        raise AIProviderError(f"Unsupported provider: {provider_id}")

    api_key = _resolve_api_key(provider_id, encrypted_tutor_key)
    litellm_model = f"{prefix}/{model_id}"

    logger.debug(
        "Creating LiteLLM chat model",
        provider=provider_id,
        model=litellm_model,
    )

    return LiteLLMRuntime(
        provider_id=provider_id,
        model_id=model_id,
        litellm_model=litellm_model,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
    )


async def test_api_key(provider_id: str, plaintext_key: str) -> bool:
    """Fire a minimal LLM call to verify a key works.

    Returns ``True`` on success, raises on failure.
    """
    prefix = _PROVIDER_PREFIX.get(provider_id)
    if prefix is None:
        raise AIProviderError(f"Unsupported provider: {provider_id}")

    # Pick a cheap model per provider for the test call
    test_models = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-haiku-20241022",
        "gemini": "gemini-2.0-flash",
        "groq": "llama-3.1-8b-instant",
    }
    model_id = test_models.get(provider_id, "gpt-4o-mini")

    llm = ChatLiteLLM(
        model=f"{prefix}/{model_id}",
        api_key=plaintext_key,
        temperature=0,
        max_tokens=5,
    )

    from langchain_core.messages import HumanMessage

    await llm.ainvoke([HumanMessage(content="Hi")])
    return True
