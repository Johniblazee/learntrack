"""Lightweight RAG package exports."""

from importlib import import_module

__all__ = [
    "AgenticRAGAgent",
    "RAGState",
    "RAGConfig",
    "RetrievedDocument",
    "QueryAnalyzerNode",
    "RetrieverNode",
    "RelevanceGraderNode",
    "QueryRewriterNode",
    "AnswerGeneratorNode",
    "HallucinationCheckerNode",
]


def __getattr__(name: str):
    if name in {"RAGState", "RAGConfig", "RetrievedDocument"}:
        module = import_module("app.agents.rag.state")
        return getattr(module, name)
    if name == "AgenticRAGAgent":
        return import_module("app.agents.rag.graph").AgenticRAGAgent
    if name in {
        "QueryAnalyzerNode",
        "RetrieverNode",
        "RelevanceGraderNode",
        "QueryRewriterNode",
        "AnswerGeneratorNode",
        "HallucinationCheckerNode",
    }:
        module = import_module("app.agents.rag.nodes")
        return getattr(module, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
