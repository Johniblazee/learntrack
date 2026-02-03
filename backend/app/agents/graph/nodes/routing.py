"""
Routing node for LangGraph agent.
Determines which action path to take based on state.
"""

import structlog

from app.agents.graph.state import AgentState, ActionType
from .base import BaseNode

logger = structlog.get_logger()


class GeneratePathNode(BaseNode):
    """
    Central routing node that determines which action path to take.
    Based on a stateful, conditional routing pattern.

    Routes to:
    - generateArtifact: New question generation
    - updateArtifact: Edit existing question
    - rewriteArtifact: Regenerate with same params
    - rewriteArtifactTheme: Change difficulty/type/style
    - respondToQuery: Answer questions about content
    """

    async def __call__(self, state: AgentState) -> AgentState:
        """Analyze intent and route to appropriate action"""
        await self.emit_thinking("Analyzing request to determine action...")

        try:
            # Check if we have a user query (for respondToQuery)
            user_query = state.get("user_query")
            target_id = state.get("target_question_id")
            new_theme = state.get("new_theme")

            # Determine action based on state
            if user_query and not target_id:
                # User is asking about content, not generating
                action = ActionType.RESPOND_TO_QUERY
                await self.emit_thinking("Detected: Query about generated content")

            elif target_id and new_theme:
                # Updating with new style/parameters
                action = ActionType.REWRITE_ARTIFACT_THEME
                await self.emit_thinking(
                    f"Detected: Rewriting question {target_id} with new style"
                )

            elif target_id and user_query:
                # Editing existing question with instructions
                action = ActionType.UPDATE_ARTIFACT
                await self.emit_thinking(f"Detected: Updating question {target_id}")

            elif target_id:
                # Regenerating specific question
                action = ActionType.REWRITE_ARTIFACT
                await self.emit_thinking(f"Detected: Regenerating question {target_id}")

            else:
                # Default: generate new questions
                action = ActionType.GENERATE_ARTIFACT
                await self.emit_thinking("Detected: Generate new questions")

            state["next_action"] = action
            self.add_thinking_step(state, "observation", f"Action: {action.value}")

        except Exception as e:
            logger.error("generatePath failed", error=str(e))
            state["next_action"] = ActionType.GENERATE_ARTIFACT
            state["error"] = str(e)

        return state

