"""
Base node class and utility functions for LangGraph agent nodes.
"""

from typing import Optional
import json
import re
import structlog

from app.agents.graph.state import AgentState, ThinkingStep
from app.agents.streaming.sse_handler import SSEHandler

logger = structlog.get_logger()


def sanitize_json_string(content: str) -> str:
    """
    Sanitize a JSON string by fixing common escape sequence issues.
    This handles cases where LLMs generate invalid JSON with unescaped backslashes,
    especially in LaTeX formulas like \\frac, \\sqrt, etc.
    """
    # First, try to parse as-is
    try:
        json.loads(content)
        return content  # Already valid
    except json.JSONDecodeError:
        pass

    # Fix common LaTeX escape issues in JSON strings
    def fix_escapes(match):
        s = match.group(0)
        result = []
        i = 0
        while i < len(s):
            if s[i] == "\\":
                if i + 1 < len(s):
                    next_char = s[i + 1]
                    # Valid JSON escape sequences
                    if next_char in '"\\bfnrtu/':
                        result.append(s[i : i + 2])
                        i += 2
                        continue
                    else:
                        # Invalid escape - double the backslash
                        result.append("\\\\")
                        i += 1
                        continue
                else:
                    # Trailing backslash
                    result.append("\\\\")
                    i += 1
            else:
                result.append(s[i])
                i += 1
        return "".join(result)

    # Process string contents (between quotes)
    fixed = re.sub(r'"([^"]*)"', lambda m: '"' + fix_escapes(m) + '"', content)

    return fixed


class BaseNode:
    """Base class for agent nodes"""

    def __init__(self, llm, sse_handler: Optional[SSEHandler] = None):
        self.llm = llm
        self.sse_handler = sse_handler

    async def emit_thinking(self, step: str) -> None:
        """Emit a thinking step to the stream"""
        if self.sse_handler:
            await self.sse_handler.send_thinking(step)

    async def emit_action(self, step: str) -> None:
        """Emit an action step to the stream"""
        if self.sse_handler:
            await self.sse_handler.send_action(step)

    def add_thinking_step(
        self, state: AgentState, step_type: str, content: str
    ) -> None:
        """Add a thinking step to state"""
        state["thinking_steps"].append(
            ThinkingStep(step_type=step_type, content=content)
        )

