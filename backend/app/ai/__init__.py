"""AI module exports with lazy loading."""

from importlib import import_module

__all__ = [
    "AIManager",
    "CostTrackingService",
    "BaseAIProvider",
    "OpenAIProvider",
    "GroqProvider",
    "GeminiProvider",
]


def __getattr__(name: str):
    if name == "AIManager":
        return import_module("app.ai.services.ai_manager").AIManager
    if name == "CostTrackingService":
        return import_module("app.ai.services.cost_tracker").CostTrackingService
    if name == "BaseAIProvider":
        return import_module("app.ai.providers.base").BaseAIProvider
    if name == "OpenAIProvider":
        return import_module("app.ai.providers.openai_provider").OpenAIProvider
    if name == "GroqProvider":
        return import_module("app.ai.providers.groq_provider").GroqProvider
    if name == "GeminiProvider":
        return import_module("app.ai.providers.gemini_provider").GeminiProvider
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
