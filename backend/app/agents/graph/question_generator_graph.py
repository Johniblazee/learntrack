"""
Question Generator Graph - Stateful Agent Architecture

Main graph definition that orchestrates the question generation pipeline.
Uses a stateful agent pattern with conditional path routing.

Architecture:
  __start__ -> router -> [artifact_operations] -> generate_followup -> reflect -> clean_state -> __end__
                       -> respond_to_query -> clean_state -> __end__
"""

from typing import Optional, Dict, Any, AsyncGenerator
import asyncio
import uuid
from datetime import datetime, timezone

# Overall timeout for the entire graph execution (seconds)
GRAPH_TIMEOUT = 300
import structlog

from langgraph.graph import StateGraph, END

from app.agents.graph.state import (
    AgentState,
    GenerationConfig,
    GenerationSession,
    ThinkingStep,
    QuestionType,
    Difficulty,
    ActionType,
)
from app.agents.graph.nodes import (
    PromptAnalyzerNode,
    MaterialRetrieverNode,
    QuestionGeneratorNode,
    QuestionValidatorNode,
    QuestionEditorNode,
    # Agentic Workflow nodes
    GeneratePathNode,
    GenerateArtifactNode,
    UpdateArtifactNode,
    RewriteArtifactNode,
    RewriteArtifactThemeNode,
    GenerateFollowupNode,
    ReflectNode,
    RespondToQueryNode,
    CleanStateNode,
)
from app.agents.graph.edges import (
    route_after_generate_path,
    route_after_artifact_operation,
    route_after_respond_to_query,
    route_after_followup,
    route_after_reflect,
)
from app.agents.streaming.sse_handler import SSEHandler
from app.agents.streaming.event_types import StreamEvent

logger = structlog.get_logger()


class QuestionGeneratorAgent:
    """
    LangGraph-based Question Generator Agent - Stateful Agent Architecture.

    Orchestrates the question generation pipeline with:
    - generatePath: Central routing node
    - Artifact operations: generate, update, rewrite, rewriteTheme
    - generateFollowup: Follow-up suggestions
    - reflect: Quality self-evaluation
    - respondToQuery: Answer questions about content
    - cleanState: Cleanup before completion
    """

    def __init__(
        self,
        llm,
        rag_service=None,
        web_search_service=None,
    ):
        """
        Initialize the agent.

        Args:
            llm: LangChain LLM instance (ChatOpenAI, ChatGroq, etc.)
            rag_service: RAG service for material retrieval
            web_search_service: Web search service for fallback when no RAG materials
        """
        self.llm = llm
        self.rag_service = rag_service
        self.web_search_service = web_search_service
        self._graph = None

    def _build_graph(self, sse_handler: Optional[SSEHandler] = None) -> StateGraph:
        """Build the LangGraph state graph for the agent."""

        # Initialize agent workflow nodes
        generate_path = GeneratePathNode(self.llm, sse_handler)
        generate_artifact = GenerateArtifactNode(
            self.llm, self.rag_service, self.web_search_service, sse_handler
        )
        update_artifact = UpdateArtifactNode(self.llm, self.rag_service, sse_handler)
        rewrite_artifact = RewriteArtifactNode(self.llm, self.rag_service, sse_handler)
        rewrite_artifact_theme = RewriteArtifactThemeNode(
            self.llm, self.rag_service, sse_handler
        )
        generate_followup = GenerateFollowupNode(self.llm, sse_handler)
        reflect = ReflectNode(self.llm, sse_handler)
        respond_to_query = RespondToQueryNode(self.llm, sse_handler)
        clean_state = CleanStateNode(self.llm, sse_handler)

        # Create graph
        graph = StateGraph(AgentState)

        # Add nodes
        graph.add_node("generate_path", generate_path)
        graph.add_node("generate_artifact", generate_artifact)
        graph.add_node("update_artifact", update_artifact)
        graph.add_node("rewrite_artifact", rewrite_artifact)
        graph.add_node("rewrite_artifact_theme", rewrite_artifact_theme)
        graph.add_node("generate_followup", generate_followup)
        graph.add_node("reflect", reflect)
        graph.add_node("respond_to_query", respond_to_query)
        graph.add_node("clean_state", clean_state)

        # Set entry point
        graph.set_entry_point("generate_path")

        # Add conditional edges from generatePath
        graph.add_conditional_edges(
            "generate_path",
            route_after_generate_path,
            {
                "generate_artifact": "generate_artifact",
                "update_artifact": "update_artifact",
                "rewrite_artifact": "rewrite_artifact",
                "rewrite_artifact_theme": "rewrite_artifact_theme",
                "respond_to_query": "respond_to_query",
            },
        )

        # Artifact operations -> generateFollowup
        graph.add_conditional_edges(
            "generate_artifact",
            route_after_artifact_operation,
            {"generate_followup": "generate_followup", "clean_state": "clean_state"},
        )
        graph.add_conditional_edges(
            "update_artifact",
            route_after_artifact_operation,
            {"generate_followup": "generate_followup", "clean_state": "clean_state"},
        )
        graph.add_conditional_edges(
            "rewrite_artifact",
            route_after_artifact_operation,
            {"generate_followup": "generate_followup", "clean_state": "clean_state"},
        )
        graph.add_conditional_edges(
            "rewrite_artifact_theme",
            route_after_artifact_operation,
            {"generate_followup": "generate_followup", "clean_state": "clean_state"},
        )

        # respondToQuery -> cleanState (direct path)
        graph.add_conditional_edges(
            "respond_to_query",
            route_after_respond_to_query,
            {"clean_state": "clean_state"},
        )

        # generateFollowup -> reflect or cleanState
        graph.add_conditional_edges(
            "generate_followup",
            route_after_followup,
            {"reflect": "reflect", "clean_state": "clean_state"},
        )

        # reflect -> cleanState or regenerate
        graph.add_conditional_edges(
            "reflect",
            route_after_reflect,
            {"generate_artifact": "generate_artifact", "clean_state": "clean_state"},
        )

        # cleanState -> END
        graph.add_edge("clean_state", END)

        return graph.compile()

    async def generate(
        self,
        prompt: str,
        config: GenerationConfig,
        user_id: str,
        tenant_id: str,
        material_ids: Optional[list] = None,
        sse_handler: Optional[SSEHandler] = None,
        existing_session_id: Optional[str] = None,
        existing_questions: Optional[list] = None,
        # Agent action parameters
        target_question_id: Optional[str] = None,
        user_query: Optional[str] = None,
        new_theme: Optional[Dict[str, Any]] = None,
    ) -> GenerationSession:
        """
        Generate questions based on prompt and config using the agentic workflow.

        Args:
            prompt: User's generation prompt
            config: Generation configuration
            user_id: User ID
            tenant_id: Tenant ID for multi-tenancy
            material_ids: Optional list of material IDs to use
            sse_handler: Optional SSE handler for streaming
            existing_session_id: Optional existing session ID for update flows
            existing_questions: Optional existing questions for update flows
            target_question_id: Optional ID of question to update/rewrite
            user_query: Optional query about content (for respondToQuery)
            new_theme: Optional new theme parameters (for rewriteArtifactTheme)

        Returns:
            GenerationSession with results
        """
        session_id = existing_session_id or str(uuid.uuid4())
        initial_questions = existing_questions or []

        logger.info(
            "Starting agentic generation",
            session_id=session_id,
            user_id=user_id,
            question_count=config.question_count,
        )

        # Initialize state for the agent workflow
        initial_state: AgentState = {
            # Core identifiers
            "session_id": session_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "generation_config": config,
            # Prompt and analysis
            "original_prompt": prompt,
            "enhanced_prompt": None,
            "prompt_analysis": None,
            # Materials
            "selected_material_ids": material_ids or [],
            "retrieved_chunks": [],
            # Questions
            "questions": initial_questions,
            "current_question_index": len(initial_questions),
            # Thinking/reasoning
            "thinking_steps": [],
            # Status flags
            "needs_clarification": False,
            "is_complete": False,
            "error": None,
            # ReAct iteration control
            "iteration_count": 0,
            "max_iterations": config.max_iterations,
            # Agent workflow routing
            "next_action": None,
            "target_question_id": target_question_id,
            "user_query": user_query,
            "new_theme": new_theme,
            # Agent workflow outputs
            "artifact": None,
            "followup_suggestions": [],
            "reflection_result": None,
            "should_reflect": True,
            "response_to_query": None,
            # Context source tracking for RAG -> Web -> Default fallback
            "context_source": "default",
            "web_search_enabled": True,
            "web_search_query": None,
        }

        # Emit start event
        if sse_handler:
            await sse_handler.send(
                StreamEvent.generation_start(config.question_count, session_id)
            )

        try:
            # Build and run graph with overall timeout
            graph = self._build_graph(sse_handler)
            final_state = await asyncio.wait_for(
                graph.ainvoke(initial_state), timeout=GRAPH_TIMEOUT
            )

            # Create session result
            session = GenerationSession(
                session_id=session_id,
                user_id=user_id,
                tenant_id=tenant_id,
                status="completed",
                config=config,
                original_prompt=prompt,
                enhanced_prompt=final_state.get("enhanced_prompt"),
                selected_materials=material_ids or [],
                questions=final_state.get("questions", []),
                thinking_steps=final_state.get("thinking_steps", []),
                current_question_index=len(final_state.get("questions", [])),
            )

            # Emit done
            if sse_handler:
                await sse_handler.send_done(len(session.questions))

            return session

        except asyncio.TimeoutError:
            logger.error("Generation timed out", session_id=session_id, timeout=GRAPH_TIMEOUT)
            if sse_handler:
                await sse_handler.send_error("Generation timed out", code="TIMEOUT")
            raise
        except Exception as e:
            logger.error("Generation failed", session_id=session_id, error=str(e))
            if sse_handler:
                await sse_handler.send_error(str(e))
            raise
