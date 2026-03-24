"""
Workflow nodes for LangGraph agent.
Includes follow-up generation, reflection, query response, and cleanup nodes.
"""

from datetime import datetime
import asyncio
import json
import structlog
from langchain_core.messages import HumanMessage, SystemMessage

# Timeout for individual LLM calls (seconds)
LLM_CALL_TIMEOUT = 60

from app.ai.structured_outputs import ReflectionOutput
from app.agents.graph.state import (
    AgentState,
    FollowupSuggestion,
    ReflectionResult,
)
from app.agents.streaming.sse_handler import SSEHandler
from .base import BaseNode, sanitize_json_string

logger = structlog.get_logger()


class GenerateFollowupNode(BaseNode):
    """
    Generates follow-up suggestions after artifact operations.
    Suggests related topics, different difficulty levels, etc.
    """

    async def __call__(self, state: AgentState) -> AgentState:
        """Generate follow-up suggestions"""
        questions = state.get("questions", [])

        if not questions:
            state["followup_suggestions"] = []
            return state

        await self.emit_thinking("Generating follow-up suggestions...")

        try:
            config = state["generation_config"]
            topic = config.topic or state.get("original_prompt", "")[:50]

            suggestions = []

            # Suggest different difficulty
            current_diff = config.difficulty.value
            if current_diff != "hard":
                suggestions.append(
                    FollowupSuggestion(
                        suggestion_type="difficulty",
                        title="Increase Difficulty",
                        description=f"Generate harder questions on {topic}",
                        action_params={"difficulty": "hard"},
                    )
                )
            if current_diff != "easy":
                suggestions.append(
                    FollowupSuggestion(
                        suggestion_type="difficulty",
                        title="Simplify Questions",
                        description="Generate easier questions for beginners",
                        action_params={"difficulty": "easy"},
                    )
                )

            # Suggest different types
            current_types = [t.value for t in config.question_types]
            if "short-answer" not in current_types:
                suggestions.append(
                    FollowupSuggestion(
                        suggestion_type="type",
                        title="Add Short Answer",
                        description="Generate short answer questions",
                        action_params={"types": ["short-answer"]},
                    )
                )
            if "essay" not in current_types:
                suggestions.append(
                    FollowupSuggestion(
                        suggestion_type="type",
                        title="Add Essay Questions",
                        description="Generate essay-type questions",
                        action_params={"types": ["essay"]},
                    )
                )

            # Suggest more questions
            suggestions.append(
                FollowupSuggestion(
                    suggestion_type="expand",
                    title="Generate More",
                    description=f"Add {config.question_count} more questions",
                    action_params={"count": config.question_count},
                )
            )

            # Suggest related topics
            suggestions.append(
                FollowupSuggestion(
                    suggestion_type="topic",
                    title="Related Topics",
                    description="Explore related concepts",
                    action_params={"expand_topics": True},
                )
            )

            state["followup_suggestions"] = suggestions[:4]

            self.add_thinking_step(
                state,
                "observation",
                f"Generated {len(suggestions)} follow-up suggestions",
            )

        except Exception as e:
            logger.error("generateFollowup failed", error=str(e))
            state["followup_suggestions"] = []

        return state


class ReflectNode(BaseNode):
    """
    Self-reflection node that evaluates generated content quality.
    Identifies strengths and areas for improvement.
    """

    async def __call__(self, state: AgentState) -> AgentState:
        """Reflect on generated questions quality"""
        questions = state.get("questions", [])

        if not questions or not state.get("should_reflect", True):
            state["reflection_result"] = None
            return state

        await self.emit_thinking("Evaluating question quality...")

        try:
            questions_text = "\n".join(
                [
                    f"{i + 1}. [{q.type.value}] [{q.difficulty.value}] {q.question_text[:100]}..."
                    for i, q in enumerate(questions)
                ]
            )

            messages = [
                SystemMessage(
                    content="""You are a quality evaluator for educational questions.
Analyze the questions and provide a brief assessment.

Output JSON:
{
    "overall_quality": 0.0-1.0,
    "strengths": ["list", "of", "strengths"],
    "improvements": ["list", "of", "improvements"],
    "should_regenerate": false,
    "regenerate_indices": []
}"""
                ),
                HumanMessage(
                    content=f"""
Evaluate these questions:

{questions_text}

Consider:
- Clarity and correctness
- Difficulty appropriateness
- Variety and coverage
- Educational value
"""
                ),
            ]

            try:
                structured = await asyncio.wait_for(
                    self.llm.ainvoke_structured(messages, ReflectionOutput),
                    timeout=LLM_CALL_TIMEOUT,
                )
                data = structured.model_dump(mode="json")
            except Exception as structured_error:
                logger.warning(
                    "Structured reflection failed, falling back to JSON parsing",
                    error=str(structured_error),
                )
                response = await asyncio.wait_for(
                    self.llm.ainvoke(messages), timeout=LLM_CALL_TIMEOUT
                )
                content = response.content

                if not content or not content.strip():
                    logger.warning(
                        "Empty response from LLM in reflect node, using default"
                    )
                    reflection = ReflectionResult(
                        overall_quality=0.0,
                        strengths=["Questions generated successfully"],
                        improvements=[],
                        should_regenerate=False,
                        regenerate_indices=[],
                    )
                    state["reflection_result"] = reflection
                    return state

                if "```json" in content:
                    json_content = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    json_content = content.split("```")[1].split("```")[0]
                else:
                    json_content = content

                json_content = json_content.strip()

                if not json_content:
                    logger.warning("Empty JSON content in reflect node, using default")
                    reflection = ReflectionResult(
                        overall_quality=0.0,
                        strengths=["Questions generated successfully"],
                        improvements=[],
                        should_regenerate=False,
                        regenerate_indices=[],
                    )
                    state["reflection_result"] = reflection
                    return state

                try:
                    data = json.loads(json_content)
                except json.JSONDecodeError:
                    sanitized = sanitize_json_string(json_content)
                    data = json.loads(sanitized)

            reflection = ReflectionResult(
                overall_quality=data.get("overall_quality", 0.85),
                strengths=data.get("strengths", []),
                improvements=data.get("improvements", []),
                should_regenerate=data.get("should_regenerate", False),
                regenerate_indices=data.get("regenerate_indices", []),
            )

            state["reflection_result"] = reflection

            if self.sse_handler:
                await self.sse_handler.send_thinking(
                    f"Quality: {reflection.overall_quality:.0%}"
                )

            self.add_thinking_step(
                state,
                "observation",
                f"Quality assessment: {reflection.overall_quality:.0%}",
            )

        except asyncio.TimeoutError:
            logger.error("Reflection LLM call timed out")
            state["reflection_result"] = ReflectionResult(
                overall_quality=0.0,
                strengths=[],
                improvements=["Quality evaluation timed out"],
                should_regenerate=False,
                regenerate_indices=[],
            )
        except Exception as e:
            logger.error("reflect failed", error=str(e))
            state["reflection_result"] = ReflectionResult(
                overall_quality=0.0,
                strengths=[],
                improvements=["Quality evaluation failed"],
                should_regenerate=False,
                regenerate_indices=[],
            )

        return state


class RespondToQueryNode(BaseNode):
    """
    Responds to user queries about generated content.
    Explains, clarifies, or provides additional context.
    """

    async def __call__(self, state: AgentState) -> AgentState:
        """Respond to user query about content"""
        query = state.get("user_query", "")
        questions = state.get("questions", [])

        if not query:
            state["response_to_query"] = ""
            return state

        await self.emit_action("Answering your question...")

        try:
            questions_context = "\n".join(
                [
                    f"Q{i + 1}: {q.question_text}\nA: {q.correct_answer}\nExplanation: {q.explanation}"
                    for i, q in enumerate(questions)
                ]
            )

            messages = [
                SystemMessage(
                    content="""You are a helpful educational assistant.
Answer the user's question about the generated questions.
Be clear, concise, and educational."""
                ),
                HumanMessage(
                    content=f"""
## Generated Questions
{questions_context}

## User Question
<user_query>{query[:1000]}</user_query>

Provide a helpful response.
"""
                ),
            ]

            response = await asyncio.wait_for(
                self.llm.ainvoke(messages), timeout=LLM_CALL_TIMEOUT
            )
            state["response_to_query"] = response.content

            self.add_thinking_step(state, "observation", "Responded to query")

        except Exception as e:
            logger.error("respondToQuery failed", error=str(e))
            state["response_to_query"] = f"I couldn't answer that: {str(e)}"

        return state


class CleanStateNode(BaseNode):
    """
    Cleanup node that prepares state for completion or next iteration.
    Clears temporary data and marks completion.
    """

    async def __call__(self, state: AgentState) -> AgentState:
        """Clean up state for completion"""
        await self.emit_thinking("Finalizing...")

        state["is_complete"] = True

        state["next_action"] = None
        state["target_question_id"] = None
        state["new_theme"] = None
        state["user_query"] = None
        state["should_reflect"] = False

        if state.get("artifact"):
            state["artifact"].updated_at = datetime.utcnow()

        self.add_thinking_step(state, "observation", "Generation complete")

        return state
