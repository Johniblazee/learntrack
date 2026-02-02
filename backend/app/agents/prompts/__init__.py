"""
Re-export from the new prompt_manager system for backward compatibility.
"""

from app.core.prompt_manager import get_prompt, get_prompt_metadata, list_prompts

__all__ = ["get_prompt", "get_prompt_metadata", "list_prompts"]
