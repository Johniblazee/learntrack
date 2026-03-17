"""
Retrieval Service using LangChain Qdrant.
Optimized document retrieval with model-aware collections.
"""

import asyncio
import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple

import structlog
from langchain_community.vectorstores.qdrant import Qdrant
from langchain_core.documents import Document
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    VectorParams,
)

from app.core.config import settings
from .embedding_service import EmbeddingService

logger = structlog.get_logger()


def _slugify_model_name(model_name: str) -> str:
    """Normalize model names for safe collection suffixes."""
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", model_name).strip("_").lower()
    return normalized or "default"


def build_model_aware_collection_name(
    base_collection_name: str, model_name: str
) -> str:
    """Build a model-aware collection name while preserving explicit overrides."""
    model_suffix = _slugify_model_name(model_name)
    expected_suffix = f"__{model_suffix}"
    if base_collection_name.endswith(expected_suffix):
        return base_collection_name
    return f"{base_collection_name}{expected_suffix}"


class RetrievalService:
    """
    Retrieval service using LangChain Qdrant.
    Handles document search, retrieval, and collection migration.
    """

    def __init__(
        self,
        embedding_service: Optional[EmbeddingService] = None,
        collection_name: str = "documents",
        qdrant_url: Optional[str] = None,
        qdrant_api_key: Optional[str] = None,
    ):
        self.embedding_service = embedding_service or EmbeddingService()
        self.base_collection_name = collection_name
        self.collection_name = build_model_aware_collection_name(
            collection_name, self.embedding_service.model_name
        )

        # Get Qdrant configuration from .env
        self.qdrant_url = qdrant_url or settings.QDRANT_URL
        self.qdrant_api_key = qdrant_api_key or getattr(
            settings, "QDRANT_API_KEY", None
        )

        # Initialize Qdrant client
        self._qdrant_client: Optional[QdrantClient] = None
        self._vectorstore: Optional[Qdrant] = None
        self._qdrant_client_lock = asyncio.Lock()
        self._vectorstore_lock = asyncio.Lock()

        logger.info(
            "Initialized RetrievalService",
            base_collection_name=self.base_collection_name,
            collection_name=self.collection_name,
            model_name=self.embedding_service.model_name,
            qdrant_url=self.qdrant_url,
        )

    def _create_qdrant_client(self) -> QdrantClient:
        if self.qdrant_api_key:
            return QdrantClient(url=self.qdrant_url, api_key=self.qdrant_api_key, timeout=10)
        return QdrantClient(url=self.qdrant_url, timeout=10)

    @property
    def qdrant_client(self) -> QdrantClient:
        """Sync Qdrant client accessor for backwards compatibility."""
        if self._qdrant_client is None:
            self._qdrant_client = self._create_qdrant_client()
            logger.info("Connected to Qdrant (sync)", url=self.qdrant_url)
        return self._qdrant_client

    async def get_qdrant_client(self) -> QdrantClient:
        """Lazy initialization of Qdrant client (async thread-safe)."""
        if self._qdrant_client is None:
            async with self._qdrant_client_lock:
                if self._qdrant_client is None:
                    self._qdrant_client = self._create_qdrant_client()
                    logger.info("Connected to Qdrant", url=self.qdrant_url)
        return self._qdrant_client

    @property
    def vectorstore(self) -> Qdrant:
        """
        Lazy initialization of LangChain Qdrant vectorstore (sync).
        Kept for backwards compatibility.
        """
        if self._vectorstore is None:
            self._vectorstore = Qdrant(
                client=self.qdrant_client,
                collection_name=self.collection_name,
                embeddings=self.embedding_service.embeddings,
            )
            self._ensure_collection_exists()
        return self._vectorstore

    async def get_vectorstore(self) -> Qdrant:
        """Async initialization of LangChain Qdrant vectorstore (async thread-safe)."""
        if self._vectorstore is None:
            async with self._vectorstore_lock:
                if self._vectorstore is None:
                    client = await self.get_qdrant_client()
                    self._vectorstore = Qdrant(
                        client=client,
                        collection_name=self.collection_name,
                        embeddings=self.embedding_service.embeddings,
                    )
                    await self._ensure_collection_exists_async()
        return self._vectorstore

    @staticmethod
    def _extract_vector_size(collection_info: Any) -> Optional[int]:
        """Extract vector size from Qdrant collection info."""
        try:
            vectors_config = collection_info.config.params.vectors
        except Exception:
            return None

        if hasattr(vectors_config, "size"):
            return getattr(vectors_config, "size", None)

        if isinstance(vectors_config, dict) and vectors_config:
            first_vector = next(iter(vectors_config.values()))
            return getattr(first_vector, "size", None)

        return None

    def _validate_collection_dimensions_sync(self, client: QdrantClient) -> None:
        """Ensure existing collection vector size matches active embedding model."""
        expected_dimensions = self.embedding_service.model_config.dimensions
        collection_info = client.get_collection(self.collection_name)
        actual_dimensions = self._extract_vector_size(collection_info)

        if actual_dimensions is None:
            logger.warning(
                "Could not determine collection vector size",
                collection_name=self.collection_name,
                expected_dimensions=expected_dimensions,
            )
            return

        if actual_dimensions != expected_dimensions:
            raise ValueError(
                "Collection/model dimension mismatch: "
                f"collection={self.collection_name} has {actual_dimensions} dims, "
                f"model={self.embedding_service.model_name} expects {expected_dimensions} dims"
            )

    async def _validate_collection_dimensions_async(self, client: QdrantClient) -> None:
        """Async wrapper for validating collection dimensions."""
        await asyncio.to_thread(self._validate_collection_dimensions_sync, client)

    def _ensure_collection_exists(self) -> None:
        """Ensure the collection exists with proper configuration (sync version)."""
        try:
            client = self.qdrant_client
            collections = client.get_collections()
            collection_names = [
                collection.name for collection in collections.collections
            ]

            if self.collection_name not in collection_names:
                client.create_collection(
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
            else:
                self._validate_collection_dimensions_sync(client)
        except Exception as e:
            logger.error("Failed to ensure collection exists", error=str(e))
            raise

    async def _ensure_collection_exists_async(self) -> None:
        """Ensure the collection exists with proper configuration (async version)."""
        try:
            client = await self.get_qdrant_client()
            collections = await asyncio.to_thread(client.get_collections)
            collection_names = [
                collection.name for collection in collections.collections
            ]

            if self.collection_name not in collection_names:
                await asyncio.to_thread(
                    client.create_collection,
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.embedding_service.model_config.dimensions,
                        distance=Distance.COSINE,
                    ),
                )
                logger.info(
                    "Created Qdrant collection (async)",
                    collection=self.collection_name,
                    dimensions=self.embedding_service.model_config.dimensions,
                )
            else:
                await self._validate_collection_dimensions_async(client)
        except Exception as e:
            logger.error("Failed to ensure collection exists", error=str(e))
            raise

    async def add_documents(
        self, documents: List[Document], batch_size: int = 100, **kwargs
    ) -> List[str]:
        """Add documents to the vector store."""
        if not documents:
            return []

        try:
            vectorstore = await self.get_vectorstore()

            all_ids = []
            for i in range(0, len(documents), batch_size):
                batch = documents[i : i + batch_size]

                for doc in batch:
                    if "id" not in doc.metadata:
                        digest = hashlib.sha256(
                            doc.page_content.encode("utf-8")
                        ).hexdigest()
                        doc.metadata["id"] = f"doc_{digest[:32]}"

                batch_kwargs = dict(kwargs)
                if "ids" not in batch_kwargs:
                    batch_kwargs["ids"] = [str(doc.metadata["id"]) for doc in batch]

                ids = await vectorstore.aadd_documents(batch, **batch_kwargs)
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
        """Perform similarity search with optional filtering."""
        try:
            qdrant_filter = self._build_filter(filter_dict) if filter_dict else None
            vectorstore = await self.get_vectorstore()

            results = await vectorstore.asimilarity_search_with_score(
                query=query, k=k, filter=qdrant_filter, **kwargs
            )

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
                query=query[:100],
            )
            raise

    async def similarity_search_with_relevance_scores(
        self,
        query: str,
        k: int = 5,
        filter_dict: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> List[Tuple[Document, float]]:
        """Perform similarity search and return documents with relevance scores."""
        try:
            qdrant_filter = self._build_filter(filter_dict) if filter_dict else None
            vectorstore = await self.get_vectorstore()

            results = await vectorstore.asimilarity_search_with_score(
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
        """Perform Maximal Marginal Relevance search for diverse results."""
        try:
            qdrant_filter = self._build_filter(filter_dict) if filter_dict else None
            vectorstore = await self.get_vectorstore()

            results = await vectorstore.amax_marginal_relevance_search(
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

    def _build_filter(self, filter_dict: Optional[Dict[str, Any]]) -> Optional[Filter]:
        """Build Qdrant filter from dictionary."""
        if not filter_dict:
            return None

        conditions = []
        for key, value in filter_dict.items():
            if isinstance(value, (str, int, bool)):
                conditions.append(
                    FieldCondition(
                        key=f"metadata.{key}",
                        match=MatchValue(value=value),
                    )
                )
            elif isinstance(value, dict):
                for sub_key, sub_value in value.items():
                    if not isinstance(sub_value, (str, int, bool)):
                        continue
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
        """Delete documents by IDs or filter."""
        try:
            vectorstore = await self.get_vectorstore()

            if document_ids:
                await vectorstore.adelete(ids=document_ids, **kwargs)
                logger.info("Deleted documents by IDs", count=len(document_ids))
            elif filter_dict:
                qdrant_filter = self._build_filter(filter_dict)
                await vectorstore.adelete(filter=qdrant_filter, **kwargs)
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
        """Update documents in the vector store."""
        try:
            doc_ids = [
                str(doc.metadata.get("id"))
                for doc in documents
                if doc.metadata.get("id") is not None
            ]
            if doc_ids:
                delete_success = await self.delete_documents(document_ids=doc_ids)
                if not delete_success:
                    logger.error("Failed to delete existing documents, aborting update")
                    raise RuntimeError(
                        "Failed to delete existing documents before update"
                    )

            return await self.add_documents(documents, **kwargs)

        except Exception as e:
            logger.error(
                "Failed to update documents",
                error=str(e),
                documents_count=len(documents),
            )
            raise

    async def get_collection_stats(self) -> Dict[str, Any]:
        """Get statistics about the active collection."""
        try:
            client = await self.get_qdrant_client()
            collection_info = await asyncio.to_thread(
                client.get_collection, self.collection_name
            )

            return {
                "collection_name": self.collection_name,
                "base_collection_name": self.base_collection_name,
                "embedding_model": self.embedding_service.model_name,
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
        """Search documents by metadata only (no vector similarity)."""
        try:
            client = await self.get_qdrant_client()
            qdrant_filter = self._build_filter(filter_dict)

            points, _ = await asyncio.to_thread(
                lambda: client.scroll(
                    collection_name=self.collection_name,
                    scroll_filter=qdrant_filter,
                    limit=limit,
                    with_payload=True,
                    with_vectors=False,
                    **kwargs,
                )
            )

            documents = []
            for point in points:
                if point.payload and "text" in point.payload:
                    metadata = point.payload.get("metadata", {})
                    if not isinstance(metadata, dict):
                        metadata = {}

                    doc = Document(
                        page_content=point.payload["text"], metadata=metadata
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

    async def list_existing_collections(self) -> List[str]:
        """List all available Qdrant collection names."""
        client = await self.get_qdrant_client()
        collections = await asyncio.to_thread(client.get_collections)
        return [collection.name for collection in collections.collections]

    def get_default_migration_sources(self) -> List[str]:
        """Default source collections to backfill from during model migration."""
        candidates = [
            self.base_collection_name,
            build_model_aware_collection_name(self.base_collection_name, "e5-base-v2"),
            build_model_aware_collection_name(
                self.base_collection_name, "all-MiniLM-L6-v2"
            ),
            build_model_aware_collection_name(
                self.base_collection_name, "all-mpnet-base-v2"
            ),
        ]

        deduped: List[str] = []
        for collection in candidates:
            if collection != self.collection_name and collection not in deduped:
                deduped.append(collection)
        return deduped

    async def backfill_from_collections(
        self,
        source_collections: Optional[List[str]] = None,
        batch_size: int = 100,
        max_documents: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Re-embed and migrate documents from legacy collections into the active collection.

        This keeps legacy collections untouched and writes all migrated content
        into the active model-aware collection.
        """
        try:
            await self._ensure_collection_exists_async()
            client = await self.get_qdrant_client()

            requested_sources = (
                source_collections or self.get_default_migration_sources()
            )
            existing_collections = set(await self.list_existing_collections())
            sources = [
                collection
                for collection in requested_sources
                if collection in existing_collections
                and collection != self.collection_name
            ]

            if not sources:
                return {
                    "target_collection": self.collection_name,
                    "embedding_model": self.embedding_service.model_name,
                    "source_collections": [],
                    "migrated_documents": 0,
                    "scanned_points": 0,
                    "skipped_points": 0,
                }

            total_migrated = 0
            total_scanned = 0
            total_skipped = 0
            source_stats: Dict[str, Dict[str, int]] = {}

            for source_collection in sources:
                offset = None
                source_stats[source_collection] = {
                    "scanned": 0,
                    "migrated": 0,
                    "skipped": 0,
                }

                while True:
                    points, next_offset = await asyncio.to_thread(
                        lambda: client.scroll(
                            collection_name=source_collection,
                            offset=offset,
                            limit=batch_size,
                            with_payload=True,
                            with_vectors=False,
                        )
                    )

                    if not points:
                        break

                    total_scanned += len(points)
                    source_stats[source_collection]["scanned"] += len(points)

                    documents: List[Document] = []
                    for point in points:
                        payload = point.payload or {}
                        text = payload.get("text")
                        if not isinstance(text, str) or not text.strip():
                            total_skipped += 1
                            source_stats[source_collection]["skipped"] += 1
                            continue

                        metadata = payload.get("metadata", {})
                        if not isinstance(metadata, dict):
                            metadata = {}
                        else:
                            metadata = dict(metadata)

                        metadata.setdefault("id", str(point.id))
                        metadata.setdefault(
                            "migrated_from_collection", source_collection
                        )
                        metadata.setdefault("migrated_from_point_id", str(point.id))

                        documents.append(Document(page_content=text, metadata=metadata))

                    if max_documents is not None:
                        remaining = max_documents - total_migrated
                        if remaining <= 0:
                            break
                        documents = documents[:remaining]

                    if documents:
                        await self.add_documents(documents, batch_size=batch_size)
                        migrated_count = len(documents)
                        total_migrated += migrated_count
                        source_stats[source_collection]["migrated"] += migrated_count

                    if max_documents is not None and total_migrated >= max_documents:
                        break

                    if next_offset is None:
                        break

                    offset = next_offset

                if max_documents is not None and total_migrated >= max_documents:
                    break

            logger.info(
                "Completed backfill to active collection",
                target_collection=self.collection_name,
                source_collections=sources,
                migrated_documents=total_migrated,
                scanned_points=total_scanned,
                skipped_points=total_skipped,
            )

            return {
                "target_collection": self.collection_name,
                "embedding_model": self.embedding_service.model_name,
                "source_collections": sources,
                "migrated_documents": total_migrated,
                "scanned_points": total_scanned,
                "skipped_points": total_skipped,
                "source_stats": source_stats,
            }

        except Exception as e:
            logger.error("Failed to backfill collections", error=str(e))
            raise


# Global instance for convenience
_default_retrieval_service = None


def get_retrieval_service(
    embedding_service: Optional[EmbeddingService] = None,
    collection_name: str = "documents",
) -> RetrievalService:
    """Get or create default retrieval service."""
    global _default_retrieval_service
    if _default_retrieval_service is None:
        _default_retrieval_service = RetrievalService(
            embedding_service=embedding_service,
            collection_name=collection_name,
        )
    else:
        if _default_retrieval_service.base_collection_name != collection_name or (
            embedding_service is not None
            and _default_retrieval_service.embedding_service.model_name
            != embedding_service.model_name
        ):
            _default_retrieval_service = RetrievalService(
                embedding_service=embedding_service,
                collection_name=collection_name,
            )
    return _default_retrieval_service


def create_retrieval_service(
    embedding_service: Optional[EmbeddingService] = None,
    collection_name: str = "documents",
) -> RetrievalService:
    """Create a new retrieval service instance."""
    return RetrievalService(
        embedding_service=embedding_service,
        collection_name=collection_name,
    )
