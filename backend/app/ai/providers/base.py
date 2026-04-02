"""AI provider enums used by the app-owned chat runtime."""

from enum import Enum


class AIProvider(str, Enum):
    """Available AI providers"""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GROQ = "groq"
    GEMINI = "gemini"
    # Legacy alias
    GOOGLE = "gemini"
