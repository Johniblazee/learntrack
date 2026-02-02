"""
Web Search Tool for Agent

Provides web search capabilities as a fallback when RAG materials are not available.
Part of the RAG → Web Search → Default Knowledge sequence.
"""

from typing import List, Optional
import structlog
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from app.agents.graph.state import SourceChunk
from app.services.web_search_service import WebSearchService

logger = structlog.get_logger()


class WebSearchInput(BaseModel):
    """Input schema for web search tool"""

    query: str = Field(description="The search query to find relevant web content")
    max_results: int = Field(default=5, description="Number of web results to retrieve")


class WebSearchTool(BaseTool):
    """
    Tool for retrieving content from web search.

    Uses the WebSearchService to perform web searches via Tavily API.
    Used as fallback when no RAG materials are available.
    """

    name: str = "web_search"
    description: str = """
    Searches the web for relevant educational content.
    Use this when no uploaded materials are available to provide context.
    Input should be a search query describing what content you need.
    """
    args_schema: type[BaseModel] = WebSearchInput

    # Injected dependencies
    web_search_service: Optional[WebSearchService] = None
    tenant_id: Optional[str] = None

    def __init__(self, web_search_service=None, tenant_id: str = None, **kwargs):
        super().__init__(**kwargs)
        self.web_search_service = web_search_service
        self.tenant_id = tenant_id

    def _run(self, query: str, max_results: int = 5) -> List[SourceChunk]:
        """Synchronous run - not implemented, use async"""
        raise NotImplementedError("Use async version")

    async def _arun(self, query: str, max_results: int = 5) -> List[SourceChunk]:
        """
        Retrieve web search results.

        Args:
            query: Search query
            max_results: Number of results to retrieve

        Returns:
            List of SourceChunk with web content
        """
        if not self.web_search_service:
            logger.error("Web search service not configured")
            return []

        if not self.tenant_id:
            logger.error("Tenant ID not configured for web search")
            return []

        try:
            logger.info(
                "Performing web search", query=query[:100], max_results=max_results
            )

            # Perform web search
            results = await self.web_search_service.search(
                query=query,
                tutor_id=self.tenant_id,
                max_results=max_results,
                search_depth="basic",
            )

            # Convert to SourceChunk format
            chunks = []
            for i, result in enumerate(results, 1):
                chunk = SourceChunk(
                    material_id=f"web_{i}",
                    material_title=result.title,
                    content=result.content,
                    location=None,
                    relevance_score=result.score,
                    source_type="web",
                    url=result.url,
                )
                chunks.append(chunk)

            logger.info("Retrieved web search chunks", count=len(chunks))
            return chunks

        except Exception as e:
            logger.error("Web search failed", error=str(e))
            return []


async def perform_web_search(
    web_search_service: WebSearchService,
    tenant_id: str,
    query: str,
    max_results: int = 5,
) -> List[SourceChunk]:
    """
    Convenience function for performing web search without tool wrapper.

    Args:
        web_search_service: The web search service instance
        tenant_id: Tenant ID for multi-tenancy and credit management
        query: Search query
        max_results: Number of results

    Returns:
        List of SourceChunk from web search
    """
    tool = WebSearchTool(web_search_service=web_search_service, tenant_id=tenant_id)
    return await tool._arun(query=query, max_results=max_results)
