"""Lightweight agent package exports."""

from importlib import import_module

__all__ = ["QuestionGeneratorAgent"]


def __getattr__(name: str):
    if name == "QuestionGeneratorAgent":
        return import_module(
            "app.agents.graph.question_generator_graph"
        ).QuestionGeneratorAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
