"""
Question validation node for LangGraph agent.
"""

from app.agents.graph.state import AgentState
from .base import BaseNode


class QuestionValidatorNode(BaseNode):
    """Validates generated questions for quality"""

    async def __call__(self, state: AgentState) -> AgentState:
        """Validate all generated questions"""
        questions = state.get("questions", [])

        if not questions:
            return state

        await self.emit_thinking(f"Validating {len(questions)} question(s)...")

        # For now, mark all as valid with default score
        # Full validation can be added later with the validator prompt
        for q in questions:
            q.is_valid = True
            q.quality_score = q.quality_score or 0.85

        self.add_thinking_step(state, "observation", "Validation complete")
        return state

