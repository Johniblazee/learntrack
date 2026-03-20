"""
AI provider enums.

The ``BaseAIProvider`` ABC has been removed — all LLM calls now go through
LiteLLM via ``app.ai.litellm_provider``.
"""

from enum import Enum


class AIProvider(str, Enum):
    """Available AI providers"""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GROQ = "groq"
    GEMINI = "gemini"
    # Legacy alias
    GOOGLE = "gemini"
