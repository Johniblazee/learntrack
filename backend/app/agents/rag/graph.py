"""
Agentic RAG Graph

Main graph definition for the self-corrective RAG agent.
Implements the CRAG (Corrective RAG) pattern with:
- Query analysis
- Document retrieval
- Relevance grading
- Query rewriting (if needed)
- Answer generation
- Hallucination checking
"""

from typing import Optional, Dict, Any, List
import asyncio
import uuid

# Overall timeout for the entire RAG graph execution (seconds)
GRAPH_TIMEOUT = 300
from datetime import datetime, timezone
import structlog

from langgraph.graph import StateGraph, END

from app.agents.rag.state import RAGState, RAGConfig, RAGSession, RAGAction
from app.agents.rag.nodes import (
    QueryAnalyzerNode,
    RetrieverNode,
    RelevanceGraderNode,
    QueryRewriterNode,
    AnswerGeneratorNode,
    HallucinationCheckerNode,
)
from app.agents.rag.edges import (
    route_after_query_analysis,
    route_after_retrieval,
    route_after_grading,
    route_after_rewrite,
    route_after_generation,
    route_after_hallucination_check,
)
from app.agents.streaming.sse_handler import SSEHandler
from app.agents.streaming.event_types import StreamEvent

logger = structlog.get_logger()


class AgenticRAGAgent:
    """
    Self-Corrective RAG Agent using LangGraph.
    
    Implements the CRAG (Corrective RAG) pattern:
    1. Analyze query to understand intent
    2. Retrieve relevant documents
    3. Grade documents for relevance
    4. If no relevant docs, rewrite query and retry
    5. Generate answer from relevant documents
    6. Check for hallucinations
    7. Return verified answer with sources
    """
    
    def __init__(self, llm, rag_service):
        """
        Initialize the agent.
        
        Args:
            llm: LangChain LLM instance
            rag_service: RAG service for document retrieval
        """
        self.llm = llm
        self.rag_service = rag_service
        self._graph = None
    
    def _build_graph(self, sse_handler: Optional[SSEHandler] = None) -> StateGraph:
        """Build the LangGraph state graph"""
        
        # Initialize nodes
        query_analyzer = QueryAnalyzerNode(self.llm, sse_handler)
        retriever = RetrieverNode(self.llm, self.rag_service, sse_handler)
        grader = RelevanceGraderNode(self.llm, sse_handler)
        rewriter = QueryRewriterNode(self.llm, sse_handler)
        generator = AnswerGeneratorNode(self.llm, sse_handler)
        hallucination_checker = HallucinationCheckerNode(self.llm, sse_handler)
        
        # Create graph
        graph = StateGraph(RAGState)
        
        # Add nodes
        graph.add_node("analyze_query", query_analyzer)
        graph.add_node("retrieve", retriever)
        graph.add_node("grade", grader)
        graph.add_node("rewrite", rewriter)
        graph.add_node("generate", generator)
        graph.add_node("check_hallucination", hallucination_checker)
        graph.add_node("complete", self._complete_node)
        graph.add_node("fail", self._fail_node)
        
        # Set entry point
        graph.set_entry_point("analyze_query")
        
        # Add edges
        graph.add_conditional_edges(
            "analyze_query",
            route_after_query_analysis,
            {"retrieve": "retrieve", "fail": "fail"}
        )
        
        graph.add_conditional_edges(
            "retrieve",
            route_after_retrieval,
            {"grade": "grade", "fail": "fail"}
        )
        
        graph.add_conditional_edges(
            "grade",
            route_after_grading,
            {"generate": "generate", "rewrite": "rewrite", "complete": "complete", "fail": "fail"}
        )
        
        graph.add_conditional_edges(
            "rewrite",
            route_after_rewrite,
            {"retrieve": "retrieve", "fail": "fail"}
        )
        
        graph.add_conditional_edges(
            "generate",
            route_after_generation,
            {"check_hallucination": "check_hallucination", "complete": "complete", "fail": "fail"}
        )
        
        graph.add_conditional_edges(
            "check_hallucination",
            route_after_hallucination_check,
            {"complete": "complete", "regenerate": "generate", "fail": "fail"}
        )
        
        # Terminal nodes
        graph.add_edge("complete", END)
        graph.add_edge("fail", END)
        
        return graph.compile()
    
    async def _complete_node(self, state: RAGState) -> RAGState:
        """Mark the session as complete"""
        state["is_complete"] = True
        state["completed_at"] = datetime.now(timezone.utc)
        return state
    
    async def _fail_node(self, state: RAGState) -> RAGState:
        """Handle failure"""
        state["is_complete"] = True
        state["completed_at"] = datetime.now(timezone.utc)
        if not state.get("error"):
            state["error"] = "RAG pipeline failed"
        return state
    
    async def query(
        self,
        query: str,
        user_id: str,
        tenant_id: str,
        config: Optional[RAGConfig] = None,
        document_ids: Optional[List[str]] = None,
        generate_answer: Optional[bool] = True,
        sse_handler: Optional[SSEHandler] = None,
    ) -> RAGSession:
        """
        Execute a RAG query with self-correction.

        Args:
            query: User's question
            user_id: User ID
            tenant_id: Tenant ID for multi-tenancy
            config: Optional RAG configuration
            sse_handler: Optional SSE handler for streaming

        Returns:
            RAGSession with answer and sources
        """
        session_id = str(uuid.uuid4())
        config = config or RAGConfig()
        if document_ids is not None:
            config.document_ids = document_ids
        if generate_answer is not None:
            config.generate_answer = generate_answer

        logger.info(
            "Starting Agentic RAG query",
            session_id=session_id,
            user_id=user_id,
            query=query[:100]
        )

        # Initialize state
        initial_state: RAGState = {
            "session_id": session_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "config": config,

            "original_query": query,
            "current_query": query,
            "query_analysis": None,

            "document_ids": config.document_ids,

            "retrieved_documents": [],
            "relevant_documents": [],
            "retrieval_attempts": 0,

            "generated_answer": None,
            "generation_result": None,

            "next_action": None,
            "iteration_count": 0,
            "max_iterations": config.max_retrieval_attempts,

            "is_complete": False,
            "error": None,

            "thinking_steps": [],

            "started_at": datetime.now(timezone.utc),
            "completed_at": None,
        }

        # Emit start event
        if sse_handler:
            await sse_handler.send(StreamEvent.rag_start(session_id, query))

        try:
            # Build and run graph with overall timeout
            graph = self._build_graph(sse_handler)
            final_state = await asyncio.wait_for(
                graph.ainvoke(initial_state), timeout=GRAPH_TIMEOUT
            )

            # Determine status
            if final_state.get("error"):
                status = "failed"
            elif not final_state.get("relevant_documents"):
                status = "no_relevant_docs"
            else:
                status = "completed"

            # Create session result
            session = RAGSession(
                session_id=session_id,
                user_id=user_id,
                tenant_id=tenant_id,
                status=status,
                original_query=query,
                final_query=final_state.get("current_query", query),
                query_analysis=final_state.get("query_analysis"),
                answer=final_state.get("generated_answer"),
                confidence=final_state.get("generation_result", {}).confidence if final_state.get("generation_result") else 0.0,
                sources=final_state.get("relevant_documents", []),
                retrieval_attempts=final_state.get("retrieval_attempts", 0),
                thinking_steps=final_state.get("thinking_steps", []),
                error=final_state.get("error"),
                started_at=final_state.get("started_at"),
                completed_at=final_state.get("completed_at"),
            )

            # Emit done
            if sse_handler:
                await sse_handler.send(StreamEvent.rag_complete(
                    session_id,
                    status,
                    len(session.sources)
                ))

            logger.info(
                "Agentic RAG query complete",
                session_id=session_id,
                status=status,
                sources=len(session.sources)
            )

            return session

        except Exception as e:
            logger.error("Agentic RAG query failed", session_id=session_id, error=str(e))
            if sse_handler:
                await sse_handler.send_error(str(e))

            return RAGSession(
                session_id=session_id,
                user_id=user_id,
                tenant_id=tenant_id,
                status="failed",
                original_query=query,
                final_query=query,
                error=str(e),
                started_at=datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
            )
