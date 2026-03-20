"""AI module exports with lazy loading."""

from importlib import import_module

__all__ = [
    "AIManager",
    "CostTrackingService",
    "AIProvider",
]


def __getattr__(name: str):
    if name == "AIManager":
        return import_module("app.ai.services.ai_manager").AIManager
    if name == "CostTrackingService":
        return import_module("app.ai.services.cost_tracker").CostTrackingService
    if name == "AIProvider":
        return import_module("app.ai.providers.base").AIProvider
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
