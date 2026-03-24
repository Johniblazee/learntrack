"""
Centralized AI models configuration and capability lookup helpers.

Update models here and they will be reflected across the entire application.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional
from pydantic import BaseModel


class AIModelConfig(BaseModel):
    """Configuration for a single AI model"""

    id: str  # Model identifier used in API calls
    name: str  # Human-readable display name
    description: str  # Short description of the model
    context_window: int  # Maximum context window size in tokens
    is_active: bool = True  # Whether this model appears in provider dropdowns
    is_default: bool = False  # Whether this is the default model for the provider
    supports_vision: bool = False  # Whether the model supports image inputs
    supports_tools: bool = True  # Whether the model supports function calling
    supports_structured_output: bool = True  # Whether schema/json output is supported
    supports_streaming: bool = True  # Whether token streaming is supported


@dataclass(frozen=True)
class ModelCapabilities:
    context_window: int = 0
    supports_vision: bool = False
    supports_tools: bool = True
    supports_structured_output: bool = True
    supports_streaming: bool = True


# =============================================================================
# GROQ MODELS
# =============================================================================
GROQ_MODELS: List[AIModelConfig] = [
    AIModelConfig(
        id="llama-3.3-70b-versatile",
        name="Llama 3.3 70B",
        description="Most versatile and capable",
        context_window=131072,
        is_active=True,
        is_default=True,
    ),
    AIModelConfig(
        id="openai/gpt-oss-20b",
        name="GPT-OSS 20B",
        description="Open source GPT model via Groq",
        context_window=131072,
        is_active=True,
    ),
    AIModelConfig(
        id="llama-3.1-8b-instant",
        name="Llama 3.1 8B",
        description="Fast responses, lower cost",
        context_window=131072,
        is_active=True,
    ),
    AIModelConfig(
        id="meta-llama/llama-4-maverick-17b-128e-instruct",
        name="Llama 4 Maverick 17B",
        description="Latest multimodal model",
        context_window=131072,
        is_active=True,
        supports_vision=True,
    ),
    AIModelConfig(
        id="mixtral-8x7b-32768",
        name="Mixtral 8x7B",
        description="Mixture of experts model",
        context_window=32768,
        is_active=False,  # Older model
    ),
]

# =============================================================================
# OPENAI MODELS (Disabled - no valid API key)
# =============================================================================
OPENAI_MODELS: List[AIModelConfig] = [
    # All OpenAI models disabled - set is_active=False
    AIModelConfig(
        id="gpt-4o",
        name="GPT-4o",
        description="Most capable multimodal model",
        context_window=128000,
        is_active=False,  # Disabled
        is_default=True,
        supports_vision=True,
    ),
    AIModelConfig(
        id="gpt-4o-mini",
        name="GPT-4o Mini",
        description="Fast and affordable",
        context_window=128000,
        is_active=False,  # Disabled
    ),
    AIModelConfig(
        id="gpt-4-turbo",
        name="GPT-4 Turbo",
        description="High performance",
        context_window=128000,
        is_active=False,  # Disabled
        supports_vision=True,
    ),
    AIModelConfig(
        id="o1",
        name="o1",
        description="Advanced reasoning model",
        context_window=128000,
        is_active=False,  # Disabled
        supports_tools=False,
    ),
]

# =============================================================================
# GEMINI MODELS (Updated January 2026)
# =============================================================================
GEMINI_MODELS: List[AIModelConfig] = [
    # Gemini 3 Series (Latest)
    AIModelConfig(
        id="gemini-3-pro-preview",
        name="Gemini 3 Pro",
        description="Most powerful agentic and reasoning model",
        context_window=1048576,
        is_active=True,
        is_default=True,
        supports_vision=True,
    ),
    # Gemini 2.5 Series
    AIModelConfig(
        id="gemini-2.5-flash",
        name="Gemini 2.5 Flash",
        description="Fast with thinking capabilities",
        context_window=1048576,
        is_active=True,
        supports_vision=True,
    ),
    AIModelConfig(
        id="gemini-2.5-flash-lite",
        name="Gemini 2.5 Flash-Lite",
        description="Ultra fast, cost efficient",
        context_window=1048576,
        is_active=True,
    ),
    AIModelConfig(
        id="gemini-2.5-pro",
        name="Gemini 2.5 Pro",
        description="Advanced thinking model for complex problems",
        context_window=1048576,
        is_active=True,
        supports_vision=True,
    ),
    # Gemini 2.0 Series
    AIModelConfig(
        id="gemini-2.0-flash",
        name="Gemini 2.0 Flash",
        description="Second generation workhorse model",
        context_window=1048576,
        is_active=True,
    ),
    AIModelConfig(
        id="gemini-2.0-flash-lite",
        name="Gemini 2.0 Flash-Lite",
        description="Fast and cost-effective",
        context_window=1048576,
        is_active=False,  # Older, prefer 2.5
    ),
]

# =============================================================================
# ANTHROPIC MODELS
# =============================================================================
ANTHROPIC_MODELS: List[AIModelConfig] = [
    AIModelConfig(
        id="claude-3-5-sonnet-20241022",
        name="Claude 3.5 Sonnet",
        description="Most capable Claude model",
        context_window=200000,
        is_active=True,
        is_default=True,
        supports_vision=True,
    ),
    AIModelConfig(
        id="claude-3-opus-20240229",
        name="Claude 3 Opus",
        description="Highest quality outputs",
        context_window=200000,
        is_active=True,
        supports_vision=True,
    ),
    AIModelConfig(
        id="claude-3-haiku-20240307",
        name="Claude 3 Haiku",
        description="Fast and lightweight",
        context_window=200000,
        is_active=True,
    ),
]


# =============================================================================
# PROVIDER REGISTRY
# =============================================================================
ALL_PROVIDER_MODELS: Dict[str, List[AIModelConfig]] = {
    "groq": GROQ_MODELS,
    "openai": OPENAI_MODELS,
    "gemini": GEMINI_MODELS,
    "anthropic": ANTHROPIC_MODELS,
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================
def get_active_models(provider: str) -> List[AIModelConfig]:
    """Get only active models for a provider (for dropdown display)"""
    models = ALL_PROVIDER_MODELS.get(provider, [])
    return [m for m in models if m.is_active]


def get_default_model(provider: str) -> Optional[str]:
    """Get the default model ID for a provider"""
    models = ALL_PROVIDER_MODELS.get(provider, [])
    for model in models:
        if model.is_default:
            return model.id
    # Fallback to first active model
    active = get_active_models(provider)
    return active[0].id if active else None


def get_model_ids(provider: str, active_only: bool = True) -> List[str]:
    """Get list of model IDs for a provider"""
    if active_only:
        return [m.id for m in get_active_models(provider)]
    return [m.id for m in ALL_PROVIDER_MODELS.get(provider, [])]


def get_model_config(provider: str, model_id: str) -> Optional[AIModelConfig]:
    """Return the closest static model config for a provider/model pair."""
    models = ALL_PROVIDER_MODELS.get(provider, [])
    if not models:
        return None

    exact_match = next((model for model in models if model.id == model_id), None)
    if exact_match is not None:
        return exact_match

    prefix_match = next(
        (
            model
            for model in models
            if model_id.startswith(model.id) or model.id.startswith(model_id)
        ),
        None,
    )
    if prefix_match is not None:
        return prefix_match

    return None


def get_model_capabilities(provider: str, model_id: str) -> ModelCapabilities:
    """Return the best-known capabilities for a model.

    Unknown live-fetched models fall back to provider defaults so runtime checks do
    not unnecessarily block calls.
    """
    model = get_model_config(provider, model_id)
    if model is not None:
        return ModelCapabilities(
            context_window=model.context_window,
            supports_vision=model.supports_vision,
            supports_tools=model.supports_tools,
            supports_structured_output=model.supports_structured_output,
            supports_streaming=model.supports_streaming,
        )

    provider_defaults = {
        "openai": ModelCapabilities(
            context_window=128000,
            supports_vision=True,
            supports_tools=True,
            supports_structured_output=True,
            supports_streaming=True,
        ),
        "anthropic": ModelCapabilities(
            context_window=200000,
            supports_vision=True,
            supports_tools=True,
            supports_structured_output=True,
            supports_streaming=True,
        ),
        "gemini": ModelCapabilities(
            context_window=1048576,
            supports_vision=True,
            supports_tools=True,
            supports_structured_output=True,
            supports_streaming=True,
        ),
        "groq": ModelCapabilities(
            context_window=131072,
            supports_vision=False,
            supports_tools=True,
            supports_structured_output=True,
            supports_streaming=True,
        ),
    }

    return provider_defaults.get(provider, ModelCapabilities())


def get_models_for_dropdown(provider: str) -> List[Dict]:
    """Get models formatted for frontend dropdown"""
    return [
        {
            "id": m.id,
            "name": m.name,
            "description": m.description,
            "context_window": m.context_window,
        }
        for m in get_active_models(provider)
    ]


def get_all_active_models_for_dropdown() -> Dict[str, List[Dict]]:
    """Get all active models for all providers, formatted for frontend"""
    return {
        provider: get_models_for_dropdown(provider)
        for provider in ALL_PROVIDER_MODELS.keys()
    }
