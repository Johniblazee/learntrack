"""
Chunking Service using LangChain
Replaces custom semantic chunker with LangChain's optimized implementations
"""

from typing import List, Dict, Any, Optional, Tuple
import datetime
import structlog

from langchain_text_splitters import (
    RecursiveCharacterTextSplitter,
    MarkdownTextSplitter,
    Language,
)
from langchain_experimental.text_splitter import SemanticChunker
from langchain_core.documents import Document
from langchain_core.documents.transformers import BaseDocumentTransformer

from .embedding_service import EmbeddingService

logger = structlog.get_logger()


class ChunkingService:
    """
    Unified chunking service using LangChain text splitters
    Replaces custom semantic chunker with industry-standard implementations
    """

    def __init__(self, embedding_service: Optional[EmbeddingService] = None):
        self.embedding_service = embedding_service or EmbeddingService()

        # Initialize different chunking strategies
        self.recursive_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
            separators=["\n\n", "\n", " ", ""],
        )

        self.markdown_splitter = MarkdownTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
        )

        self.python_splitter = RecursiveCharacterTextSplitter.from_language(
            language=Language.PYTHON,
            chunk_size=1000,
            chunk_overlap=200,
        )

        # Semantic chunker - uses embeddings for intelligent splitting
        self.semantic_splitter = None  # Lazy initialization

        logger.info("Initialized ChunkingService with LangChain splitters")

    @property
    def semantic_chunker(self) -> SemanticChunker:
        """Lazy initialization of semantic chunker"""
        if self.semantic_splitter is None:
            self.semantic_splitter = SemanticChunker(
                embeddings=self.embedding_service.embeddings,
                breakpoint_threshold_type="percentile",  # Can be "percentile", "standard_deviation", "interquartile"
                breakpoint_threshold_amount=85,  # For percentile
            )
            logger.info("Initialized semantic chunker")
        return self.semantic_splitter

    async def chunk_documents(
        self, documents: List[Document], chunk_type: str = "semantic", **kwargs
    ) -> List[Document]:
        """
        Chunk documents using the specified strategy

        Args:
            documents: List of documents to chunk
            chunk_type: Type of chunking ("semantic", "recursive", "markdown", "python")
            **kwargs: Additional parameters for specific chunkers
        """
        if not documents:
            return []

        try:
            # Select appropriate chunker
            chunker = self._get_chunker(chunk_type, **kwargs)

            # Apply chunking
            if hasattr(chunker, "atransform_documents"):
                # Use async if available
                chunks = await chunker.atransform_documents(documents)
            else:
                # Fall back to sync
                chunks = chunker.transform_documents(documents)

            # Add metadata to chunks
            chunks = self._enrich_chunk_metadata(chunks, documents, chunk_type)

            logger.info(
                "Successfully chunked documents",
                original_docs=len(documents),
                chunks_created=len(chunks),
                chunk_type=chunk_type,
            )

            return chunks

        except Exception as e:
            logger.error(
                "Failed to chunk documents",
                error=str(e),
                chunk_type=chunk_type,
                docs_count=len(documents),
            )
            # Fallback to recursive chunking
            logger.info("Falling back to recursive chunking")
            return await self.chunk_documents(documents, chunk_type="recursive")

    def _get_chunker(self, chunk_type: str, **kwargs) -> BaseDocumentTransformer:
        """Get the appropriate chunker based on type"""
        chunkers = {
            "semantic": self.semantic_chunker,
            "recursive": self.recursive_splitter,
            "markdown": self.markdown_splitter,
            "python": self.python_splitter,
        }

        if chunk_type not in chunkers:
            raise ValueError(
                f"Unknown chunk type: {chunk_type}. Available: {list(chunkers.keys())}"
            )

        chunker = chunkers[chunk_type]

        # Apply custom parameters if provided
        if kwargs:
            # Create new instance with custom params
            if chunk_type == "semantic":
                return SemanticChunker(
                    embeddings=self.embedding_service.embeddings, **kwargs
                )
            elif chunk_type == "recursive":
                return RecursiveCharacterTextSplitter(**kwargs)
            elif chunk_type == "markdown":
                return MarkdownTextSplitter(**kwargs)
            elif chunk_type == "python":
                return RecursiveCharacterTextSplitter.from_language(
                    language=Language.PYTHON, **kwargs
                )

        return chunker

    def _enrich_chunk_metadata(
        self,
        chunks: List[Document],
        original_documents: List[Document],
        chunk_type: str,
    ) -> List[Document]:
        """Enrich chunk metadata with additional information"""
        for i, chunk in enumerate(chunks):
            # Add chunking metadata
            chunk.metadata.update(
                {
                    "chunk_type": chunk_type,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "chunking_strategy": f"langchain_{chunk_type}",
                    "created_at": datetime.datetime.now(
                        datetime.timezone.utc
                    ).isoformat(),
                }
            )

            # Preserve original document metadata
            if original_documents and i < len(original_documents):
                orig_doc = original_documents[i]
                chunk.metadata.update(
                    {
                        "source_document_id": orig_doc.metadata.get("id"),
                        "source_filename": orig_doc.metadata.get("filename"),
                        "source_filetype": orig_doc.metadata.get("filetype"),
                    }
                )

        return chunks

    async def chunk_text(
        self, text: str, chunk_type: str = "semantic", **kwargs
    ) -> List[Document]:
        """Chunk raw text"""
        document = Document(page_content=text, metadata={})
        return await self.chunk_documents([document], chunk_type, **kwargs)

    async def adaptive_chunking(
        self, documents: List[Document], fallback_strategy: str = "recursive"
    ) -> List[Document]:
        """
        Adaptive chunking that tries semantic first, falls back if it fails
        """
        try:
            # Try semantic chunking first
            return await self.chunk_documents(documents, chunk_type="semantic")
        except Exception as e:
            logger.warning(
                "Semantic chunking failed, using fallback",
                error=str(e),
                fallback=fallback_strategy,
            )
            return await self.chunk_documents(documents, chunk_type=fallback_strategy)

    def get_chunk_stats(self, chunks: List[Document]) -> Dict[str, Any]:
        """Get statistics about the chunks"""
        if not chunks:
            return {}

        chunk_sizes = [len(chunk.page_content) for chunk in chunks]

        return {
            "total_chunks": len(chunks),
            "min_chunk_size": min(chunk_sizes),
            "max_chunk_size": max(chunk_sizes),
            "avg_chunk_size": sum(chunk_sizes) / len(chunk_sizes),
            "total_characters": sum(chunk_sizes),
            "chunk_types": list(
                set(chunk.metadata.get("chunk_type", "unknown") for chunk in chunks)
            ),
        }

    async def optimize_chunk_size(
        self, sample_text: str, target_chunks: int = 10, max_iterations: int = 5
    ) -> int:
        """
        Find optimal chunk size for a given document to achieve target number of chunks
        """
        sample_doc = Document(page_content=sample_text)

        # Binary search for optimal chunk size
        low, high = 100, 5000
        best_size = 1000

        while low <= high:
            mid = (low + high) // 2
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=mid,
                chunk_overlap=mid // 5,  # 20% overlap
            )
            test_chunks = splitter.transform_documents([sample_doc])

            if len(test_chunks) <= target_chunks:
                best_size = mid
                high = mid - 1
            else:
                low = mid + 1

        # Test the found size
        test_splitter = RecursiveCharacterTextSplitter(
            chunk_size=best_size,
            chunk_overlap=best_size // 5,
        )
        final_chunks = test_splitter.transform_documents([sample_doc])

        if abs(len(final_chunks) - target_chunks) <= 2:  # Within tolerance
            logger.info(
                "Found optimal chunk size",
                optimal_size=best_size,
                chunks_created=len(final_chunks),
                target=target_chunks,
            )
            return best_size

        # Fallback to default
        logger.warning("Could not find optimal chunk size, using default")
        return 1000


# Global instance for convenience
_default_chunking_service = None


def get_chunking_service(
    embedding_service: Optional[EmbeddingService] = None,
) -> ChunkingService:
    """Get or create default chunking service"""
    global _default_chunking_service
    if _default_chunking_service is None:
        _default_chunking_service = ChunkingService(embedding_service)
    return _default_chunking_service


def create_chunking_service(
    embedding_service: Optional[EmbeddingService] = None,
) -> ChunkingService:
    """Create a new chunking service instance"""
    return ChunkingService(embedding_service)
