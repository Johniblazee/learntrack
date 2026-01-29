"""
RAG (Retrieval-Augmented Generation) Service
Handles document processing, embedding, and retrieval using Qdrant

Uses LangChain's Docling and Unstructured integrations for multi-format document processing.
"""

import asyncio
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import structlog
import httpx

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.models.file import UploadedFile, EmbeddingStatus
from app.services.document_processors import (
    DocumentProcessorFactory,
    ProcessedDocument,
    ProcessorType,
)
from app.services.semantic_chunker import SemanticChunker, create_semantic_chunker
from app.services.cost_tracking_service import CostTrackingService
from app.services.cost_tracking_service import MODEL_COSTS
from decimal import Decimal

logger = structlog.get_logger()

EMBEDDING_MODELS: Dict[str, Dict[str, int]] = {
    "openai": {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
    },
    "gemini": {
        "text-embedding-004": 768,
    },
}

DEFAULT_EMBEDDING_PROVIDER = "openai"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


class RAGService:
    """RAG service for document processing and retrieval using LangChain integrations"""

    def __init__(
        self,
        db: AsyncIOMotorDatabase,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
        enable_semantic_chunking: bool = True,
    ):
        self.db = db
        self.qdrant_client = None
        self.embedding_dimension = EMBEDDING_MODELS[DEFAULT_EMBEDDING_PROVIDER][
            DEFAULT_EMBEDDING_MODEL
        ]
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.enable_semantic_chunking = enable_semantic_chunking
        self._initialize_qdrant()

        # Initialize document processor factory (Docling + Unstructured)
        self.document_processor = DocumentProcessorFactory(
            chunk_size=chunk_size, chunk_overlap=chunk_overlap
        )

        # Initialize semantic chunker
        self.semantic_chunker = None  # Will be initialized when needed

        # Initialize cost tracking service
        self.cost_service = CostTrackingService(db)

        # Keep text splitter for fallback/legacy support
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

        # Keep text splitter for fallback/legacy support
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

    def _initialize_qdrant(self):
        """Initialize Qdrant client"""
        try:
            qdrant_url = getattr(settings, "QDRANT_URL", None)
            qdrant_api_key = getattr(settings, "QDRANT_API_KEY", None)
            if qdrant_url:
                self.qdrant_client = QdrantClient(
                    url=qdrant_url, api_key=qdrant_api_key
                )
            else:
                self.qdrant_client = QdrantClient(":memory:")
                logger.info("Using in-memory Qdrant client for development")
        except Exception as e:
            logger.error(f"Failed to initialize Qdrant client: {e}")
            self.qdrant_client = None

    def _format_collection_name(self, tutor_id: str, provider: str, model: str) -> str:
        safe_provider = provider.replace("-", "_")
        safe_model = model.replace("/", "_").replace("-", "_").replace(".", "_")
        return f"tutor_{tutor_id.replace('-', '_')}_{safe_provider}_{safe_model}"

    async def _get_embedding_config(self, tutor_id: str) -> Dict[str, Any]:
        provider = DEFAULT_EMBEDDING_PROVIDER
        model = DEFAULT_EMBEDDING_MODEL
        if self.db:
            try:
                from app.services.tenant_ai_config_service import TenantAIConfigService

                service = TenantAIConfigService(self.db)
                config = await service.get_or_create_default(tutor_id)
                if config:
                    provider = config.embedding_provider or provider
                    model = config.embedding_model or model
            except Exception as e:
                logger.warning(
                    "Failed to load embedding config, using defaults", error=str(e)
                )
        dimension = EMBEDDING_MODELS.get(provider, {}).get(
            model, self.embedding_dimension
        )
        return {"provider": provider, "model": model, "dimension": dimension}

    def _infer_embedding_provider(self, model: str) -> str:
        for provider_id, models in EMBEDDING_MODELS.items():
            if model in models:
                return provider_id
        return DEFAULT_EMBEDDING_PROVIDER

    async def _resolve_collection_name(
        self, tutor_id: str, document_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if self.db and document_ids:
            try:
                doc = await self.db.files.find_one(
                    {"_id": {"$in": document_ids}},
                    {"qdrant_collection_id": 1, "embedding_model_used": 1},
                )
                if doc and doc.get("qdrant_collection_id"):
                    model = doc.get("embedding_model_used") or DEFAULT_EMBEDDING_MODEL
                    provider = self._infer_embedding_provider(model)
                    dimension = EMBEDDING_MODELS.get(provider, {}).get(
                        model, self.embedding_dimension
                    )
                    return {
                        "collection": doc["qdrant_collection_id"],
                        "provider": provider,
                        "model": model,
                        "dimension": dimension,
                    }
            except Exception as e:
                logger.warning(
                    "Failed to resolve collection from documents", error=str(e)
                )

        config = await self._get_embedding_config(tutor_id)
        return {
            "collection": self._format_collection_name(
                tutor_id, config["provider"], config["model"]
            ),
            "provider": config["provider"],
            "model": config["model"],
            "dimension": config["dimension"],
        }

    async def create_tutor_collection(
        self, tutor_id: str, provider: str, model: str, dimension: int
    ) -> str:
        """Create isolated Qdrant collection for tutor and embedding model"""
        collection_name = self._format_collection_name(tutor_id, provider, model)
        if not self.qdrant_client:
            logger.error("Qdrant client not initialized")
            return collection_name
        try:
            collections = self.qdrant_client.get_collections()
            existing_names = [c.name for c in collections.collections]
            if collection_name not in existing_names:
                self.qdrant_client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(
                        size=dimension, distance=Distance.COSINE
                    ),
                )
                logger.info(f"Created Qdrant collection: {collection_name}")
            return collection_name
        except Exception as e:
            logger.error(f"Failed to create collection for tutor {tutor_id}: {e}")
            raise

    async def get_embeddings(
        self,
        texts: List[str],
        provider: str = DEFAULT_EMBEDDING_PROVIDER,
        model: str = DEFAULT_EMBEDDING_MODEL,
    ) -> List[List[float]]:
        """Get embeddings using the configured provider/model."""
        try:
            provider = provider or DEFAULT_EMBEDDING_PROVIDER
            model = model or DEFAULT_EMBEDDING_MODEL
            if provider == "openai":
                import openai

                client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
                response = await client.embeddings.create(model=model, input=texts)
                return [item.embedding for item in response.data]
            if provider == "gemini":
                return await self._get_gemini_embeddings(texts, model)
            raise ValueError(f"Unsupported embedding provider: {provider}")
        except Exception as e:
            logger.error(
                "Failed to get embeddings", error=str(e), provider=provider, model=model
            )
            raise

    async def _get_gemini_embeddings(
        self, texts: List[str], model: str
    ) -> List[List[float]]:
        """Get embeddings using Gemini embedContent API."""
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not configured")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
        payload = {
            "requests": [{"content": {"parts": [{"text": text}]}} for text in texts]
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url, params={"key": settings.GEMINI_API_KEY}, json=payload
            )
            response.raise_for_status()
            data = response.json()

        embeddings = []
        for item in data.get("embeddings", []):
            embeddings.append(item.get("values", []))
        return embeddings

    async def process_document(
        self,
        file_path: str,
        file_id: str,
        tutor_id: str,
        file_url: str = None,
        force_processor: Optional[ProcessorType] = None,
        use_semantic_chunking: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Process document and store in vector database.

        Uses semantic chunking for better content understanding and cost tracking
        for embedding operations.

        Args:
            file_path: Path to the document file
            file_id: Unique file identifier
            tutor_id: Tutor ID for collection isolation
            file_url: Optional URL to fetch document from
            force_processor: Force use of a specific processor type
            use_semantic_chunking: Override semantic chunking setting

        Returns:
            Dict with processing results including chunk count and metadata
        """
        start_time = datetime.now(timezone.utc)
        embedding_config = await self._get_embedding_config(tutor_id)

        try:
            if self.db:
                await self._update_file_embedding_status(
                    file_id, EmbeddingStatus.PROCESSING
                )

            # Use new document processor factory (Docling/Unstructured)
            processed_doc = await self._load_document_with_processor(
                file_path, file_url, force_processor
            )

            if not processed_doc:
                raise ValueError("Failed to load document content")

            # Use semantic chunking if enabled
            should_use_semantic = (
                use_semantic_chunking
                if use_semantic_chunking is not None
                else self.enable_semantic_chunking
            )

            if should_use_semantic:
                # Initialize semantic chunker if needed
                if not self.semantic_chunker:
                    self.semantic_chunker = await create_semantic_chunker(
                        chunk_size=self.chunk_size, enable_semantic=True
                    )

                # Apply semantic chunking
                semantic_chunks = await self.semantic_chunker.chunk_document(
                    processed_doc, preserve_structure=True
                )

                # Convert semantic chunks back to DocumentChunk format for compatibility
                processed_doc.chunks = self._semantic_to_document_chunks(
                    semantic_chunks
                )
                chunk_texts = [chunk.content for chunk in semantic_chunks]

                logger.info(
                    f"Applied semantic chunking with {processed_doc.processor_used.value}",
                    original_chunks=len(processed_doc.chunks),
                    semantic_chunks=len(semantic_chunks),
                    characters=processed_doc.character_count,
                    tokens=sum(chunk.token_estimate for chunk in semantic_chunks),
                )
            else:
                # Use traditional chunking
                chunk_texts = [chunk.content for chunk in processed_doc.chunks]
                logger.info(
                    f"Processed document with {processed_doc.processor_used.value}",
                    chunks=len(chunk_texts),
                    characters=processed_doc.character_count,
                    tokens=processed_doc.token_estimate,
                )

            # Track embedding cost before generating embeddings
            estimated_tokens = len(chunk_texts) * (
                self.chunk_size // 4
            )  # Rough estimate

            # Check quota for embeddings
            from app.models.cost_tracking import CostProvider, CostModel

            estimated_cost = await self._estimate_embedding_cost(
                embedding_config["provider"],
                embedding_config["model"],
                estimated_tokens,
            )

            allowed, reason = await self.cost_service.check_quota(
                tutor_id, estimated_cost
            )
            if not allowed:
                raise ValueError(f"Embedding quota exceeded: {reason}")

            # Generate embeddings
            embeddings = await self.get_embeddings(
                chunk_texts,
                provider=embedding_config["provider"],
                model=embedding_config["model"],
            )

            # Track actual token usage and cost
            actual_tokens = sum(
                len(text.split()) * 1.3 for text in chunk_texts
            )  # Rough token count
            await self.cost_service.track_usage(
                tenant_id=tutor_id,
                provider=embedding_config["provider"],
                model=CostModel(embedding_config["model"]),
                input_tokens=int(actual_tokens),
                output_tokens=0,
                operation="document_embedding",
                metadata={
                    "file_id": file_id,
                    "chunks": len(chunk_texts),
                    "semantic_chunking": should_use_semantic,
                    "processing_time": (
                        datetime.now(timezone.utc) - start_time
                    ).total_seconds(),
                },
            )

            collection_name = await self.create_tutor_collection(
                tutor_id,
                embedding_config["provider"],
                embedding_config["model"],
                embedding_config["dimension"],
            )

            # Store embeddings with rich metadata
            await self._store_embeddings_with_metadata(
                collection_name, file_id, processed_doc.chunks, embeddings, tutor_id
            )

            if self.db:
                await self._update_file_after_embedding(
                    file_id,
                    len(chunk_texts),
                    collection_name,
                    processed_doc,
                    embedding_config["model"],
                )

            return {
                "file_id": file_id,
                "chunks": len(chunk_texts),
                "collection": collection_name,
                "status": "completed",
                "processor_used": processed_doc.processor_used.value,
                "semantic_chunking": should_use_semantic,
                "character_count": processed_doc.character_count,
                "token_estimate": processed_doc.token_estimate,
                "content_hash": processed_doc.content_hash,
                "page_count": processed_doc.page_count,
                "processing_time": processed_doc.processing_time,
                "embedding_cost_tracked": True,
            }
        except Exception as e:
            logger.error(f"Document processing failed: {e}")
            if self.db:
                await self._update_file_embedding_status(
                    file_id, EmbeddingStatus.FAILED, str(e)
                )
            raise

    async def _load_document_with_processor(
        self,
        file_path: str,
        file_url: Optional[str] = None,
        force_processor: Optional[ProcessorType] = None,
    ) -> ProcessedDocument:
        """
        Load and process document using Docling/Unstructured processors.

        Args:
            file_path: Path to the document
            file_url: Optional URL to fetch from
            force_processor: Force specific processor type

        Returns:
            ProcessedDocument with chunks and metadata
        """
        try:
            return await self.document_processor.process_document(
                file_path=file_path,
                file_url=file_url,
                force_processor=force_processor,
                fallback_on_error=True,
            )
        except Exception as e:
            logger.error(f"Document processor failed: {e}")
            raise

    async def _load_document(self, file_path: str, file_url: str = None) -> str:
        """
        Legacy method: Load document content from file or URL.
        Kept for backward compatibility - prefer _load_document_with_processor.
        """
        try:
            # Use new processor and extract raw text
            processed = await self._load_document_with_processor(file_path, file_url)
            return processed.raw_text
        except Exception as e:
            logger.error(f"Failed to load document: {e}")
            return None

    async def _store_embeddings(
        self,
        collection_name: str,
        file_id: str,
        chunks: List[str],
        embeddings: List[List[float]],
        tutor_id: str,
    ):
        """Store embeddings in Qdrant (legacy method for string chunks)"""
        if not self.qdrant_client:
            logger.warning("Qdrant client not available, skipping storage")
            return
        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            point_id = str(uuid.uuid4())
            points.append(
                PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "file_id": file_id,
                        "tutor_id": tutor_id,
                        "chunk_index": i,
                        "content": chunk,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            )
        self.qdrant_client.upsert(collection_name=collection_name, points=points)
        logger.info(f"Stored {len(points)} embeddings in {collection_name}")

    async def _store_embeddings_with_metadata(
        self,
        collection_name: str,
        file_id: str,
        chunks: List,
        embeddings: List[List[float]],
        tutor_id: str,
    ):
        """
        Store embeddings in Qdrant with rich metadata from document processors.

        Includes page numbers, headings, sections from Docling/Unstructured.
        """
        from app.services.document_processors.base import DocumentChunk

        if not self.qdrant_client:
            logger.warning("Qdrant client not available, skipping storage")
            return

        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            point_id = str(uuid.uuid4())

            # Handle both DocumentChunk objects and plain strings
            if isinstance(chunk, DocumentChunk):
                payload = {
                    "file_id": file_id,
                    "tutor_id": tutor_id,
                    "chunk_index": chunk.chunk_index,
                    "content": chunk.content,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    # Rich metadata from Docling/Unstructured
                    "page_number": chunk.page_number,
                    "heading": chunk.heading,
                    "section": chunk.section,
                    "token_estimate": chunk.token_estimate,
                }
                # Add bounding box if available (for PDF highlighting)
                if chunk.bounding_box:
                    payload["bounding_box"] = chunk.bounding_box
            else:
                # Fallback for plain string chunks
                payload = {
                    "file_id": file_id,
                    "tutor_id": tutor_id,
                    "chunk_index": i,
                    "content": chunk,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }

            points.append(PointStruct(id=point_id, vector=embedding, payload=payload))

        self.qdrant_client.upsert(collection_name=collection_name, points=points)
        logger.info(
            f"Stored {len(points)} embeddings with metadata in {collection_name}"
        )

    async def _update_file_embedding_status(
        self, file_id: str, status: EmbeddingStatus, error: str = None
    ):
        """Update file embedding status in database"""
        update_data = {
            "embedding_status": status.value,
            "updated_at": datetime.now(timezone.utc),
        }
        if error:
            update_data["embedding_error"] = error
        await self.db.files.update_one({"_id": file_id}, {"$set": update_data})

    async def _update_file_after_embedding(
        self,
        file_id: str,
        chunk_count: int,
        collection_name: str,
        processed_doc: Optional[ProcessedDocument] = None,
        embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    ):
        """Update file record after successful embedding with enhanced metadata"""
        update_data = {
            "embedding_status": EmbeddingStatus.COMPLETED.value,
            "chunk_count": chunk_count,
            "qdrant_collection_id": collection_name,
            "last_embedded_at": datetime.now(timezone.utc),
            "embedding_model_used": embedding_model,
        }

        # Add enhanced metadata from document processor
        if processed_doc:
            update_data.update(
                {
                    "character_count": processed_doc.character_count,
                    "token_estimate": processed_doc.token_estimate,
                    "content_hash": processed_doc.content_hash,
                    "page_count": processed_doc.page_count,
                    "processor_used": processed_doc.processor_used.value,
                    "processing_time": processed_doc.processing_time,
                }
            )

        await self.db.files.update_one({"_id": file_id}, {"$set": update_data})

    async def query(
        self,
        query: str,
        tutor_id: str,
        document_ids: Optional[List[str]] = None,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Query the vector store and return results with metadata."""
        documents = await self.retrieve_context(
            query, tutor_id, document_ids, top_k=top_k
        )

        file_name_map: Dict[str, str] = {}
        if self.db and documents:
            file_ids = list(
                {
                    doc.metadata.get("file_id")
                    for doc in documents
                    if doc.metadata.get("file_id")
                }
            )
            if file_ids:
                cursor = self.db.files.find({"_id": {"$in": file_ids}}, {"filename": 1})
                async for doc in cursor:
                    file_name_map[str(doc["_id"])] = doc.get("filename", "")

        results = []
        for doc in documents:
            file_id = doc.metadata.get("file_id")
            results.append(
                {
                    "content": doc.page_content,
                    "file_id": file_id,
                    "source": file_name_map.get(
                        str(file_id), str(file_id) if file_id else "unknown"
                    ),
                    "page_number": doc.metadata.get("page_number"),
                    "score": doc.metadata.get("score", 0.0),
                    "metadata": doc.metadata,
                }
            )

        return {"results": results, "count": len(results)}

    async def retrieve_context(
        self,
        query: str,
        tutor_id: str,
        document_ids: Optional[List[str]] = None,
        top_k: int = 5,
        token_budget: int = settings.MAX_RAG_TOKEN_BUDGET,
    ) -> List[Document]:
        """
        Retrieve relevant context from tutor's documents with token budgeting.

        Returns documents with rich metadata including page numbers, headings,
        and sections from Docling/Unstructured processing.
        Stop adding documents when the token budget is reached.
        """
        if not self.qdrant_client:
            logger.warning("Qdrant client not available")
            return []
        try:
            collection_info = await self._resolve_collection_name(
                tutor_id, document_ids
            )
            collection_name = collection_info["collection"]
            query_embedding = (
                await self.get_embeddings(
                    [query],
                    provider=collection_info["provider"],
                    model=collection_info["model"],
                )
            )[0]

            search_filter = None
            if document_ids:
                search_filter = Filter(
                    should=[
                        FieldCondition(key="file_id", match=MatchValue(value=doc_id))
                        for doc_id in document_ids
                    ]
                )

            # Fetch slightly more than top_k to account for filtering/budgeting
            results = self.qdrant_client.search(
                collection_name=collection_name,
                query_vector=query_embedding,
                limit=top_k,
                query_filter=search_filter,
            )

            documents = []
            current_tokens = 0

            for result in results:
                payload = result.payload

                # Estimate tokens: prefer metadata, fallback to char count / 4
                token_estimate = payload.get("token_estimate")
                if not token_estimate:
                    content_len = len(payload.get("content", ""))
                    token_estimate = int(content_len / 4)

                # Check budget
                if current_tokens + token_estimate > token_budget:
                    logger.info(
                        "RAG token budget reached",
                        current=current_tokens,
                        budget=token_budget,
                    )
                    break

                doc = Document(
                    page_content=payload.get("content", ""),
                    metadata={
                        "file_id": payload.get("file_id"),
                        "chunk_index": payload.get("chunk_index"),
                        "score": result.score,
                        # Rich metadata from Docling/Unstructured
                        "page_number": payload.get("page_number"),
                        "heading": payload.get("heading"),
                        "section": payload.get("section"),
                        "token_estimate": token_estimate,
                        "bounding_box": payload.get("bounding_box"),
                    },
                )
                documents.append(doc)
                current_tokens += token_estimate

            return documents
        except Exception as e:
            logger.error(f"Context retrieval failed: {e}")
            return []

    async def delete_file_embeddings(self, file_id: str, tutor_id: str):
        """Delete embeddings for a specific file"""
        if not self.qdrant_client:
            return
        try:
            collection_info = await self._resolve_collection_name(tutor_id, [file_id])
            collection_name = collection_info["collection"]
            self.qdrant_client.delete(
                collection_name=collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(key="file_id", match=MatchValue(value=file_id))
                    ]
                ),
            )
            logger.info(f"Deleted embeddings for file {file_id}")
        except Exception as e:
            logger.error(f"Failed to delete embeddings: {e}")

    async def delete_tutor_data(self, tutor_id: str):
        """Delete all tutor data from Qdrant"""
        if not self.qdrant_client:
            return
        try:
            prefix = f"tutor_{tutor_id.replace('-', '_')}_"
            collections = self.qdrant_client.get_collections()
            for collection in collections.collections:
                if collection.name.startswith(prefix):
                    self.qdrant_client.delete_collection(collection.name)
                    logger.info(f"Deleted collection {collection.name}")
        except Exception as e:
            logger.error(f"Failed to delete collection for tutor {tutor_id}: {e}")

    async def get_collection_stats(self, tutor_id: str) -> Dict[str, Any]:
        """Get statistics for tutor's collection"""
        if not self.qdrant_client:
            return {"points_count": 0, "segments_count": 0}
        try:
            collection_info = await self._resolve_collection_name(tutor_id)
            collection_name = collection_info["collection"]
            info = self.qdrant_client.get_collection(collection_name)
            return {
                "points_count": info.points_count,
                "segments_count": info.segments_count,
                "status": info.status.value,
            }
        except Exception as e:
            logger.error(f"Failed to get collection stats: {e}")
            return {"points_count": 0, "segments_count": 0}

    def _semantic_to_document_chunks(self, semantic_chunks) -> List:
        """Convert semantic chunks back to DocumentChunk format"""
        from app.services.document_processors.base import DocumentChunk

        document_chunks = []
        for i, semantic_chunk in enumerate(semantic_chunks):
            doc_chunk = DocumentChunk(
                content=semantic_chunk.content,
                chunk_index=i,
                token_estimate=semantic_chunk.token_estimate,
                page_number=semantic_chunk.page_number,
                heading=semantic_chunk.heading,
                section=semantic_chunk.section,
            )
            document_chunks.append(doc_chunk)

        return document_chunks

    async def _estimate_embedding_cost(
        self, provider: str, model: str, estimated_tokens: int
    ) -> Decimal:
        """Estimate cost for embedding operation"""
        from decimal import Decimal

        # Get cost per token for embeddings
        provider_costs = MODEL_COSTS.get(provider, {})
        model_costs = provider_costs.get(model, {})
        input_cost_per_token = model_costs.get("input", Decimal("0"))

        # Convert to cost per token (costs are stored per 1K or 1M tokens)
        if provider in ["openai", "anthropic", "groq"]:
            # Costs are per 1K tokens
            cost_per_token = input_cost_per_token / Decimal("1000")
        elif provider == "gemini":
            # Costs are per 1M tokens
            cost_per_token = input_cost_per_token / Decimal("1000000")
        else:
            cost_per_token = Decimal("0")

        return cost_per_token * Decimal(str(estimated_tokens))

    async def get_embeddings_with_cost_tracking(
        self,
        texts: List[str],
        tenant_id: str,
        provider: str = DEFAULT_EMBEDDING_PROVIDER,
        model: str = DEFAULT_EMBEDDING_MODEL,
        prefer_local: bool = True,
        quality: str = "medium",
    ) -> List[List[float]]:
        """
        Get embeddings with cost tracking and local model support

        Args:
            texts: Texts to embed
            tenant_id: Tenant for cost tracking
            provider: API provider (fallback)
            model: API model (fallback)
            prefer_local: Try local embeddings first
            quality: Embedding quality level

        Returns:
            List of embeddings
        """
        # Use local embeddings if preferred
        if prefer_local:
            try:
                from app.services.local_embedding_service import HybridEmbeddingService

                hybrid_service = HybridEmbeddingService()

                # Get embeddings with quality preference
                embeddings = await hybrid_service.embed_with_quality(
                    texts=texts, quality=quality
                )

                # Track local usage (minimal cost)
                await self.cost_service.track_usage(
                    tenant_id=tenant_id,
                    provider="local",
                    model="local_embedding",
                    input_tokens=sum(len(text.split()) for text in texts),
                    output_tokens=0,
                    operation="embedding",
                    metadata={
                        "text_count": len(texts),
                        "model_type": "local",
                        "quality": quality,
                    },
                )

                logger.info(f"Used local embeddings for {len(texts)} texts")
                return embeddings

            except Exception as e:
                logger.warning(f"Local embedding failed, using API fallback: {e}")

        # Fallback to API-based embeddings
        # Estimate tokens and cost
        estimated_tokens = sum(
            len(text.split()) * 1.3 for text in texts
        )  # Rough estimate
        estimated_cost = await self._estimate_embedding_cost(
            provider, model, estimated_tokens
        )

        # Check quota
        allowed, reason = await self.cost_service.check_quota(tenant_id, estimated_cost)
        if not allowed:
            raise ValueError(f"Embedding quota exceeded: {reason}")

        # Get embeddings
        embeddings = await self.get_embeddings(texts, provider, model)

        # Track actual usage
        actual_tokens = sum(len(text.split()) * 1.3 for text in texts)
        await self.cost_service.track_usage(
            tenant_id=tenant_id,
            provider=provider,
            model=model,
            input_tokens=int(actual_tokens),
            output_tokens=0,
            operation="embedding",
            metadata={
                "text_count": len(texts),
                "model_type": "api",
                "provider": provider,
                "quality": quality,
            },
        )

        return embeddings
