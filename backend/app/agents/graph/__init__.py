"""Lightweight graph package exports."""

from importlib import import_module

__all__ = [
    "AgentState",
    "GenerationConfig",
    "ThinkingStep",
    "QuestionGeneratorAgent",
]


def __getattr__(name: str):
    if name in {"AgentState", "GenerationConfig", "ThinkingStep"}:
        module = import_module("app.agents.graph.state")
        return getattr(module, name)
    if name == "QuestionGeneratorAgent":
        return import_module(
            "app.agents.graph.question_generator_graph"
        ).QuestionGeneratorAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
