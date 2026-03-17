"""
Question editing nodes for LangGraph agent.
Includes nodes for editing, updating, and rewriting questions.
"""

from typing import Dict, List, Optional
from datetime import datetime
import asyncio
import json
import structlog
from langchain_core.messages import HumanMessage, SystemMessage

# Timeout for individual LLM calls (seconds)
LLM_CALL_TIMEOUT = 60

from app.agents.graph.state import (
    AgentState,
    GeneratedQuestion,
    SourceChunk,
)
from app.core.prompt_manager import get_prompt
from app.agents.streaming.sse_handler import SSEHandler
from app.agents.tools.material_retriever import retrieve_materials
from app.utils.enums import (
    normalize_question_type,
    normalize_difficulty,
    normalize_blooms_level,
)
from .base import BaseNode

logger = structlog.get_logger()


class QuestionEditorNode(BaseNode):
    """Edits individual questions based on user feedback"""

    async def edit_question(
        self,
        state: AgentState,
        question_id: str,
        edit_instruction: str,
        new_source_ids: Optional[List[str]] = None,
    ) -> GeneratedQuestion:
        """
        Edit a single question based on instruction.

        Args:
            state: Current agent state
            question_id: ID of question to edit
            edit_instruction: What to change
            new_source_ids: Optional new sources for regeneration

        Returns:
            Edited GeneratedQuestion
        """
        original = None
        for q in state.get("questions", []):
            if q.question_id == question_id:
                original = q
                break

        if not original:
            raise ValueError(f"Question {question_id} not found")

        await self.emit_action(f"Editing question {question_id}...")

        system_prompt = await get_prompt("question_editor")

        source_context = ""
        if new_source_ids:
            chunks = await retrieve_materials(
                rag_service=getattr(self, "rag_service", None),
                tenant_id=state["tenant_id"],
                query=edit_instruction,
                material_ids=new_source_ids,
                top_k=5,
            )
            source_context = "\n".join([c.content for c in chunks])

        # Validate edit instruction length
        if len(edit_instruction) > 1000:
            edit_instruction = edit_instruction[:1000]

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(
                content=f"""
## Original Question
{json.dumps(original.model_dump(), indent=2)}

## Edit Instruction
<user_instruction>{edit_instruction}</user_instruction>

## New Source Materials
{source_context or "Use existing sources"}

Apply the edit and return the updated question as JSON.
"""
            ),
        ]

        response = await asyncio.wait_for(self.llm.ainvoke(messages), timeout=LLM_CALL_TIMEOUT)

        try:
            content = response.content
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            data = json.loads(json_content.strip())
            edited_data = data.get("edited_question", data)

            edited = GeneratedQuestion(
                question_id=original.question_id,
                type=normalize_question_type(
                    edited_data.get("type")
                    or edited_data.get("question_type")
                    or original.type.value
                ),
                difficulty=normalize_difficulty(
                    edited_data.get("difficulty", original.difficulty.value)
                ),
                blooms_level=normalize_blooms_level(
                    edited_data.get("blooms_level", original.blooms_level.value)
                ),
                question_text=edited_data.get("question_text", original.question_text),
                options=edited_data.get("options", original.options),
                correct_answer=edited_data.get(
                    "correct_answer", original.correct_answer
                ),
                explanation=edited_data.get("explanation", original.explanation),
                source_citations=original.source_citations,
                tags=edited_data.get("tags", original.tags),
                quality_score=None,
                is_valid=True,
            )

            return edited

        except Exception as e:
            logger.error("Failed to parse edited question", error=str(e))
            raise ValueError(f"Failed to edit question: {e}")


class UpdateArtifactNode(BaseNode):
    """
    Updates an existing question in the artifact.
    Applies user's edit instructions to a specific question.
    """

    def __init__(self, llm, rag_service=None, sse_handler: Optional[SSEHandler] = None):
        super().__init__(llm, sse_handler)
        self.rag_service = rag_service

    async def __call__(self, state: AgentState) -> AgentState:
        """Update a specific question based on user instruction"""
        target_id = state.get("target_question_id")
        instruction = state.get("user_query", "")

        if not target_id:
            state["error"] = "No target question specified for update"
            return state

        await self.emit_action(f"Updating question {target_id}...")

        try:
            original = None
            original_idx = -1
            for i, q in enumerate(state.get("questions", [])):
                if q.question_id == target_id:
                    original = q
                    original_idx = i
                    break

            if not original:
                state["error"] = f"Question {target_id} not found"
                return state

            system_prompt = await get_prompt("question_editor")

            # Validate instruction length
            safe_instruction = instruction[:1000] if len(instruction) > 1000 else instruction

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"""
## Original Question
{json.dumps(original.model_dump(), indent=2)}

## Edit Instruction
<user_instruction>{safe_instruction}</user_instruction>

Apply the edit and return the updated question as JSON.
"""
                ),
            ]

            response = await asyncio.wait_for(self.llm.ainvoke(messages), timeout=LLM_CALL_TIMEOUT)
            edited = self._parse_edited_question(response.content, original)

            state["questions"][original_idx] = edited

            if state.get("artifact"):
                state["artifact"].contents[original_idx] = edited.model_dump(
                    mode="json"
                )
                state["artifact"].current_index += 1
                state["artifact"].updated_at = datetime.utcnow()

            state["should_reflect"] = False

            if self.sse_handler:
                await self.sse_handler.send_question_complete(
                    question_id=edited.question_id,
                    question_data=edited.model_dump(mode="json"),
                    score=edited.quality_score or 0.0,
                )

            self.add_thinking_step(
                state, "observation", f"Updated question {target_id}"
            )

        except Exception as e:
            logger.error("updateArtifact failed", error=str(e))
            state["error"] = str(e)

        return state

    def _parse_edited_question(
        self, content: str, original: GeneratedQuestion
    ) -> GeneratedQuestion:
        """Parse edited question from LLM response"""
        try:
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            data = json.loads(json_content.strip())
            edited_data = data.get("edited_question", data)

            return GeneratedQuestion(
                question_id=original.question_id,
                type=normalize_question_type(
                    edited_data.get("type")
                    or edited_data.get("question_type")
                    or original.type.value
                ),
                difficulty=normalize_difficulty(
                    edited_data.get("difficulty", original.difficulty.value)
                ),
                blooms_level=normalize_blooms_level(
                    edited_data.get("blooms_level", original.blooms_level.value)
                ),
                question_text=edited_data.get("question_text", original.question_text),
                options=edited_data.get("options", original.options),
                correct_answer=edited_data.get(
                    "correct_answer", original.correct_answer
                ),
                explanation=edited_data.get("explanation", original.explanation),
                source_citations=original.source_citations,
                tags=edited_data.get("tags", original.tags),
                quality_score=None,
                is_valid=True,
            )
        except Exception as e:
            logger.error("Failed to parse edited question", error=str(e))
            raise


class RewriteArtifactNode(BaseNode):
    """
    Regenerates a question completely with the same parameters.
    Creates a fresh version while maintaining the same config.
    """

    def __init__(self, llm, rag_service=None, sse_handler: Optional[SSEHandler] = None):
        super().__init__(llm, sse_handler)
        self.rag_service = rag_service

    async def __call__(self, state: AgentState) -> AgentState:
        """Regenerate a specific question from scratch"""
        target_id = state.get("target_question_id")

        if not target_id:
            state["error"] = "No target question specified for rewrite"
            return state

        await self.emit_action(f"Regenerating question {target_id}...")

        try:
            original = None
            original_idx = -1
            for i, q in enumerate(state.get("questions", [])):
                if q.question_id == target_id:
                    original = q
                    original_idx = i
                    break

            if not original:
                state["error"] = f"Question {target_id} not found"
                return state

            context = self._build_context(state.get("retrieved_chunks", []))

            system_prompt = await get_prompt("question_generator")

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"""
## Source Materials
{context}

## Regeneration Request
Create a NEW, DIFFERENT question that replaces this one:
- Type: {original.type.value}
- Difficulty: {original.difficulty.value}
- Bloom's Level: {original.blooms_level.value}
- Topic: <user_topic>{state.get("enhanced_prompt", state["original_prompt"])}</user_topic>

The new question should cover similar concepts but be distinctly different from:
"{original.question_text}"

Output a single question as JSON.
"""
                ),
            ]

            response = await asyncio.wait_for(self.llm.ainvoke(messages), timeout=LLM_CALL_TIMEOUT)
            new_question = self._parse_single_question(response.content, original)

            state["questions"][original_idx] = new_question

            if state.get("artifact"):
                state["artifact"].contents[original_idx] = new_question.model_dump(
                    mode="json"
                )
                state["artifact"].current_index += 1
                state["artifact"].updated_at = datetime.utcnow()

            state["should_reflect"] = True

            if self.sse_handler:
                await self.sse_handler.send_question_complete(
                    question_id=new_question.question_id,
                    question_data=new_question.model_dump(mode="json"),
                    score=new_question.quality_score or 0.0,
                )

            self.add_thinking_step(
                state, "observation", f"Regenerated question {target_id}"
            )

        except Exception as e:
            logger.error("rewriteArtifact failed", error=str(e))
            state["error"] = str(e)

        return state

    def _build_context(self, chunks: List[SourceChunk]) -> str:
        if not chunks:
            return "Generate based on general knowledge."
        return "\n".join([f"### {c.material_title}\n{c.content}" for c in chunks[:5]])

    def _parse_single_question(
        self, content: str, original: GeneratedQuestion
    ) -> GeneratedQuestion:
        """Parse a single question from response"""
        try:
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            data = json.loads(json_content.strip())
            if isinstance(data, list):
                data = data[0]

            return GeneratedQuestion(
                question_id=original.question_id,
                type=normalize_question_type(
                    data.get("type") or data.get("question_type") or original.type.value
                ),
                difficulty=normalize_difficulty(
                    data.get("difficulty", original.difficulty.value)
                ),
                blooms_level=normalize_blooms_level(
                    data.get("blooms_level", original.blooms_level.value)
                ),
                question_text=data.get("question_text", ""),
                options=data.get("options"),
                correct_answer=data.get("correct_answer", ""),
                explanation=data.get("explanation", ""),
                tags=data.get("tags", []),
                quality_score=None,
                is_valid=True,
            )
        except Exception as e:
            logger.error("Failed to parse question", error=str(e))
            raise


class RewriteArtifactThemeNode(BaseNode):
    """
    Rewrites a question with different theme/style parameters.
    Changes difficulty, question type, Bloom's level, etc.
    """

    def __init__(self, llm, rag_service=None, sse_handler: Optional[SSEHandler] = None):
        super().__init__(llm, sse_handler)
        self.rag_service = rag_service

    async def __call__(self, state: AgentState) -> AgentState:
        """Rewrite question with new theme parameters"""
        target_id = state.get("target_question_id")
        new_theme = state.get("new_theme", {})

        if not target_id:
            state["error"] = "No target question specified"
            return state

        await self.emit_action(f"Rewriting question {target_id} with new style...")

        try:
            original = None
            original_idx = -1
            for i, q in enumerate(state.get("questions", [])):
                if q.question_id == target_id:
                    original = q
                    original_idx = i
                    break

            if not original:
                state["error"] = f"Question {target_id} not found"
                return state

            new_type = new_theme.get("type", original.type.value)
            new_difficulty = new_theme.get("difficulty", original.difficulty.value)
            new_blooms = new_theme.get("blooms_level", original.blooms_level.value)

            context = self._build_context(state.get("retrieved_chunks", []))
            system_prompt = await get_prompt("question_generator")

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"""
## Source Materials
{context}

## Theme Rewrite Request
Transform this question into a new style:

Original: "{original.question_text}"

NEW PARAMETERS:
- Question Type: {new_type}
- Difficulty: {new_difficulty}
- Bloom's Level: {new_blooms}
- Topic: <user_topic>{state.get("enhanced_prompt", state["original_prompt"])}</user_topic>

Create a question that tests the same concept but with the new parameters.
Output as JSON.
"""
                ),
            ]

            response = await asyncio.wait_for(self.llm.ainvoke(messages), timeout=LLM_CALL_TIMEOUT)
            new_question = self._parse_question(response.content, original, new_theme)

            state["questions"][original_idx] = new_question

            if state.get("artifact"):
                state["artifact"].contents[original_idx] = new_question.model_dump(
                    mode="json"
                )
                state["artifact"].current_index += 1
                state["artifact"].updated_at = datetime.utcnow()

            state["should_reflect"] = True

            if self.sse_handler:
                await self.sse_handler.send_question_complete(
                    question_id=new_question.question_id,
                    question_data=new_question.model_dump(mode="json"),
                    score=new_question.quality_score or 0.0,
                )

            self.add_thinking_step(
                state,
                "observation",
                f"Rewrote question {target_id} as {new_type} ({new_difficulty})",
            )

        except Exception as e:
            logger.error("rewriteArtifactTheme failed", error=str(e))
            state["error"] = str(e)

        return state

    def _build_context(self, chunks: List[SourceChunk]) -> str:
        if not chunks:
            return "Generate based on general knowledge."
        return "\n".join([f"### {c.material_title}\n{c.content}" for c in chunks[:5]])

    def _parse_question(
        self, content: str, original: GeneratedQuestion, new_theme: Dict
    ) -> GeneratedQuestion:
        try:
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            data = json.loads(json_content.strip())
            if isinstance(data, list):
                data = data[0]

            raw_type = (
                new_theme.get("type")
                or data.get("type")
                or data.get("question_type")
                or original.type.value
            )
            raw_difficulty = new_theme.get("difficulty") or data.get(
                "difficulty", original.difficulty.value
            )
            return GeneratedQuestion(
                question_id=original.question_id,
                type=normalize_question_type(raw_type),
                difficulty=normalize_difficulty(raw_difficulty),
                blooms_level=normalize_blooms_level(
                    new_theme.get(
                        "blooms_level",
                        data.get("blooms_level", original.blooms_level.value),
                    )
                ),
                question_text=data.get("question_text", ""),
                options=data.get("options"),
                correct_answer=data.get("correct_answer", ""),
                explanation=data.get("explanation", ""),
                tags=data.get("tags", []),
                quality_score=None,
                is_valid=True,
            )
        except Exception as e:
            logger.error("Failed to parse question", error=str(e))
            raise

