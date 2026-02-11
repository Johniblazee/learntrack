"""
Material Retriever Tool

Retrieves relevant content from source materials using RAG.
"""

from typing import List, Optional
import structlog
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from app.agents.graph.state import SourceChunk
from app.core.utils import to_object_id

logger = structlog.get_logger()


class MaterialRetrieverInput(BaseModel):
    """Input schema for material retriever"""

    query: str = Field(description="The search query to find relevant content")
    material_ids: List[str] = Field(description="List of material IDs to search within")
    top_k: int = Field(default=5, description="Number of chunks to retrieve")


class MaterialRetrieverTool(BaseTool):
    """
    Tool for retrieving relevant content from uploaded materials.

    Uses the RAG service to perform semantic search across
    the user's uploaded documents.
    """

    name: str = "material_retriever"
    description: str = """
    Retrieves relevant content from the teacher's uploaded materials.
    Use this to find source content for generating questions.
    Input should be a search query describing what content you need.
    """
    args_schema: type[BaseModel] = MaterialRetrieverInput

    # Injected dependencies
    rag_service: Optional[object] = None
    tenant_id: Optional[str] = None

    def __init__(self, rag_service=None, tenant_id: str = None, **kwargs):
        super().__init__(**kwargs)
        self.rag_service = rag_service
        self.tenant_id = tenant_id

    def _run(
        self, query: str, material_ids: List[str], top_k: int = 5
    ) -> List[SourceChunk]:
        """Synchronous run - not implemented, use async"""
        raise NotImplementedError("Use async version")

    async def _arun(
        self, query: str, material_ids: List[str], top_k: int = 5
    ) -> List[SourceChunk]:
        """
        Retrieve relevant chunks from materials.

        Args:
            query: Search query
            material_ids: Materials to search within
            top_k: Number of results

        Returns:
            List of SourceChunk with relevant content
        """
        if not self.rag_service:
            logger.error("RAG service not configured")
            return []

        try:
            logger.info(
                "Retrieving materials",
                query=query[:100],
                material_count=len(material_ids),
                top_k=top_k,
            )

            # Use RAG service to retrieve context
            # The tenant_id is used as tutor_id in the RAG service
            documents = await self.rag_service.retrieve_context(
                query=query,
                tutor_id=self.tenant_id,
                document_ids=material_ids,
                top_k=top_k,
            )

            # Get file metadata for titles
            file_titles = {}
            if self.rag_service.db:
                for doc in documents:
                    file_id = doc.metadata.get("file_id")
                    if file_id and file_id not in file_titles:
                        file_doc = await self.rag_service.db.files.find_one(
                            {"_id": to_object_id(file_id)}
                        )
                        if file_doc:
                            file_titles[file_id] = file_doc.get("filename", "Unknown")

            chunks = []
            for doc in documents:
                file_id = (
                    doc.metadata.get("file_id") or doc.metadata.get("filename") or ""
                )
                chunk = SourceChunk(
                    material_id=file_id,
                    material_title=file_titles.get(file_id, "Unknown"),
                    content=doc.page_content,
                    location=str(doc.metadata.get("chunk_index", "")),
                    relevance_score=doc.metadata.get("score", 0.0),
                )
                chunks.append(chunk)

            logger.info("Retrieved chunks", count=len(chunks))
            return chunks

        except Exception as e:
            logger.error("Material retrieval failed", error=str(e))
            return []


async def retrieve_materials(
    rag_service, tenant_id: str, query: str, material_ids: List[str], top_k: int = 5
) -> List[SourceChunk]:
    """
    Convenience function for retrieving materials without tool wrapper.

    Args:
        rag_service: The RAG service instance
        tenant_id: Tenant ID for multi-tenancy
        query: Search query
        material_ids: Materials to search
        top_k: Number of results

    Returns:
        List of SourceChunk
    """
    tool = MaterialRetrieverTool(rag_service=rag_service, tenant_id=tenant_id)
    return await tool._arun(query=query, material_ids=material_ids, top_k=top_k)
