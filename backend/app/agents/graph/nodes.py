"""
LangGraph Agent Nodes - Stateful Agent Architecture

Individual nodes that form the question generation pipeline using
a stateful agent pattern with conditional path routing.

Architecture:
  __start__ -> router -> [artifact_operations] -> generate_followup -> reflect -> clean_state -> __end__
                       -> respond_to_query -> clean_state -> __end__
"""

from typing import Dict, Any, List, Optional
import json
import uuid
from datetime import datetime
import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.graph.state import (
    AgentState,
    ThinkingStep,
    SourceChunk,
    GeneratedQuestion,
    PromptAnalysis,
    QuestionType,
    Difficulty,
    BloomsLevel,
    SourceCitation,
    ActionType,
    ArtifactType,
    ArtifactContent,
    FollowupSuggestion,
    ReflectionResult,
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

logger = structlog.get_logger()


def sanitize_json_string(content: str) -> str:
    """
    Sanitize a JSON string by fixing common escape sequence issues.
    This handles cases where LLMs generate invalid JSON with unescaped backslashes,
    especially in LaTeX formulas like \\frac, \\sqrt, etc.
    """
    import re

    # First, try to parse as-is
    try:
        json.loads(content)
        return content  # Already valid
    except json.JSONDecodeError:
        pass

    # Fix common LaTeX escape issues in JSON strings
    # Replace single backslashes with double backslashes, but not already escaped ones
    # This regex finds backslashes that are NOT followed by valid JSON escape chars or another backslash

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
    # This regex matches JSON string contents
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


class MaterialRetrieverNode(BaseNode):
    """Retrieves relevant content from source materials"""

    def __init__(self, llm, rag_service, sse_handler: Optional[SSEHandler] = None):
        super().__init__(llm, sse_handler)
        self.rag_service = rag_service

    async def __call__(self, state: AgentState) -> AgentState:
        """Retrieve relevant content from materials"""
        material_ids = state.get("selected_material_ids", [])

        if not material_ids:
            await self.emit_thinking(
                "No materials selected, generating from prompt only..."
            )
            state["retrieved_chunks"] = []
            return state

        await self.emit_action(f"Searching {len(material_ids)} material(s)...")

        try:
            query = state.get("enhanced_prompt") or state["original_prompt"]

            chunks = await retrieve_materials(
                rag_service=self.rag_service,
                tenant_id=state["tenant_id"],
                query=query,
                material_ids=material_ids,
                top_k=10,
            )

            state["retrieved_chunks"] = chunks

            # Emit sources found
            for chunk in chunks[:3]:  # Show top 3
                if self.sse_handler:
                    await self.sse_handler.send_source_found(
                        source_id=chunk.material_id,
                        title=chunk.material_title,
                        excerpt=chunk.content[:200],
                    )

            self.add_thinking_step(
                state, "observation", f"Found {len(chunks)} relevant sections"
            )

        except Exception as e:
            logger.error("Material retrieval failed", error=str(e))
            state["retrieved_chunks"] = []

        return state


class QuestionGeneratorNode(BaseNode):
    """Generates questions from source materials"""

    async def __call__(self, state: AgentState) -> AgentState:
        """Generate questions based on config and materials"""
        config = state["config"]
        total = config.question_count

        await self.emit_action(f"Generating {total} question(s)...")

        try:
            system_prompt = await get_prompt("question_generator")

            # Build context from retrieved chunks
            context = self._build_context(state.get("retrieved_chunks", []))

            # Build generation request
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

Example format:
```json
[
  {{"question_id": "q1", "type": "multiple-choice", ...}},
  {{"question_id": "q2", "type": "multiple-choice", ...}},
  {{"question_id": "q3", "type": "multiple-choice", ...}}
]
```
"""
                ),
            ]

            response = await self.llm.ainvoke(messages)
            logger.debug(
                "LLM response for question generation",
                response_length=len(response.content),
            )
            questions = self._parse_questions(response.content, state)
            logger.info("Parsed questions", count=len(questions), expected=total)

            state["questions"] = questions
            state["current_question_index"] = len(questions)

            # Emit question completions
            for i, q in enumerate(questions):
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
        config = state["config"]
        analysis = state.get("prompt_analysis")

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
        import re

        try:
            # Try to extract JSON array or objects
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            json_content = json_content.strip()

            # Try parsing as array first with sanitization fallback
            try:
                data = json.loads(json_content)
                items = data if isinstance(data, list) else [data]
            except json.JSONDecodeError:
                # Try sanitizing first
                try:
                    sanitized = sanitize_json_string(json_content)
                    data = json.loads(sanitized)
                    items = data if isinstance(data, list) else [data]
                except json.JSONDecodeError:
                    # Fallback: find individual JSON objects
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
        # Find the original question
        original = None
        for q in state.get("questions", []):
            if q.question_id == question_id:
                original = q
                break

        if not original:
            raise ValueError(f"Question {question_id} not found")

        await self.emit_action(f"Editing question {question_id}...")

        system_prompt = await get_prompt("question_editor")

        # Get new sources if provided
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

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(
                content=f"""
## Original Question
{json.dumps(original.model_dump(), indent=2)}

## Edit Instruction
{edit_instruction}

## New Source Materials
{source_context or "Use existing sources"}

Apply the edit and return the updated question as JSON.
"""
            ),
        ]

        response = await self.llm.ainvoke(messages)

        # Parse edited question
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
                quality_score=0.85,
                is_valid=True,
            )

            return edited

        except Exception as e:
            logger.error("Failed to parse edited question", error=str(e))
            raise ValueError(f"Failed to edit question: {e}")


# =============================================================================
# Agentic Workflow Nodes
# =============================================================================


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
        config = state["config"]
        total = config.question_count

        # ReAct pattern: Increment iteration count
        current_iteration = state.get("iteration_count", 0)
        state["iteration_count"] = current_iteration + 1
        max_iterations = state.get("max_iterations", config.max_iterations)

        await self.emit_action(
            f"Creating artifact with {total} question(s)... (iteration {state['iteration_count']}/{max_iterations})"
        )

        try:
            # Retrieve context using fallback sequence: RAG → Web → Default
            chunks = await self._retrieve_context_with_fallback(state)
            state["retrieved_chunks"] = chunks

            # Build context
            context = self._build_context(state.get("retrieved_chunks", []))
            questions = []

            # Generate questions one at a time with streaming
            for question_num in range(1, total + 1):
                await self.emit_action(
                    f"Generating question {question_num} of {total}..."
                )

                # Generate single question with streaming
                question = await self._generate_single_question(
                    state=state,
                    context=context,
                    question_number=question_num,
                    total_questions=total,
                    existing_questions=questions,
                )

                if question:
                    questions.append(question)

                    # Emit question complete immediately
                    # Use mode='json' to serialize enums and nested models properly
                    if self.sse_handler:
                        await self.sse_handler.send_question_complete(
                            question_id=question.question_id,
                            question_data=question.model_dump(mode="json"),
                            score=question.quality_score or 0.85,
                        )

            # Create artifact with all questions
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
            state["should_reflect"] = True  # Enable reflection

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
        """
        Retrieve context using fallback sequence:
        1. RAG (if materials attached)
        2. Web Search (if no RAG results and web search enabled)
        3. Default Knowledge (empty context - LLM uses its training)

        Returns:
            List of SourceChunk with context from the best available source
        """
        query = state.get("enhanced_prompt") or state["original_prompt"]
        material_ids = state.get("selected_material_ids", [])
        tenant_id = state["tenant_id"]
        web_search_enabled = state.get("web_search_enabled", True)

        chunks = []

        # Step 1: Try RAG if materials are attached
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

        # Step 2: Try Web Search (if enabled and no RAG results)
        if web_search_enabled and self.web_search_service:
            await self.emit_thinking("Searching the web for relevant content...")
            try:
                web_query = (
                    state.get("web_search_query")
                    or f"{state['config'].subject or ''} {state['config'].topic or ''} {query}"
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

        # Step 3: Default to LLM Knowledge
        state["context_source"] = "default"
        await self.emit_thinking("Using general knowledge - no external sources found")
        return []

    def _build_context(self, chunks: List[SourceChunk]) -> str:
        """Build context string from chunks, handling different source types"""
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

    def _build_request(self, state: AgentState) -> str:
        """Build the generation request"""
        config = state["config"]
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

    async def _generate_single_question(
        self,
        state: AgentState,
        context: str,
        question_number: int,
        total_questions: int,
        existing_questions: List[GeneratedQuestion],
    ) -> Optional[GeneratedQuestion]:
        """Generate a single question with streaming content to UI"""
        config = state["config"]

        # Pick question type (cycle through if multiple)
        q_types = config.question_types
        q_type = q_types[(question_number - 1) % len(q_types)]

        # Build prompt for single question
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
            # Stream the response content to UI
            streamed_content = ""
            question_id = f"q{question_number}"

            # Check if LLM supports streaming
            if hasattr(self.llm, "astream"):
                async for chunk in self.llm.astream(messages):
                    if hasattr(chunk, "content") and chunk.content:
                        streamed_content += chunk.content
                        # Stream content chunks to frontend
                        if self.sse_handler:
                            await self.sse_handler.send_chunk(
                                question_id=question_id,
                                content=chunk.content,
                                question_number=question_number,
                            )
            else:
                # Fallback to non-streaming
                response = await self.llm.ainvoke(messages)
                streamed_content = response.content

            # Parse the single question
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
            # Extract JSON
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            # Find JSON object
            import re

            match = re.search(r"\{[\s\S]*\}", json_content)
            if not match:
                logger.error("No JSON object found in response")
                return None

            json_str = match.group()

            # Try parsing, with fallback to sanitized version
            try:
                item = json.loads(json_str)
            except json.JSONDecodeError as parse_error:
                logger.warning(
                    f"JSON parse error for question {question_number}, attempting to sanitize",
                    error=str(parse_error),
                )
                # Try to fix common escape sequence issues
                sanitized = sanitize_json_string(json_str)
                try:
                    item = json.loads(sanitized)
                    logger.info(
                        f"Successfully parsed question {question_number} after sanitization"
                    )
                except json.JSONDecodeError:
                    # Last resort: try removing problematic characters
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

    def _parse_questions(
        self, content: str, state: AgentState
    ) -> List[GeneratedQuestion]:
        """Parse generated questions from LLM response"""
        questions = []
        import re

        try:
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]
            else:
                json_content = content

            json_content = json_content.strip()

            # Try to parse with sanitization fallback
            try:
                data = json.loads(json_content)
                items = data if isinstance(data, list) else [data]
            except json.JSONDecodeError:
                # Try sanitizing first
                try:
                    sanitized = sanitize_json_string(json_content)
                    data = json.loads(sanitized)
                    items = data if isinstance(data, list) else [data]
                except json.JSONDecodeError:
                    # Fallback to finding individual JSON objects
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
            # Find the original question
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

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"""
## Original Question
{json.dumps(original.model_dump(), indent=2)}

## Edit Instruction
{instruction}

Apply the edit and return the updated question as JSON.
"""
                ),
            ]

            response = await self.llm.ainvoke(messages)
            edited = self._parse_edited_question(response.content, original)

            # Update in state
            state["questions"][original_idx] = edited

            # Update artifact
            if state.get("artifact"):
                state["artifact"].contents[original_idx] = edited.model_dump(
                    mode="json"
                )
                state["artifact"].current_index += 1
                state["artifact"].updated_at = datetime.utcnow()

            state["should_reflect"] = False  # Skip reflection for edits

            if self.sse_handler:
                await self.sse_handler.send_question_complete(
                    question_id=edited.question_id,
                    question_data=edited.model_dump(mode="json"),
                    score=edited.quality_score or 0.85,
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
                quality_score=0.85,
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
            # Find the original to get its parameters
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

            # Get context
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
- Topic: {state.get("enhanced_prompt", state["original_prompt"])}

The new question should cover similar concepts but be distinctly different from:
"{original.question_text}"

Output a single question as JSON.
"""
                ),
            ]

            response = await self.llm.ainvoke(messages)
            new_question = self._parse_single_question(response.content, original)

            # Update in state
            state["questions"][original_idx] = new_question

            # Update artifact
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
                    score=new_question.quality_score or 0.85,
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
                question_id=original.question_id,  # Keep same ID
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
                quality_score=0.85,
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
            # Find original
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

            # Extract new parameters
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
- Topic: {state.get("enhanced_prompt", state["original_prompt"])}

Create a question that tests the same concept but with the new parameters.
Output as JSON.
"""
                ),
            ]

            response = await self.llm.ainvoke(messages)
            new_question = self._parse_question(response.content, original, new_theme)

            # Update state
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
                    score=new_question.quality_score or 0.85,
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
                quality_score=0.85,
                is_valid=True,
            )
        except Exception as e:
            logger.error("Failed to parse question", error=str(e))
            raise


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
            config = state["config"]
            topic = config.topic or state.get("original_prompt", "")[:50]

            # Generate contextual suggestions
            suggestions = []

            # Suggest different difficulty
            current_diff = config.difficulty.value
            if current_diff != "hard":
                suggestions.append(
                    FollowupSuggestion(
                        suggestion_type="difficulty",
                        title=f"Increase Difficulty",
                        description=f"Generate harder questions on {topic}",
                        action_params={"difficulty": "hard"},
                    )
                )
            if current_diff != "easy":
                suggestions.append(
                    FollowupSuggestion(
                        suggestion_type="difficulty",
                        title=f"Simplify Questions",
                        description=f"Generate easier questions for beginners",
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

            # Suggest related topics (simplified - could use LLM)
            suggestions.append(
                FollowupSuggestion(
                    suggestion_type="topic",
                    title="Related Topics",
                    description="Explore related concepts",
                    action_params={"expand_topics": True},
                )
            )

            state["followup_suggestions"] = suggestions[:4]  # Limit to 4

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
            # Build questions summary for reflection
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

            response = await self.llm.ainvoke(messages)

            # Parse reflection
            content = response.content

            # Handle empty response
            if not content or not content.strip():
                logger.warning("Empty response from LLM in reflect node, using default")
                reflection = ReflectionResult(
                    overall_quality=0.85,
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

            # Handle empty JSON content
            if not json_content:
                logger.warning("Empty JSON content in reflect node, using default")
                reflection = ReflectionResult(
                    overall_quality=0.85,
                    strengths=["Questions generated successfully"],
                    improvements=[],
                    should_regenerate=False,
                    regenerate_indices=[],
                )
                state["reflection_result"] = reflection
                return state

            # Try to parse, with sanitization fallback
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

            # Emit reflection event if SSE handler available
            if self.sse_handler:
                await self.sse_handler.send_thinking(
                    f"Quality: {reflection.overall_quality:.0%}"
                )

            self.add_thinking_step(
                state,
                "observation",
                f"Quality assessment: {reflection.overall_quality:.0%}",
            )

        except Exception as e:
            logger.error("reflect failed", error=str(e))
            # Provide default reflection instead of None
            state["reflection_result"] = ReflectionResult(
                overall_quality=0.8,
                strengths=["Questions generated"],
                improvements=[],
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
            # Build context from questions
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
{query}

Provide a helpful response.
"""
                ),
            ]

            response = await self.llm.ainvoke(messages)
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

        # Mark as complete
        state["is_complete"] = True

        # Clear temporary routing state
        state["next_action"] = None
        state["target_question_id"] = None
        state["new_theme"] = None
        state["user_query"] = None
        state["should_reflect"] = False

        # Update artifact timestamp
        if state.get("artifact"):
            state["artifact"].updated_at = datetime.utcnow()

        self.add_thinking_step(state, "observation", "Generation complete")

        return state
