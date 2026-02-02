"""
Prompt Manager - Centralized Prompt Loading and Injection

Loads prompts from .txt files with YAML frontmatter metadata.
Uses Jinja2 templating for variable substitution.
Caches prompts in memory for performance.

File Structure:
    app/prompts/
    ├── question_generator.txt
    ├── question_validator.txt
    ├── rag/
    │   ├── query_analyzer.txt
    │   └── answer_generator.txt
    └── image/
        ├── analyzer.txt
        └── question_generator.txt

Prompt Format (.txt files):
    ---
    name: question_generator
    description: Generates educational questions
    tags: [generation, questions]
    variables: [subject, topic, count, difficulty]
    ---

    You are an expert educational content creator...
    Generate {{count}} questions about {{topic}}...

Usage:
    from app.core.prompt_manager import get_prompt

    prompt = await get_prompt("question_generator",
                              subject="Math",
                              topic="Algebra",
                              count=5)
"""

import os
import re
import structlog
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from jinja2 import Template, UndefinedError

logger = structlog.get_logger()

# Base directory for prompts
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# In-memory cache: {filename: (PromptMetadata, content, mtime)}
_prompt_cache: Dict[str, Tuple["PromptMetadata", str, float]] = {}


@dataclass
class PromptMetadata:
    """Metadata extracted from YAML frontmatter."""

    name: str
    description: Optional[str] = None
    tags: List[str] = None
    variables: List[str] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []
        if self.variables is None:
            self.variables = []


class PromptNotFoundError(Exception):
    """Raised when a prompt file is not found."""

    pass


class PromptCompilationError(Exception):
    """Raised when prompt compilation fails."""

    pass


def _parse_frontmatter(content: str) -> Tuple[PromptMetadata, str]:
    """
    Parse YAML frontmatter from prompt content.

    Returns:
        (metadata, prompt_content_without_frontmatter)
    """
    # Check for frontmatter (between --- markers)
    pattern = r"^---\s*\n(.*?)\n---\s*\n(.*)$"
    match = re.match(pattern, content, re.DOTALL)

    if not match:
        # No frontmatter - create default metadata
        return PromptMetadata(name="unknown"), content

    yaml_content = match.group(1)
    prompt_content = match.group(2).strip()

    # Simple YAML parsing (no external dependency)
    metadata = {}
    current_key = None
    current_value = []

    for line in yaml_content.split("\n"):
        # Check if this is a new key
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            # Save previous key if exists
            if current_key:
                metadata[current_key] = _parse_yaml_value("\n".join(current_value))

            key, value = line.split(":", 1)
            current_key = key.strip()
            current_value = [value.strip()] if value.strip() else []
        elif current_key:
            current_value.append(line)

    # Save last key
    if current_key:
        metadata[current_key] = _parse_yaml_value("\n".join(current_value))

    # Create PromptMetadata
    return PromptMetadata(
        name=metadata.get("name", "unknown"),
        description=metadata.get("description"),
        tags=metadata.get("tags", []),
        variables=metadata.get("variables", []),
    ), prompt_content


def _parse_yaml_value(value: str) -> Any:
    """Parse a YAML value string into Python object."""
    value = value.strip()

    # Empty value
    if not value:
        return None

    # List format: [item1, item2]
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1]
        if not inner.strip():
            return []
        items = []
        for item in inner.split(","):
            item = item.strip().strip("\"'")
            if item:
                items.append(item)
        return items

    # String (strip quotes)
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]

    # Boolean
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False

    # Integer
    try:
        return int(value)
    except ValueError:
        pass

    # Return as string
    return value


def _extract_variables_from_template(content: str) -> List[str]:
    """Extract Jinja2 variable names from template."""
    # Match {{ variable }} or {{variable}}
    pattern = r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}"
    matches = re.findall(pattern, content)
    return list(set(matches))  # Remove duplicates


async def _load_prompt_file(filename: str) -> Tuple[PromptMetadata, str]:
    """
    Load a prompt file with caching.

    Args:
        filename: Name of the prompt (e.g., "question_generator" or "rag/query_analyzer")

    Returns:
        (metadata, content)
    """
    file_path = PROMPTS_DIR / f"{filename}.txt"

    # Check cache
    if filename in _prompt_cache:
        metadata, content, mtime = _prompt_cache[filename]
        # Check if file was modified
        try:
            current_mtime = os.path.getmtime(file_path)
            if current_mtime == mtime:
                return metadata, content
        except FileNotFoundError:
            pass

    # Load from disk
    if not file_path.exists():
        # Try subdirectories
        for subdir in ["rag", "image"]:
            alt_path = PROMPTS_DIR / subdir / f"{filename}.txt"
            if alt_path.exists():
                file_path = alt_path
                break

        if not file_path.exists():
            raise PromptNotFoundError(f"Prompt file not found: {filename}.txt")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()

        mtime = os.path.getmtime(file_path)

        # Parse frontmatter
        metadata, content = _parse_frontmatter(raw_content)

        # Update metadata with extracted variables if not specified
        if not metadata.variables:
            metadata.variables = _extract_variables_from_template(content)

        # Update cache
        _prompt_cache[filename] = (metadata, content, mtime)

        logger.debug("Loaded prompt", name=filename, path=str(file_path))
        return metadata, content

    except Exception as e:
        logger.error("Failed to load prompt", name=filename, error=str(e))
        raise


async def get_prompt(name: str, **variables) -> str:
    """
    Get a compiled prompt by name with variable substitution.

    Args:
        name: Prompt name (e.g., "question_generator" or "rag/query_analyzer")
        **variables: Variables to substitute in the template

    Returns:
        Compiled prompt string

    Raises:
        PromptNotFoundError: If prompt file doesn't exist
        PromptCompilationError: If template compilation fails

    Example:
        prompt = await get_prompt("question_generator",
                                  subject="Biology",
                                  topic="Photosynthesis",
                                  count=5)
    """
    try:
        metadata, content = await _load_prompt_file(name)

        # Compile with Jinja2
        template = Template(content, trim_blocks=True, lstrip_blocks=True)

        try:
            result = template.render(**variables)
        except UndefinedError as e:
            raise PromptCompilationError(f"Missing variable in prompt '{name}': {e}")

        logger.debug("Compiled prompt", name=name, variables=list(variables.keys()))

        return result

    except PromptNotFoundError:
        raise
    except Exception as e:
        logger.error("Failed to compile prompt", name=name, error=str(e))
        raise PromptCompilationError(f"Failed to compile prompt '{name}': {e}")


async def get_prompt_metadata(name: str) -> PromptMetadata:
    """
    Get metadata for a prompt without compiling it.

    Args:
        name: Prompt name

    Returns:
        PromptMetadata object
    """
    metadata, _ = await _load_prompt_file(name)
    return metadata


def list_prompts() -> List[str]:
    """
    List all available prompts.

    Returns:
        List of prompt names (relative paths)
    """
    prompts = []

    if not PROMPTS_DIR.exists():
        return prompts

    # Top-level .txt files
    for file_path in PROMPTS_DIR.glob("*.txt"):
        prompts.append(file_path.stem)

    # Subdirectories
    for subdir in PROMPTS_DIR.iterdir():
        if subdir.is_dir():
            for file_path in subdir.glob("*.txt"):
                rel_path = f"{subdir.name}/{file_path.stem}"
                prompts.append(rel_path)

    return sorted(prompts)


def clear_cache() -> None:
    """Clear the prompt cache. Useful for testing or forcing reload."""
    global _prompt_cache
    _prompt_cache.clear()
    logger.debug("Prompt cache cleared")


# Convenience sync version for non-async contexts (use sparingly)
def get_prompt_sync(name: str, **variables) -> str:
    """
    Synchronous version of get_prompt.

    WARNING: This should only be used in non-async contexts.
    In async code, always use await get_prompt().
    """
    import asyncio

    return asyncio.run(get_prompt(name, **variables))
