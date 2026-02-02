"""
Agentic RAG Nodes

LangGraph nodes for the self-corrective RAG pipeline.
"""

from typing import Dict, Any, Optional, List
import structlog
from datetime import datetime, timezone

from app.agents.rag.state import (
    RAGState,
    RAGAction,
    RetrievedDocument,
    QueryAnalysis,
    GradingResult,
    GenerationResult,
)
from app.agents.streaming.sse_handler import SSEHandler
from app.agents.streaming.event_types import StreamEvent
from app.core.prompt_manager import get_prompt

logger = structlog.get_logger()


class BaseRAGNode:
    """Base class for RAG nodes"""

    def __init__(self, llm, sse_handler: Optional[SSEHandler] = None):
        self.llm = llm
        self.sse_handler = sse_handler

    async def emit_thinking(self, state: RAGState, step: str, content: str):
        """Emit a thinking step"""
        thinking_step = {
            "step": step,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        state["thinking_steps"].append(thinking_step)

        if self.sse_handler:
            await self.sse_handler.send(StreamEvent.thinking(step, content))


class QueryAnalyzerNode(BaseRAGNode):
    """Analyzes the user query to understand intent and key concepts"""

    async def __call__(self, state: RAGState) -> RAGState:
        logger.info("Analyzing query", query=state["original_query"])

        await self.emit_thinking(
            state, "query_analysis", "Analyzing query intent and key concepts..."
        )

        try:
            # Get prompt from registry
            prompt = await get_prompt(
                "rag/query_analyzer", query=state["original_query"]
            )

            response = await self.llm.ainvoke(prompt)

            # Parse response (simplified - in production use structured output)
            analysis = QueryAnalysis(
                original_query=state["original_query"],
                intent="factual",
                key_concepts=self._extract_concepts(response.content),
                expected_answer_type="text",
                complexity="medium",
                requires_context=True,
            )

            state["query_analysis"] = analysis
            state["current_query"] = state["original_query"]
            state["next_action"] = RAGAction.RETRIEVE

            await self.emit_thinking(
                state,
                "query_analyzed",
                f"Identified {len(analysis.key_concepts)} key concepts: {', '.join(analysis.key_concepts[:5])}",
            )

        except Exception as e:
            logger.error("Query analysis failed", error=str(e))
            state["error"] = f"Query analysis failed: {str(e)}"
            state["next_action"] = RAGAction.FAIL

        return state

    def _extract_concepts(self, content: str) -> List[str]:
        """Extract key concepts from LLM response"""
        # Simplified extraction - in production parse structured output
        words = content.split()
        return [w.strip(".,;:") for w in words if len(w) > 4][:10]


class RetrieverNode(BaseRAGNode):
    """Retrieves documents from the vector store"""

    def __init__(self, llm, rag_service, sse_handler: Optional[SSEHandler] = None):
        super().__init__(llm, sse_handler)
        self.rag_service = rag_service

    async def __call__(self, state: RAGState) -> RAGState:
        logger.info("Retrieving documents", query=state["current_query"])

        state["retrieval_attempts"] += 1
        await self.emit_thinking(
            state,
            "retrieving",
            f"Searching for relevant documents (attempt {state['retrieval_attempts']})...",
        )

        try:
            # Use RAG service to retrieve
            document_ids = state.get("document_ids") or state["config"].document_ids
            results = await self.rag_service.query(
                query=state["current_query"],
                tutor_id=state["tenant_id"],
                document_ids=document_ids,
                top_k=state["config"].top_k,
            )

            # Convert to RetrievedDocument objects
            documents = []
            for i, result in enumerate(results.get("results", [])):
                doc = RetrievedDocument(
                    content=result.get("content", ""),
                    source_file=result.get("source", "unknown"),
                    source_file_id=result.get("file_id", ""),
                    page_number=result.get("page_number"),
                    chunk_index=i,
                    relevance_score=result.get("score", 0.0),
                    metadata=result.get("metadata", {}),
                )
                documents.append(doc)

            state["retrieved_documents"] = documents
            state["next_action"] = RAGAction.GRADE

            await self.emit_thinking(
                state, "retrieved", f"Found {len(documents)} document chunks"
            )

        except Exception as e:
            logger.error("Retrieval failed", error=str(e))
            state["error"] = f"Retrieval failed: {str(e)}"
            state["next_action"] = RAGAction.FAIL

        return state


class RelevanceGraderNode(BaseRAGNode):
    """Grades retrieved documents for relevance"""

    async def __call__(self, state: RAGState) -> RAGState:
        logger.info(
            "Grading document relevance", doc_count=len(state["retrieved_documents"])
        )

        await self.emit_thinking(state, "grading", "Evaluating document relevance...")

        try:
            relevant_docs = []
            threshold = state["config"].relevance_threshold

            for doc in state["retrieved_documents"]:
                # Use LLM to grade relevance
                prompt = await get_prompt(
                    "rag/relevance_grader",
                    query=state["current_query"],
                    document=doc.content[:1000],  # Truncate for grading
                )

                response = await self.llm.ainvoke(prompt)

                # Parse yes/no response
                is_relevant = "yes" in response.content.lower()
                doc.is_relevant = is_relevant

                if is_relevant or doc.relevance_score >= threshold:
                    relevant_docs.append(doc)

            state["relevant_documents"] = relevant_docs

            if len(relevant_docs) == 0:
                # No relevant docs - try rewriting query
                if (
                    state["config"].enable_query_rewriting
                    and state["retrieval_attempts"]
                    < state["config"].max_retrieval_attempts
                ):
                    state["next_action"] = RAGAction.REWRITE
                    await self.emit_thinking(
                        state,
                        "no_relevant_docs",
                        "No relevant documents found, rewriting query...",
                    )
                else:
                    state["next_action"] = RAGAction.FAIL
                    state["error"] = "No relevant documents found after all attempts"
            else:
                if state["config"].generate_answer:
                    state["next_action"] = RAGAction.GENERATE
                else:
                    state["next_action"] = RAGAction.COMPLETE
                await self.emit_thinking(
                    state, "graded", f"Found {len(relevant_docs)} relevant documents"
                )

        except Exception as e:
            logger.error("Grading failed", error=str(e))
            state["error"] = f"Grading failed: {str(e)}"
            state["next_action"] = RAGAction.FAIL

        return state


class QueryRewriterNode(BaseRAGNode):
    """Rewrites the query for better retrieval"""

    async def __call__(self, state: RAGState) -> RAGState:
        logger.info("Rewriting query", original=state["current_query"])

        await self.emit_thinking(
            state, "rewriting", "Reformulating query for better results..."
        )

        try:
            prompt = await get_prompt(
                "rag/query_rewriter",
                original_query=state["original_query"],
                current_query=state["current_query"],
                attempt=state["retrieval_attempts"],
            )

            response = await self.llm.ainvoke(prompt)
            state["current_query"] = response.content.strip()
            state["next_action"] = RAGAction.RETRIEVE

            await self.emit_thinking(
                state, "rewritten", f"New query: {state['current_query']}"
            )

        except Exception as e:
            logger.error("Query rewriting failed", error=str(e))
            state["next_action"] = RAGAction.FAIL
            state["error"] = f"Query rewriting failed: {str(e)}"

        return state


class AnswerGeneratorNode(BaseRAGNode):
    """Generates answer from relevant documents"""

    async def __call__(self, state: RAGState) -> RAGState:
        logger.info("Generating answer", doc_count=len(state["relevant_documents"]))

        await self.emit_thinking(
            state, "generating", "Synthesizing answer from documents..."
        )

        try:
            # Combine relevant document content
            context = "\n\n---\n\n".join(
                [
                    f"[Source: {doc.source_file}]\n{doc.content}"
                    for doc in state["relevant_documents"]
                ]
            )

            prompt = await get_prompt(
                "rag/answer_generator", query=state["current_query"], context=context
            )

            response = await self.llm.ainvoke(prompt)

            state["generated_answer"] = response.content
            state["generation_result"] = GenerationResult(
                answer=response.content,
                confidence=0.85,  # Could be calculated from relevance scores
                sources_used=[doc.source_file for doc in state["relevant_documents"]],
            )

            if state["config"].enable_hallucination_check:
                state["next_action"] = RAGAction.CHECK_HALLUCINATION
            else:
                state["next_action"] = RAGAction.COMPLETE

            await self.emit_thinking(
                state, "generated", "Answer generated successfully"
            )

        except Exception as e:
            logger.error("Answer generation failed", error=str(e))
            state["error"] = f"Answer generation failed: {str(e)}"
            state["next_action"] = RAGAction.FAIL

        return state


class HallucinationCheckerNode(BaseRAGNode):
    """Checks generated answer for hallucinations"""

    async def __call__(self, state: RAGState) -> RAGState:
        logger.info("Checking for hallucinations")

        await self.emit_thinking(
            state, "checking_hallucination", "Verifying answer against sources..."
        )

        try:
            context = "\n\n".join([doc.content for doc in state["relevant_documents"]])

            prompt = await get_prompt(
                "rag/hallucination_checker",
                answer=state["generated_answer"],
                context=context,
            )

            response = await self.llm.ainvoke(prompt)

            has_hallucination = (
                "yes" in response.content.lower()
                or "hallucination" in response.content.lower()
            )

            if state["generation_result"]:
                state["generation_result"].has_hallucination = has_hallucination
                if has_hallucination:
                    state["generation_result"].hallucination_details = response.content

            if has_hallucination and state["config"].enable_self_correction:
                # Could trigger regeneration with stricter constraints
                await self.emit_thinking(
                    state,
                    "hallucination_detected",
                    "Potential hallucination detected, but proceeding with warning",
                )

            state["next_action"] = RAGAction.COMPLETE
            await self.emit_thinking(state, "verified", "Answer verification complete")

        except Exception as e:
            logger.error("Hallucination check failed", error=str(e))
            # Don't fail the whole pipeline for this
            state["next_action"] = RAGAction.COMPLETE

        return state
