"""
Main RAG Service using LangChain
Consolidated RAG orchestrator that replaces multiple scattered services
"""

import asyncio
import uuid
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone
import structlog

from langchain_core.documents import Document
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.models.file import UploadedFile, EmbeddingStatus
from .embedding_service import EmbeddingService
from .chunking_service import ChunkingService
from .retrieval_service import RetrievalService

logger = structlog.get_logger()


class RAGService:
    """
    Main RAG service that consolidates document processing, embedding, and retrieval
    Replaces scattered services with unified LangChain-based implementation
    """

    def __init__(
        self,
        database: AsyncIOMotorDatabase,
        embedding_service: Optional[EmbeddingService] = None,
        collection_name: str = "documents",
    ):
        self.db = database

        # Initialize services with LangChain
        self.embedding_service = embedding_service or EmbeddingService()
        self.chunking_service = ChunkingService(self.embedding_service)
        self.retrieval_service = RetrievalService(
            embedding_service=self.embedding_service, collection_name=collection_name
        )

        logger.info(
            "Initialized RAGService with LangChain",
            embedding_model=self.embedding_service.model_name,
            collection_name=collection_name,
        )

    async def process_document(
        self,
        file_path: str,
        filename: str,
        tenant_id: str,
        user_id: str,
        chunk_type: str = "semantic",
        **chunk_kwargs,
    ) -> Dict[str, Any]:
        """
        Process a document: load, chunk, embed, and store
        Replaces complex document processing with LangChain pipeline
        """
        try:
            # Load document using langchain-docling via DocumentProcessor
            from .processors.document_processor import DocumentProcessor

            processor = DocumentProcessor()
            documents = await processor.load_document(file_path, filename)

            if not documents:
                raise ValueError("No content could be extracted from the document")

            # Add metadata to documents
            for doc in documents:
                doc.metadata.update(
                    {
                        "filename": filename,
                        "file_path": file_path,
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "processed_at": datetime.now(timezone.utc).isoformat(),
                        "id": str(uuid.uuid4()),
                    }
                )

            # Chunk documents using LangChain
            chunks = await self.chunking_service.chunk_documents(
                documents, chunk_type=chunk_type, **chunk_kwargs
            )

            if not chunks:
                raise ValueError("No chunks were created from the document")

            # Store chunks in vector database using LangChain
            chunk_ids = await self.retrieval_service.add_documents(chunks)

            # Update file record in database
            await self._update_file_status(
                filename,
                tenant_id,
                EmbeddingStatus.COMPLETED,
                {
                    "chunks_count": len(chunks),
                    "chunk_ids": chunk_ids,
                    "embedding_model": self.embedding_service.model_name,
                    "chunk_type": chunk_type,
                    "processed_at": datetime.now(timezone.utc).isoformat(),
                },
            )

            logger.info(
                "Successfully processed document",
                filename=filename,
                chunks_created=len(chunks),
                chunk_type=chunk_type,
            )

            return {
                "success": True,
                "filename": filename,
                "chunks_count": len(chunks),
                "chunk_ids": chunk_ids,
                "embedding_model": self.embedding_service.model_name,
                "chunk_type": chunk_type,
            }

        except Exception as e:
            logger.error(
                "Failed to process document",
                error=str(e),
                filename=filename,
                tenant_id=tenant_id,
            )

            # Update file status with error
            await self._update_file_status(
                filename, tenant_id, EmbeddingStatus.FAILED, {"error": str(e)}
            )

            return {
                "success": False,
                "filename": filename,
                "error": str(e),
            }

    async def search_documents(
        self,
        query: str,
        tenant_id: str,
        k: int = 5,
        search_type: str = "similarity",
        score_threshold: float = 0.7,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Search documents with tenant isolation
        """
        try:
            # Build tenant filter
            filter_dict = {"tenant_id": tenant_id}

            # Perform search based on type
            if search_type == "similarity":
                results = await self.retrieval_service.similarity_search(
                    query=query,
                    k=k,
                    filter_dict=filter_dict,
                    score_threshold=score_threshold,
                    **kwargs,
                )
            elif search_type == "mmr":
                results = await self.retrieval_service.mmr_search(
                    query=query, k=k, filter_dict=filter_dict, **kwargs
                )
            elif search_type == "with_scores":
                results = await self.retrieval_service.similarity_search_with_relevance_scores(
                    query=query, k=k, filter_dict=filter_dict, **kwargs
                )
                return {"results": results, "search_type": "with_scores"}
            else:
                raise ValueError(f"Unknown search type: {search_type}")

            logger.info(
                "Performed document search",
                query_length=len(query),
                search_type=search_type,
                results_count=len(results),
                tenant_id=tenant_id,
            )

            return {
                "results": results,
                "search_type": search_type,
                "query": query,
                "k": k,
            }

        except Exception as e:
            logger.error(
                "Failed to search documents",
                error=str(e),
                query=query,
                tenant_id=tenant_id,
            )
            raise

    async def delete_document(self, filename: str, tenant_id: str) -> Dict[str, Any]:
        """
        Delete a document from the vector store and database
        """
        try:
            # Search for document chunks to delete
            filter_dict = {
                "tenant_id": tenant_id,
                "filename": filename,
            }

            # Delete from vector store
            success = await self.retrieval_service.delete_documents(
                filter_dict=filter_dict
            )

            if success:
                # Update file status in database
                await self._update_file_status(
                    filename,
                    tenant_id,
                    EmbeddingStatus.PENDING,
                    {"deleted_at": datetime.now(timezone.utc).isoformat()},
                )

                logger.info(
                    "Successfully deleted document",
                    filename=filename,
                    tenant_id=tenant_id,
                )

                return {
                    "success": True,
                    "filename": filename,
                    "message": "Document deleted successfully",
                }
            else:
                raise Exception("Failed to delete from vector store")

        except Exception as e:
            logger.error(
                "Failed to delete document",
                error=str(e),
                filename=filename,
                tenant_id=tenant_id,
            )
            return {
                "success": False,
                "filename": filename,
                "error": str(e),
            }

    async def get_document_stats(
        self, tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get statistics about stored documents"""
        try:
            # Get collection stats
            stats = await self.retrieval_service.get_collection_stats()

            if tenant_id:
                # Filter by tenant
                filter_dict = {"tenant_id": tenant_id}
                tenant_docs = await self.retrieval_service.search_by_metadata(
                    filter_dict=filter_dict,
                    limit=10000,  # Large number to get all
                )
                stats["tenant_document_count"] = len(tenant_docs)
                stats["tenant_id"] = tenant_id

            return stats

        except Exception as e:
            logger.error(
                "Failed to get document stats",
                error=str(e),
                tenant_id=tenant_id,
            )
            return {}

    async def delete_file_embeddings(
        self, filename: str, tenant_id: str
    ) -> Dict[str, Any]:
        """Delete embeddings for a specific file"""
        return await self.delete_document(filename, tenant_id)

    async def get_collection_stats(self) -> Dict[str, Any]:
        """Get collection statistics"""
        return await self.get_document_stats()

    async def _update_file_status(
        self,
        filename: str,
        tenant_id: str,
        status: EmbeddingStatus,
        metadata: Dict[str, Any],
    ) -> None:
        """Update file status in database"""
        try:
            await self.db.uploaded_files.update_one(
                {
                    "filename": filename,
                    "tenant_id": tenant_id,
                },
                {
                    "$set": {
                        "embedding_status": status,
                        "embedding_metadata": metadata,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
        except Exception as e:
            logger.error(
                "Failed to update file status",
                error=str(e),
                filename=filename,
                tenant_id=tenant_id,
            )

    async def get_relevant_context(
        self, query: str, tenant_id: str, max_context_length: int = 4000, **kwargs
    ) -> str:
        """
        Get relevant context for a query, formatted for LLM input
        """
        try:
            # Search for relevant documents
            search_result = await self.search_documents(
                query=query, tenant_id=tenant_id, k=5, **kwargs
            )

            documents = search_result.get("results", [])

            if not documents:
                return ""

            # Format context
            context_parts = []
            current_length = 0

            for doc in documents:
                content = doc.page_content.strip()
                metadata = doc.metadata

                # Format document snippet
                snippet = f"""
Source: {metadata.get("filename", "Unknown")}
{content}
---
"""

                if current_length + len(snippet) <= max_context_length:
                    context_parts.append(snippet)
                    current_length += len(snippet)
                else:
                    break

            context = "".join(context_parts).strip()

            logger.info(
                "Generated relevant context",
                query_length=len(query),
                context_length=len(context),
                documents_used=len(context_parts),
                tenant_id=tenant_id,
            )

            return context

        except Exception as e:
            logger.error(
                "Failed to get relevant context",
                error=str(e),
                query=query,
                tenant_id=tenant_id,
            )
            return ""


# Global instance for convenience
_default_rag_service = None


def get_rag_service(
    database: AsyncIOMotorDatabase, collection_name: str = "documents"
) -> RAGService:
    """Get or create default RAG service"""
    global _default_rag_service
    if _default_rag_service is None:
        _default_rag_service = RAGService(
            database=database,
            collection_name=collection_name,
        )
    return _default_rag_service


def create_rag_service(
    database: AsyncIOMotorDatabase,
    embedding_service: Optional[EmbeddingService] = None,
    collection_name: str = "documents",
) -> RAGService:
    """Create a new RAG service instance"""
    return RAGService(
        database=database,
        embedding_service=embedding_service,
        collection_name=collection_name,
    )
