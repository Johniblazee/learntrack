"""
Main RAG Service using LangChain
Consolidated RAG orchestrator that replaces multiple scattered services
"""

import asyncio
import os
import uuid
from typing import TYPE_CHECKING, List, Dict, Any, Optional, Set
from datetime import datetime, timezone
import structlog

# Global lock for RAG service singleton creation
_rag_service_lock = asyncio.Lock()

from langchain_core.documents import Document
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.file import EmbeddingStatus
from app.core.utils import to_object_id

if TYPE_CHECKING:
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
        embedding_service: Optional["EmbeddingService"] = None,
        collection_name: str = "documents",
    ):
        self.db = database
        self.base_collection_name = collection_name

        from .chunking_service import ChunkingService
        from .embedding_service import EmbeddingService
        from .retrieval_service import RetrievalService

        self.embedding_service = embedding_service or EmbeddingService()
        self.chunking_service = ChunkingService(self.embedding_service)
        self.retrieval_service = RetrievalService(
            embedding_service=self.embedding_service, collection_name=collection_name
        )

        logger.info(
            "Initialized RAGService with LangChain",
            embedding_model=self.embedding_service.model_name,
            base_collection_name=collection_name,
            active_collection_name=self.retrieval_service.collection_name,
        )

    async def process_document(
        self,
        file_path: str,
        filename: Optional[str] = None,
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        chunk_type: str = "semantic",
        **chunk_kwargs,
    ) -> Dict[str, Any]:
        """
        Process a document: load, chunk, embed, and store
        Replaces complex document processing with LangChain pipeline
        """
        try:
            raw_file_id = chunk_kwargs.pop("file_id", None)
            file_id = raw_file_id if isinstance(raw_file_id, str) else None

            raw_tutor_id = chunk_kwargs.pop("tutor_id", None)
            tutor_id = raw_tutor_id if isinstance(raw_tutor_id, str) else None
            chunk_kwargs.pop("file_url", None)

            if filename is None:
                filename = file_id or os.path.basename(file_path) or str(uuid.uuid4())

            if tenant_id is None:
                tenant_id = tutor_id

            if tenant_id is None:
                raise ValueError("tenant_id (or tutor_id) is required for processing")

            if user_id is None:
                raw_uploaded_by = chunk_kwargs.pop("uploaded_by", None)
                user_id = (
                    raw_uploaded_by if isinstance(raw_uploaded_by, str) else tenant_id
                )

            assert filename is not None
            assert tenant_id is not None
            assert user_id is not None

            # Load document using langchain-docling via DocumentProcessor
            from app.rag.processors.document_processor import DocumentProcessor

            processor = DocumentProcessor()
            documents = await processor.load_document(file_path, filename)

            if not documents:
                raise ValueError("No content could be extracted from the document")

            # Add metadata to documents
            for doc in documents:
                doc.metadata.update(
                    {
                        "filename": filename,
                        "file_id": file_id or filename,
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
            try:
                if filename and tenant_id:
                    await self._update_file_status(
                        filename, tenant_id, EmbeddingStatus.FAILED, {"error": str(e)}
                    )
            except Exception as status_error:
                logger.error(
                    "Failed to update file status after error",
                    original_error=str(e),
                    status_error=str(status_error),
                    filename=filename,
                    tenant_id=tenant_id,
                )

            return {
                "success": False,
                "filename": filename or "",
                "error": str(e),
            }

    async def search_documents(
        self,
        query: str,
        tenant_id: str,
        k: int = 5,
        document_ids: Optional[List[str]] = None,
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

            search_k = max(k, 20) if document_ids else k

            # Perform search based on type
            if search_type == "similarity":
                results = await self.retrieval_service.similarity_search(
                    query=query,
                    k=search_k,
                    filter_dict=filter_dict,
                    score_threshold=score_threshold,
                    **kwargs,
                )
            elif search_type == "mmr":
                results = await self.retrieval_service.mmr_search(
                    query=query, k=search_k, filter_dict=filter_dict, **kwargs
                )
            elif search_type == "with_scores":
                results = await self.retrieval_service.similarity_search_with_relevance_scores(
                    query=query, k=search_k, filter_dict=filter_dict, **kwargs
                )
            else:
                raise ValueError(f"Unknown search type: {search_type}")

            if document_ids:
                results = self._filter_documents_by_ids(results, set(document_ids))

            if isinstance(results, list):
                results = results[:k]

            logger.info(
                "Performed document search",
                query_length=len(query),
                search_type=search_type,
                results_count=len(results),
                tenant_id=tenant_id,
                document_filter_count=len(document_ids or []),
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
                query_length=len(query or ""),
                tenant_id=tenant_id,
            )
            raise

    @staticmethod
    def _extract_document_id_candidates(document: Document) -> List[str]:
        metadata = document.metadata or {}
        candidates = [
            metadata.get("file_id"),
            metadata.get("filename"),
            metadata.get("source_file_id"),
            metadata.get("source"),
        ]

        normalized_candidates = []
        for candidate in candidates:
            if isinstance(candidate, str) and candidate:
                normalized_candidates.append(candidate)
        return normalized_candidates

    def _filter_documents_by_ids(
        self,
        results: List[Any],
        allowed_ids: Set[str],
    ) -> List[Any]:
        """Filter retrieval results by document/file IDs."""
        filtered_results: List[Any] = []

        for result in results:
            if isinstance(result, tuple):
                doc, _score = result
                if not isinstance(doc, Document):
                    continue
                candidates = self._extract_document_id_candidates(doc)
                if any(candidate in allowed_ids for candidate in candidates):
                    filtered_results.append(result)
                continue

            if isinstance(result, Document):
                candidates = self._extract_document_id_candidates(result)
                if any(candidate in allowed_ids for candidate in candidates):
                    filtered_results.append(result)

        return filtered_results

    async def retrieve_context(
        self,
        query: str,
        tutor_id: str,
        document_ids: Optional[List[str]] = None,
        top_k: int = 5,
        score_threshold: float = 0.7,
        **kwargs,
    ) -> List[Document]:
        """Compatibility wrapper used by agent tools to retrieve source documents."""
        search_result = await self.search_documents(
            query=query,
            tenant_id=tutor_id,
            k=top_k,
            document_ids=document_ids,
            score_threshold=score_threshold,
            **kwargs,
        )

        results = search_result.get("results", [])

        documents: List[Document] = []
        for result in results:
            if isinstance(result, Document):
                result.metadata.setdefault(
                    "score", result.metadata.get("similarity_score", 0.0)
                )
                documents.append(result)
            elif isinstance(result, tuple) and isinstance(result[0], Document):
                doc, score = result
                doc.metadata["similarity_score"] = score
                doc.metadata["score"] = score
                documents.append(doc)

        return documents[:top_k]

    async def query(
        self,
        query: str,
        tutor_id: str,
        document_ids: Optional[List[str]] = None,
        top_k: int = 5,
        score_threshold: float = 0.7,
        **kwargs,
    ) -> Dict[str, Any]:
        """Compatibility wrapper used by Agentic RAG nodes."""
        documents = await self.retrieve_context(
            query=query,
            tutor_id=tutor_id,
            document_ids=document_ids,
            top_k=top_k,
            score_threshold=score_threshold,
            **kwargs,
        )

        formatted_results = []
        for index, doc in enumerate(documents):
            metadata = doc.metadata or {}
            formatted_results.append(
                {
                    "content": doc.page_content,
                    "source": metadata.get("filename")
                    or metadata.get("source")
                    or "unknown",
                    "file_id": metadata.get("file_id")
                    or metadata.get("filename")
                    or "",
                    "page_number": metadata.get("page") or metadata.get("page_number"),
                    "score": metadata.get("similarity_score", 0.0),
                    "metadata": metadata,
                    "chunk_index": metadata.get("chunk_index", index),
                }
            )

        return {
            "query": query,
            "tenant_id": tutor_id,
            "results": formatted_results,
            "top_k": top_k,
            "collection": self.retrieval_service.collection_name,
        }

    async def delete_document(self, filename: str, tenant_id: str) -> Dict[str, Any]:
        """
        Delete a document from the vector store and database
        """
        try:
            # Delete by filename (legacy) and file_id (current) to maximize compatibility
            success_by_filename = await self.retrieval_service.delete_documents(
                filter_dict={"tenant_id": tenant_id, "filename": filename}
            )
            success_by_file_id = await self.retrieval_service.delete_documents(
                filter_dict={"tenant_id": tenant_id, "file_id": filename}
            )
            success = success_by_filename or success_by_file_id

            if success:
                # Delete file record from database entirely
                await self._delete_file_record(filename, tenant_id)

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

    async def get_collection_stats(
        self, tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get collection statistics"""
        return await self.get_document_stats(tenant_id)

    @property
    def qdrant_client(self):
        """Expose underlying Qdrant client for compatibility."""
        return self.retrieval_service.qdrant_client

    def get_default_backfill_sources(self) -> List[str]:
        """Get default legacy collections for migration into active model collection."""
        return self.retrieval_service.get_default_migration_sources()

    async def backfill_embeddings(
        self,
        source_collections: Optional[List[str]] = None,
        batch_size: int = 100,
        max_documents: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Re-embed and migrate legacy vectors into the active collection."""
        return await self.retrieval_service.backfill_from_collections(
            source_collections=source_collections,
            batch_size=batch_size,
            max_documents=max_documents,
        )

    async def _update_file_status(
        self,
        filename: str,
        tenant_id: str,
        status: EmbeddingStatus,
        metadata: Dict[str, Any],
    ) -> None:
        """Update file status in database"""
        try:
            status_value = (
                status.value if isinstance(status, EmbeddingStatus) else status
            )
            update_payload = {
                "$set": {
                    "embedding_status": status_value,
                    "embedding_metadata": metadata,
                    "updated_at": datetime.now(timezone.utc),
                }
            }

            await self.db.uploaded_files.update_one(
                {"filename": filename, "tenant_id": tenant_id},
                update_payload,
            )
            await self.db.files.update_one(
                {
                    "$or": [
                        {"filename": filename, "tutor_id": tenant_id},
                        {"_id": to_object_id(filename), "tutor_id": tenant_id},
                    ]
                },
                update_payload,
            )
        except Exception as e:
            logger.error(
                "Failed to update file status",
                error=str(e),
                filename=filename,
                tenant_id=tenant_id,
            )

    async def _delete_file_record(self, filename: str, tenant_id: str) -> None:
        """Delete file record from database"""
        try:
            await self.db.uploaded_files.delete_one(
                {"filename": filename, "tenant_id": tenant_id}
            )
            await self.db.files.delete_one(
                {
                    "$or": [
                        {"filename": filename, "tutor_id": tenant_id},
                        {"_id": to_object_id(filename), "tutor_id": tenant_id},
                    ]
                }
            )
            logger.info(
                "Deleted file record",
                filename=filename,
                tenant_id=tenant_id,
            )
        except Exception as e:
            logger.error(
                "Failed to delete file record",
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


async def get_rag_service(
    database: AsyncIOMotorDatabase, collection_name: str = "documents"
) -> RAGService:
    """Get or create default RAG service (async singleton with lock)"""
    global _default_rag_service
    async with _rag_service_lock:
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
