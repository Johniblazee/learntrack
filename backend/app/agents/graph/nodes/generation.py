"""
Question generation nodes for LangGraph agent.
Includes QuestionGeneratorNode and GenerateArtifactNode.
"""

from typing import List, Optional
import json
import re
import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.graph.state import (
    AgentState,
    SourceChunk,
    GeneratedQuestion,
    SourceCitation,
    ArtifactType,
    ArtifactContent,
)
from app.core.prompt_manager import get_prompt
from app.agents.streaming.sse_handler import SSEHandler
from app.agents.tools.material_retriever import retrieve_materials
from app.agents.tools.web_search_tool import perform_web_search
from app.utils.enums import (
    normalize_question_type,
    normalize_difficulty,
    normalize_blooms_level,
)
from .base import BaseNode, sanitize_json_string

logger = structlog.get_logger()


class QuestionGeneratorNode(BaseNode):
    """Generates questions from source materials (legacy node)"""

    async def __call__(self, state: AgentState) -> AgentState:
        """Generate questions based on config and materials"""
        config = state["generation_config"]
        total = config.question_count

        await self.emit_action(f"Generating {total} question(s)...")

        try:
            system_prompt = await get_prompt("question_generator")
            context = self._build_context(state.get("retrieved_chunks", []))
            request = self._build_request(state)

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"""
## Source Materials
{context}

## Generation Request
{request}

Generate exactly {total} questions now. Output ALL {total} questions as a JSON array.
IMPORTANT: Your response must contain exactly {total} question objects in a single JSON array.
"""
                ),
            ]

            response = await self.llm.ainvoke(messages)
            questions = self._parse_questions(response.content, state)

            state["questions"] = questions
            state["current_question_index"] = len(questions)

            for q in questions:
                if self.sse_handler:
                    await self.sse_handler.send_question_complete(
                        question_id=q.question_id,
                        question_data=q.model_dump(mode="json"),
                        score=q.quality_score or 0.85,
                    )

            self.add_thinking_step(
                state, "observation", f"Generated {len(questions)} questions"
            )

        except Exception as e:
            logger.error("Question generation failed", error=str(e))
            state["error"] = str(e)

        return state

    def _build_context(self, chunks: List[SourceChunk]) -> str:
        """Build context string from chunks"""
        if not chunks:
            return "No source materials provided. Generate based on general knowledge."

        context_parts = []
        for i, chunk in enumerate(chunks, 1):
            location = f" (Page {chunk.location})" if chunk.location else ""
            context_parts.append(
                f"### Source {i}: {chunk.material_title}{location}\n{chunk.content}\n"
            )
        return "\n".join(context_parts)

    def _build_request(self, state: AgentState) -> str:
        """Build the generation request"""
        config = state["generation_config"]
        types = ", ".join([t.value for t in config.question_types])

        return f"""
Subject: {config.subject or "Not specified"}
Topic: {config.topic or "From prompt"}
Question Types: {types}
Difficulty: {config.difficulty.value}
Bloom's Levels: {config.blooms_levels}
Count: {config.question_count}
Special Requirements: {", ".join(config.special_requirements) or "None"}
Enhanced Prompt: {state.get("enhanced_prompt", state["original_prompt"])}
"""

    def _parse_questions(
        self, content: str, state: AgentState
    ) -> List[GeneratedQuestion]:
        """Parse generated questions from LLM response"""
        questions = []

        try:
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            json_content = json_content.strip()

            try:
                data = json.loads(json_content)
                items = data if isinstance(data, list) else [data]
            except json.JSONDecodeError:
                try:
                    sanitized = sanitize_json_string(json_content)
                    data = json.loads(sanitized)
                    items = data if isinstance(data, list) else [data]
                except json.JSONDecodeError:
                    items = []
                    for match in re.finditer(r"\{[^{}]*\}", json_content, re.DOTALL):
                        try:
                            item_str = match.group()
                            try:
                                items.append(json.loads(item_str))
                            except json.JSONDecodeError:
                                sanitized_item = sanitize_json_string(item_str)
                                items.append(json.loads(sanitized_item))
                        except:
                            continue

            for i, item in enumerate(items):
                raw_type = (
                    item.get("type") or item.get("question_type") or "multiple-choice"
                )
                raw_difficulty = item.get("difficulty", "medium")
                q = GeneratedQuestion(
                    question_id=item.get("question_id", f"q{i + 1}"),
                    type=normalize_question_type(raw_type),
                    difficulty=normalize_difficulty(raw_difficulty),
                    blooms_level=normalize_blooms_level(
                        item.get("blooms_level", "UNDERSTAND")
                    ),
                    question_text=item.get("question_text", ""),
                    options=item.get("options"),
                    correct_answer=item.get("correct_answer", ""),
                    explanation=item.get("explanation", ""),
                    source_citations=[
                        SourceCitation(**c) for c in item.get("source_citations", [])
                    ]
                    if item.get("source_citations")
                    else [],
                    tags=item.get("tags", []),
                    quality_score=0.85,
                    is_valid=True,
                )
                questions.append(q)

        except Exception as e:
            logger.error("Failed to parse questions", error=str(e))

        return questions


class GenerateArtifactNode(BaseNode):
    """
    Generates new question artifact (full question set).
    This is the main generation node for creating new questions.
    Streams questions to the UI one at a time as they are generated.
    Implements fallback sequence: RAG → Web Search → Default Knowledge
    """

    def __init__(
        self,
        llm,
        rag_service=None,
        web_search_service=None,
        sse_handler: Optional[SSEHandler] = None,
    ):
        super().__init__(llm, sse_handler)
        self.rag_service = rag_service
        self.web_search_service = web_search_service

    async def __call__(self, state: AgentState) -> AgentState:
        """Generate new question set artifact with progressive streaming"""
        config = state["generation_config"]
        total = config.question_count

        current_iteration = state.get("iteration_count", 0)
        state["iteration_count"] = current_iteration + 1
        max_iterations = state.get("max_iterations", config.max_iterations)

        await self.emit_action(
            f"Creating artifact with {total} question(s)... (iteration {state['iteration_count']}/{max_iterations})"
        )

        try:
            chunks = await self._retrieve_context_with_fallback(state)
            state["retrieved_chunks"] = chunks
            context = self._build_context(state.get("retrieved_chunks", []))
            questions = []

            for question_num in range(1, total + 1):
                await self.emit_action(
                    f"Generating question {question_num} of {total}..."
                )

                question = await self._generate_single_question(
                    state=state,
                    context=context,
                    question_number=question_num,
                    total_questions=total,
                    existing_questions=questions,
                )

                if question:
                    questions.append(question)
                    if self.sse_handler:
                        await self.sse_handler.send_question_complete(
                            question_id=question.question_id,
                            question_data=question.model_dump(mode="json"),
                            score=question.quality_score or 0.85,
                        )

            artifact = ArtifactContent(
                artifact_id=state["session_id"],
                artifact_type=ArtifactType.QUESTION_SET,
                title=f"Questions: {config.topic or state['original_prompt'][:50]}",
                current_index=1,
                contents=[q.model_dump(mode="json") for q in questions],
            )

            state["artifact"] = artifact
            state["questions"] = questions
            state["current_question_index"] = len(questions)
            state["should_reflect"] = True

            self.add_thinking_step(
                state,
                "observation",
                f"Created artifact with {len(questions)} questions",
            )

        except Exception as e:
            logger.error("generateArtifact failed", error=str(e))
            state["error"] = str(e)

        return state

    async def _retrieve_context_with_fallback(
        self, state: AgentState
    ) -> List[SourceChunk]:
        """Retrieve context using fallback sequence: RAG → Web → Default"""
        query = state.get("enhanced_prompt") or state["original_prompt"]
        material_ids = state.get("selected_material_ids", [])
        tenant_id = state["tenant_id"]
        web_search_enabled = state.get("web_search_enabled", True)

        chunks = []

        if material_ids and self.rag_service:
            await self.emit_thinking(
                "Retrieving relevant source materials from your documents..."
            )
            try:
                chunks = await retrieve_materials(
                    rag_service=self.rag_service,
                    tenant_id=tenant_id,
                    query=query,
                    material_ids=material_ids,
                    top_k=10,
                )
                if chunks:
                    state["context_source"] = "rag"
                    await self.emit_thinking(
                        f"✓ Found {len(chunks)} relevant sections from your materials"
                    )
                    return chunks
                else:
                    await self.emit_thinking(
                        "No relevant content found in attached materials"
                    )
            except Exception as e:
                logger.error("RAG retrieval failed", error=str(e))
                await self.emit_thinking("Could not retrieve from attached materials")

        if web_search_enabled and self.web_search_service:
            await self.emit_thinking("Searching the web for relevant content...")
            try:
                web_query = (
                    state.get("web_search_query")
                    or f"{state['generation_config'].subject or ''} {state['generation_config'].topic or ''} {query}"
                )
                web_chunks = await perform_web_search(
                    web_search_service=self.web_search_service,
                    tenant_id=tenant_id,
                    query=web_query.strip(),
                    max_results=5,
                )
                if web_chunks:
                    chunks = web_chunks
                    state["context_source"] = "web"
                    await self.emit_thinking(
                        f"✓ Found {len(chunks)} relevant web sources"
                    )
                    return chunks
                else:
                    await self.emit_thinking("No relevant web content found")
            except Exception as e:
                logger.error("Web search failed", error=str(e))
                await self.emit_thinking("Web search not available")

        state["context_source"] = "default"
        await self.emit_thinking("Using general knowledge - no external sources found")
        return []

    def _build_context(self, chunks: List[SourceChunk]) -> str:
        """Build context string from chunks"""
        if not chunks:
            return "No source materials provided. Generate based on general knowledge."

        context_parts = []
        for i, chunk in enumerate(chunks, 1):
            location = f" (Page {chunk.location})" if chunk.location else ""
            source_type_label = "[Web]" if chunk.source_type == "web" else ""
            url_info = f"\nURL: {chunk.url}" if chunk.url else ""
            context_parts.append(
                f"### Source {i}: {chunk.material_title}{location} {source_type_label}\n{chunk.content}{url_info}\n"
            )
        return "\n".join(context_parts)

    async def _generate_single_question(
        self,
        state: AgentState,
        context: str,
        question_number: int,
        total_questions: int,
        existing_questions: List[GeneratedQuestion],
    ) -> Optional[GeneratedQuestion]:
        """Generate a single question with streaming content to UI"""
        config = state["generation_config"]
        q_types = config.question_types
        q_type = q_types[(question_number - 1) % len(q_types)]

        system_prompt = await get_prompt("question_generator")
        existing_texts = [q.question_text[:100] for q in existing_questions]
        existing_str = (
            "\n".join([f"- {t}" for t in existing_texts])
            if existing_texts
            else "None yet"
        )

        prompt_text = f"""
## Source Materials
{context}

## Generation Request
Subject: {config.subject or "Not specified"}
Topic: {config.topic or state["original_prompt"]}
Question Type: {q_type.value}
Difficulty: {config.difficulty.value}
Bloom's Levels: {config.blooms_levels}
Enhanced Prompt: {state.get("enhanced_prompt", state["original_prompt"])}

## Already Generated Questions (do not repeat):
{existing_str}

Generate exactly ONE {q_type.value} question (question {question_number} of {total_questions}).
Make it unique and different from any already generated.
Output as a single JSON object (not an array).
"""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt_text),
        ]

        try:
            streamed_content = ""
            question_id = f"q{question_number}"

            if hasattr(self.llm, "astream"):
                async for chunk in self.llm.astream(messages):
                    if hasattr(chunk, "content") and chunk.content:
                        streamed_content += chunk.content
                        if self.sse_handler:
                            await self.sse_handler.send_chunk(
                                question_id=question_id,
                                content=chunk.content,
                                question_number=question_number,
                            )
            else:
                response = await self.llm.ainvoke(messages)
                streamed_content = response.content

            question = self._parse_single_question(
                streamed_content, question_number, state
            )
            return question

        except Exception as e:
            logger.error(f"Failed to generate question {question_number}", error=str(e))
            return None

    def _parse_single_question(
        self, content: str, question_number: int, state: AgentState
    ) -> Optional[GeneratedQuestion]:
        """Parse a single question from LLM response"""
        try:
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            match = re.search(r"\{[\s\S]*\}", json_content)
            if not match:
                logger.error("No JSON object found in response")
                return None

            json_str = match.group()

            try:
                item = json.loads(json_str)
            except json.JSONDecodeError:
                sanitized = sanitize_json_string(json_str)
                try:
                    item = json.loads(sanitized)
                except json.JSONDecodeError:
                    cleaned = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", json_str)
                    item = json.loads(cleaned)

            raw_type = (
                item.get("type") or item.get("question_type") or "multiple-choice"
            )
            raw_difficulty = item.get("difficulty", "medium")
            question = GeneratedQuestion(
                question_id=item.get("question_id", f"q{question_number}"),
                type=normalize_question_type(raw_type),
                difficulty=normalize_difficulty(raw_difficulty),
                blooms_level=normalize_blooms_level(
                    item.get("blooms_level", "UNDERSTAND")
                ),
                question_text=item.get("question_text", ""),
                options=item.get("options"),
                correct_answer=item.get("correct_answer", ""),
                explanation=item.get("explanation", ""),
                source_citations=[
                    SourceCitation(**c) for c in item.get("source_citations", [])
                ]
                if item.get("source_citations")
                else [],
                tags=item.get("tags", []),
                quality_score=0.85,
                is_valid=True,
            )
            return question

        except Exception as e:
            logger.error(f"Failed to parse question {question_number}", error=str(e))
            return None
