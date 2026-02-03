"""
Prompt analysis node for LangGraph agent.
"""

import json
import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.graph.state import AgentState, PromptAnalysis
from app.core.prompt_manager import get_prompt
from app.utils.enums import normalize_question_type, normalize_difficulty
from .base import BaseNode

logger = structlog.get_logger()


class PromptAnalyzerNode(BaseNode):
    """Analyzes user prompt to extract generation parameters"""

    async def __call__(self, state: AgentState) -> AgentState:
        """Analyze the user's prompt"""
        await self.emit_thinking("Analyzing your request...")

        try:
            system_prompt = await get_prompt("prompt_analyzer")
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"Analyze this prompt: {state['original_prompt']}"
                ),
            ]

            response = await self.llm.ainvoke(messages)
            content = response.content

            # Parse JSON from response
            json_match = content
            if "```json" in content:
                json_match = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_match = content.split("```")[1].split("```")[0]

            analysis_data = json.loads(json_match.strip())

            # Convert to PromptAnalysis
            analysis = PromptAnalysis(
                subject=analysis_data.get("subject", "General"),
                topic=analysis_data.get("topic", ""),
                question_count=analysis_data.get(
                    "question_count", state["config"].question_count
                ),
                question_types=[
                    normalize_question_type(t)
                    for t in analysis_data.get("question_types", ["multiple-choice"])
                ],
                difficulty=normalize_difficulty(
                    analysis_data.get("difficulty", "medium")
                ),
                blooms_levels=analysis_data.get("blooms_levels", "AUTO"),
                special_requirements=analysis_data.get("special_requirements", []),
                needs_clarification=analysis_data.get("needs_clarification", False),
                clarification_questions=analysis_data.get(
                    "clarification_questions", []
                ),
                enhanced_prompt=analysis_data.get(
                    "enhanced_prompt", state["original_prompt"]
                ),
            )

            state["prompt_analysis"] = analysis
            state["enhanced_prompt"] = analysis.enhanced_prompt
            state["needs_clarification"] = analysis.needs_clarification

            # Update config with extracted values
            state["config"].subject = analysis.subject
            state["config"].topic = analysis.topic
            state["config"].question_types = analysis.question_types
            state["config"].difficulty = analysis.difficulty
            state["config"].blooms_levels = analysis.blooms_levels

            self.add_thinking_step(
                state,
                "observation",
                f"Understood: {analysis.topic} ({analysis.subject})",
            )

        except Exception as e:
            logger.error("Prompt analysis failed", error=str(e))
            state["enhanced_prompt"] = state["original_prompt"]
            state["needs_clarification"] = False

        return state

