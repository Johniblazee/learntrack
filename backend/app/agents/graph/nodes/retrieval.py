"""
Material retrieval node for LangGraph agent.
"""

from typing import Optional
import structlog

from app.agents.graph.state import AgentState
from app.agents.streaming.sse_handler import SSEHandler
from app.agents.tools.material_retriever import retrieve_materials
from .base import BaseNode

logger = structlog.get_logger()


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

