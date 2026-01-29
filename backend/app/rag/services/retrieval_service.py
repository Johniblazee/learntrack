"""
Retrieval Service using LangChain Qdrant
Optimized document retrieval with configurable strategies
"""

import os
from typing import List, Dict, Any, Optional, Tuple
import structlog

from langchain_community.vectorstores import Qdrant
from langchain_core.documents import Document
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    Filter,
    FieldCondition,
    MatchValue,
    SearchParams,
)
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from .embedding_service import EmbeddingService

logger = structlog.get_logger()


class RetrievalService:
    """
    Retrieval service using LangChain Qdrant
    Handles document search and retrieval with various strategies
    """

    def __init__(
        self,
        embedding_service: Optional[EmbeddingService] = None,
        collection_name: str = "documents",
        qdrant_url: Optional[str] = None,
        qdrant_api_key: Optional[str] = None,
    ):
        self.embedding_service = embedding_service or EmbeddingService()
        self.collection_name = collection_name

        # Get Qdrant configuration from .env
        self.qdrant_url = qdrant_url or settings.QDRANT_URL
        self.qdrant_api_key = qdrant_api_key or getattr(
            settings, "QDRANT_API_KEY", None
        )

        # Initialize Qdrant client
        self._qdrant_client = None
        self._vectorstore = None

        logger.info(
            "Initialized RetrievalService",
            collection_name=collection_name,
            qdrant_url=self.qdrant_url,
        )

    @property
    def qdrant_client(self) -> QdrantClient:
        """Lazy initialization of Qdrant client"""
        if self._qdrant_client is None:
            if self.qdrant_api_key:
                self._qdrant_client = QdrantClient(
                    url=self.qdrant_url,
                    api_key=self.qdrant_api_key,
                )
            else:
                self._qdrant_client = QdrantClient(url=self.qdrant_url)

            logger.info("Connected to Qdrant", url=self.qdrant_url)
        return self._qdrant_client

    @property
    def vectorstore(self) -> Qdrant:
        """Lazy initialization of LangChain Qdrant vectorstore"""
        if self._vectorstore is None:
            self._vectorstore = Qdrant(
                client=self.qdrant_client,
                collection_name=self.collection_name,
                embeddings=self.embedding_service.embeddings,
            )

            # Create collection if it doesn't exist
            self._ensure_collection_exists()

        return self._vectorstore

    def _ensure_collection_exists(self) -> None:
        """Ensure the collection exists with proper configuration"""
        try:
            collections = self.qdrant_client.get_collections()
            collection_names = [c.name for c in collections.collections]

            if self.collection_name not in collection_names:
                self.qdrant_client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.embedding_service.model_config.dimensions,
                        distance=Distance.COSINE,
                    ),
                )
                logger.info(
                    "Created Qdrant collection",
                    collection=self.collection_name,
                    dimensions=self.embedding_service.model_config.dimensions,
                )
        except Exception as e:
            logger.error("Failed to ensure collection exists", error=str(e))
            raise

    async def add_documents(
        self, documents: List[Document], batch_size: int = 100, **kwargs
    ) -> List[str]:
        """
        Add documents to the vector store
        """
        if not documents:
            return []

        try:
            # Process in batches to avoid memory issues
            all_ids = []
            for i in range(0, len(documents), batch_size):
                batch = documents[i : i + batch_size]

                # Add unique IDs if not present
                for j, doc in enumerate(batch):
                    if "id" not in doc.metadata:
                        doc.metadata["id"] = f"doc_{i}_{j}_{hash(doc.page_content)}"

                # Use LangChain's optimized document addition
                ids = await self.vectorstore.aadd_documents(batch, **kwargs)
                all_ids.extend(ids)

                logger.debug(
                    "Added document batch",
                    batch_size=len(batch),
                    total_processed=i + len(batch),
                )

            logger.info(
                "Successfully added documents",
                total_documents=len(documents),
                collection=self.collection_name,
            )

            return all_ids

        except Exception as e:
            logger.error(
                "Failed to add documents",
                error=str(e),
                documents_count=len(documents),
            )
            raise

    async def similarity_search(
        self,
        query: str,
        k: int = 5,
        filter_dict: Optional[Dict[str, Any]] = None,
        score_threshold: float = 0.7,
        **kwargs,
    ) -> List[Document]:
        """
        Perform similarity search with optional filtering
        """
        try:
            # Convert filter dict to Qdrant Filter if provided
            qdrant_filter = self._build_filter(filter_dict) if filter_dict else None

            # Perform search with score threshold
            results = await self.vectorstore.asimilarity_search_with_score(
                query=query, k=k, filter=qdrant_filter, **kwargs
            )

            # Filter by score threshold and convert to Document objects
            filtered_docs = []
            for doc, score in results:
                if score >= score_threshold:
                    doc.metadata["similarity_score"] = score
                    filtered_docs.append(doc)

            logger.info(
                "Performed similarity search",
                query_length=len(query),
                k=k,
                results_found=len(filtered_docs),
                score_threshold=score_threshold,
            )

            return filtered_docs

        except Exception as e:
            logger.error(
                "Failed to perform similarity search",
                error=str(e),
                query=query[:100],  # Log first 100 chars
            )
            raise

    async def similarity_search_with_relevance_scores(
        self,
        query: str,
        k: int = 5,
        filter_dict: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> List[Tuple[Document, float]]:
        """
        Perform similarity search and return documents with relevance scores
        """
        try:
            qdrant_filter = self._build_filter(filter_dict) if filter_dict else None

            results = await self.vectorstore.asimilarity_search_with_score(
                query=query, k=k, filter=qdrant_filter, **kwargs
            )

            logger.info(
                "Performed similarity search with scores",
                query_length=len(query),
                k=k,
                results_count=len(results),
            )

            return results

        except Exception as e:
            logger.error(
                "Failed to perform similarity search with scores",
                error=str(e),
            )
            raise

    async def mmr_search(
        self,
        query: str,
        k: int = 5,
        fetch_k: int = 20,
        filter_dict: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> List[Document]:
        """
        Perform Maximal Marginal Relevance search for diverse results
        """
        try:
            qdrant_filter = self._build_filter(filter_dict) if filter_dict else None

            results = await self.vectorstore.amax_marginal_relevance_search(
                query=query, k=k, fetch_k=fetch_k, filter=qdrant_filter, **kwargs
            )

            logger.info(
                "Performed MMR search",
                query_length=len(query),
                k=k,
                fetch_k=fetch_k,
                results_count=len(results),
            )

            return results

        except Exception as e:
            logger.error(
                "Failed to perform MMR search",
                error=str(e),
            )
            raise

    def _build_filter(self, filter_dict: Dict[str, Any]) -> Filter:
        """Build Qdrant filter from dictionary"""
        conditions = []

        for key, value in filter_dict.items():
            if isinstance(value, (str, int, float, bool)):
                conditions.append(
                    FieldCondition(
                        key=f"metadata.{key}",
                        match=MatchValue(value=value),
                    )
                )
            elif isinstance(value, dict):
                # Handle nested filters
                for sub_key, sub_value in value.items():
                    conditions.append(
                        FieldCondition(
                            key=f"metadata.{key}.{sub_key}",
                            match=MatchValue(value=sub_value),
                        )
                    )

        return Filter(must=conditions) if conditions else None

    async def delete_documents(
        self,
        document_ids: Optional[List[str]] = None,
        filter_dict: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> bool:
        """
        Delete documents by IDs or filter
        """
        try:
            if document_ids:
                # Delete by specific IDs
                await self.vectorstore.adelete(ids=document_ids, **kwargs)
                logger.info("Deleted documents by IDs", count=len(document_ids))
            elif filter_dict:
                # Delete by filter
                qdrant_filter = self._build_filter(filter_dict)
                await self.vectorstore.adelete(filter=qdrant_filter, **kwargs)
                logger.info("Deleted documents by filter", filter=filter_dict)
            else:
                raise ValueError("Must provide either document_ids or filter_dict")

            return True

        except Exception as e:
            logger.error(
                "Failed to delete documents",
                error=str(e),
                document_ids=document_ids,
                filter_dict=filter_dict,
            )
            return False

    async def update_documents(self, documents: List[Document], **kwargs) -> List[str]:
        """
        Update documents in the vector store
        """
        try:
            # First delete existing documents with the same IDs
            doc_ids = [
                doc.metadata.get("id") for doc in documents if "id" in doc.metadata
            ]
            if doc_ids:
                await self.delete_documents(document_ids=doc_ids)

            # Then add the updated documents
            return await self.add_documents(documents, **kwargs)

        except Exception as e:
            logger.error(
                "Failed to update documents",
                error=str(e),
                documents_count=len(documents),
            )
            raise

    async def get_collection_stats(self) -> Dict[str, Any]:
        """Get statistics about the collection"""
        try:
            collection_info = self.qdrant_client.get_collection(self.collection_name)

            return {
                "collection_name": self.collection_name,
                "vectors_count": collection_info.vectors_count,
                "indexed_vectors_count": collection_info.indexed_vectors_count,
                "points_count": collection_info.points_count,
                "status": collection_info.status.value,
                "optimizer_status": collection_info.optimizer_status.value,
                "vector_size": self.embedding_service.model_config.dimensions,
            }

        except Exception as e:
            logger.error(
                "Failed to get collection stats",
                error=str(e),
            )
            return {}

    async def search_by_metadata(
        self, filter_dict: Dict[str, Any], limit: int = 100, **kwargs
    ) -> List[Document]:
        """
        Search documents by metadata only (no vector similarity)
        """
        try:
            qdrant_filter = self._build_filter(filter_dict)

            # Use scroll to get documents matching the filter
            points, _ = self.qdrant_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_filter,
                limit=limit,
                **kwargs,
            )

            # Convert points to Document objects
            documents = []
            for point in points:
                if point.payload and "text" in point.payload:
                    doc = Document(
                        page_content=point.payload["text"],
                        metadata=point.payload.get("metadata", {}),
                    )
                    doc.metadata["id"] = str(point.id)
                    documents.append(doc)

            logger.info(
                "Performed metadata search",
                filter=filter_dict,
                results_count=len(documents),
            )

            return documents

        except Exception as e:
            logger.error(
                "Failed to search by metadata",
                error=str(e),
                filter_dict=filter_dict,
            )
            raise


# Global instance for convenience
_default_retrieval_service = None


def get_retrieval_service(
    embedding_service: Optional[EmbeddingService] = None,
    collection_name: str = "documents",
) -> RetrievalService:
    """Get or create default retrieval service"""
    global _default_retrieval_service
    if _default_retrieval_service is None:
        _default_retrieval_service = RetrievalService(
            embedding_service=embedding_service,
            collection_name=collection_name,
        )
    return _default_retrieval_service


def create_retrieval_service(
    embedding_service: Optional[EmbeddingService] = None,
    collection_name: str = "documents",
) -> RetrievalService:
    """Create a new retrieval service instance"""
    return RetrievalService(
        embedding_service=embedding_service,
        collection_name=collection_name,
    )
