"""
Enhanced Semantic Chunking for RAG
Uses best practices from LangChain and LangGraph for intelligent document chunking
"""

from typing import List, Dict, Any, Optional, Tuple
import re
import numpy as np
from dataclasses import dataclass
from datetime import datetime
import structlog
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.cluster import AgglomerativeClustering

from app.services.document_processors.base import DocumentChunk, ProcessedDocument
from app.core.config import settings

logger = structlog.get_logger()


@dataclass
class SemanticChunk:
    """Enhanced chunk with semantic information"""

    content: str
    chunk_index: int
    semantic_score: float
    topic_coherence: float
    token_estimate: int
    page_number: Optional[int] = None
    heading: Optional[str] = None
    section: Optional[str] = None
    chunk_type: str = "semantic"  # semantic, heading, paragraph, etc.
    similarity_to_neighbors: List[float] = None
    topic_keywords: List[str] = None


class SemanticChunker:
    """
    Advanced semantic chunking using multiple strategies:
    1. Sentence boundary detection
    2. Semantic similarity clustering
    3. Document structure awareness
    4. Topic coherence analysis
    """

    def __init__(
        self,
        min_chunk_size: int = 200,
        max_chunk_size: int = 1000,
        semantic_threshold: float = 0.7,
        embedding_model: str = "all-MiniLM-L6-v2",
        enable_topic_modeling: bool = True,
    ):
        self.min_chunk_size = min_chunk_size
        self.max_chunk_size = max_chunk_size
        self.semantic_threshold = semantic_threshold
        self.enable_topic_modeling = enable_topic_modeling

        # Initialize sentence transformer for semantic analysis
        try:
            self.sentence_model = SentenceTransformer(embedding_model)
            logger.info(f"Loaded semantic embedding model: {embedding_model}")
        except Exception as e:
            logger.warning(f"Failed to load semantic model {embedding_model}: {e}")
            self.sentence_model = None

    async def chunk_document(
        self, processed_doc: ProcessedDocument, preserve_structure: bool = True
    ) -> List[SemanticChunk]:
        """
        Create semantic chunks from processed document

        Args:
            processed_doc: Document processed by Docling/Unstructured
            preserve_structure: Whether to preserve document structure (headings, sections)

        Returns:
            List of semantic chunks with metadata
        """
        logger.info(
            "Starting semantic chunking",
            processor=processed_doc.processor_used.value,
            original_chunks=len(processed_doc.chunks),
        )

        if preserve_structure and processed_doc.chunks:
            # Use structure-aware chunking
            semantic_chunks = await self._structure_aware_chunking(processed_doc)
        else:
            # Use pure semantic chunking
            semantic_chunks = await self._pure_semantic_chunking(processed_doc)

        # Enhance chunks with semantic analysis
        if self.sentence_model:
            semantic_chunks = await self._enhance_chunks_semantics(semantic_chunks)

        logger.info(
            "Completed semantic chunking",
            final_chunks=len(semantic_chunks),
            avg_chunk_size=np.mean([len(c.content) for c in semantic_chunks]),
        )

        return semantic_chunks

    async def _structure_aware_chunking(
        self, processed_doc: ProcessedDocument
    ) -> List[SemanticChunk]:
        """
        Structure-aware chunking that respects document hierarchy
        """
        chunks = []
        current_section = None
        current_heading = None
        section_content = []

        for i, chunk in enumerate(processed_doc.chunks):
            # Track document structure
            if chunk.heading and chunk.heading != current_heading:
                # Save previous section if it exists
                if section_content:
                    semantic_chunk = await self._create_structural_chunk(
                        section_content, current_section, current_heading, chunks
                    )
                    if semantic_chunk:
                        chunks.append(semantic_chunk)

                # Start new section
                current_heading = chunk.heading
                current_section = chunk.section
                section_content = [chunk]
            else:
                section_content.append(chunk)

            # Check if we need to create a chunk based on size
            content_size = sum(len(c.content) for c in section_content)
            if content_size >= self.max_chunk_size:
                semantic_chunk = await self._create_structural_chunk(
                    section_content, current_section, current_heading, chunks
                )
                if semantic_chunk:
                    chunks.append(semantic_chunk)
                section_content = []

        # Handle remaining content
        if section_content:
            semantic_chunk = await self._create_structural_chunk(
                section_content, current_section, current_heading, chunks
            )
            if semantic_chunk:
                chunks.append(semantic_chunk)

        return chunks

    async def _create_structural_chunk(
        self,
        content_chunks: List[DocumentChunk],
        section: Optional[str],
        heading: Optional[str],
        previous_chunks: List[SemanticChunk],
    ) -> Optional[SemanticChunk]:
        """Create a semantic chunk from structural content"""
        if not content_chunks:
            return None

        # Combine content
        combined_content = "\n\n".join([c.content for c in content_chunks])

        # Estimate tokens
        token_estimate = len(combined_content) // 4

        # Determine chunk type
        chunk_type = "heading" if heading else "section" if section else "paragraph"

        # Create semantic chunk
        semantic_chunk = SemanticChunk(
            content=combined_content,
            chunk_index=len(previous_chunks),
            semantic_score=0.0,  # Will be calculated later
            topic_coherence=0.0,  # Will be calculated later
            token_estimate=token_estimate,
            page_number=content_chunks[0].page_number,
            heading=heading,
            section=section,
            chunk_type=chunk_type,
        )

        return semantic_chunk

    async def _pure_semantic_chunking(
        self, processed_doc: ProcessedDocument
    ) -> List[SemanticChunk]:
        """
        Pure semantic chunking based on content similarity
        """
        # Extract sentences from document
        sentences = await self._extract_sentences(processed_doc.raw_text)

        if not sentences:
            return []

        # Get sentence embeddings
        if not self.sentence_model:
            # Fallback to simple size-based chunking
            return await self._fallback_chunking(processed_doc)

        sentence_embeddings = self.sentence_model.encode(sentences)

        # Group sentences by semantic similarity
        semantic_groups = await self._group_by_similarity(
            sentences, sentence_embeddings
        )

        # Create chunks from semantic groups
        chunks = []
        for i, group in enumerate(semantic_groups):
            group_content = " ".join(group)
            if len(group_content) >= self.min_chunk_size:
                semantic_chunk = SemanticChunk(
                    content=group_content,
                    chunk_index=i,
                    semantic_score=0.0,
                    topic_coherence=0.0,
                    token_estimate=len(group_content) // 4,
                    chunk_type="semantic",
                )
                chunks.append(semantic_chunk)

        return chunks

    async def _extract_sentences(self, text: str) -> List[str]:
        """Extract sentences from text with improved boundary detection"""
        # Clean text first
        text = re.sub(r"\s+", " ", text).strip()

        # Enhanced sentence boundary detection
        sentence_patterns = [
            r"(?<=[.!?])\s+(?=[A-Z])",  # Standard sentence endings
            r'(?<=[.!?]["\']])\s+(?=[A-Z])',  # Sentences ending with quotes
            r"(?<=[.!?]\s)\s+(?=[A-Z])",  # Multiple spaces after punctuation
        ]

        sentences = [text]
        for pattern in sentence_patterns:
            new_sentences = []
            for sentence in sentences:
                parts = re.split(pattern, sentence)
                new_sentences.extend([p.strip() for p in parts if p.strip()])
            sentences = new_sentences

        # Filter very short sentences
        sentences = [s for s in sentences if len(s) >= 10]

        return sentences

    async def _group_by_similarity(
        self, sentences: List[str], embeddings: np.ndarray
    ) -> List[List[str]]:
        """
        Group sentences by semantic similarity using clustering
        """
        if len(sentences) <= 1:
            return [sentences]

        # Calculate similarity matrix
        similarity_matrix = cosine_similarity(embeddings)

        # Use agglomerative clustering to group similar sentences
        n_clusters = max(1, len(sentences) // 5)  # Approximate 5 sentences per cluster

        clustering = AgglomerativeClustering(
            n_clusters=n_clusters, metric="precomputed", linkage="average"
        )

        # Convert similarity to distance
        distance_matrix = 1 - similarity_matrix
        cluster_labels = clustering.fit_predict(distance_matrix)

        # Group sentences by cluster
        groups = {}
        for i, label in enumerate(cluster_labels):
            if label not in groups:
                groups[label] = []
            groups[label].append(sentences[i])

        return list(groups.values())

    async def _fallback_chunking(
        self, processed_doc: ProcessedDocument
    ) -> List[SemanticChunk]:
        """
        Fallback chunking using simple size-based approach
        """
        chunks = []
        text = processed_doc.raw_text

        # Simple size-based chunking
        start = 0
        chunk_index = 0

        while start < len(text):
            end = min(start + self.max_chunk_size, len(text))

            # Try to break at sentence boundary
            if end < len(text):
                sentence_boundary = text.rfind(". ", start, end)
                if sentence_boundary > start + self.min_chunk_size:
                    end = sentence_boundary + 1

            chunk_text = text[start:end].strip()
            if len(chunk_text) >= self.min_chunk_size:
                semantic_chunk = SemanticChunk(
                    content=chunk_text,
                    chunk_index=chunk_index,
                    semantic_score=0.0,
                    topic_coherence=0.0,
                    token_estimate=len(chunk_text) // 4,
                    chunk_type="fallback",
                )
                chunks.append(semantic_chunk)
                chunk_index += 1

            start = end

        return chunks

    async def _enhance_chunks_semantics(
        self, chunks: List[SemanticChunk]
    ) -> List[SemanticChunk]:
        """
        Enhance chunks with semantic analysis including:
        - Semantic similarity scores
        - Topic coherence
        - Neighbor similarity analysis
        """
        if not chunks or not self.sentence_model:
            return chunks

        # Get embeddings for all chunks
        chunk_texts = [chunk.content for chunk in chunks]
        chunk_embeddings = self.sentence_model.encode(chunk_texts)

        # Calculate semantic scores and neighbor similarities
        for i, chunk in enumerate(chunks):
            # Semantic score (average similarity to other chunks)
            similarities = cosine_similarity([chunk_embeddings[i]], chunk_embeddings)[0]
            chunk.semantic_score = float(np.mean(similarities))

            # Neighbor similarities
            neighbor_similarities = []
            if i > 0:
                neighbor_similarities.append(
                    float(
                        cosine_similarity(
                            [chunk_embeddings[i]], [chunk_embeddings[i - 1]]
                        )[0][0]
                    )
                )
            if i < len(chunks) - 1:
                neighbor_similarities.append(
                    float(
                        cosine_similarity(
                            [chunk_embeddings[i]], [chunk_embeddings[i + 1]]
                        )[0][0]
                    )
                )
            chunk.similarity_to_neighbors = neighbor_similarities

            # Topic coherence (simplified - could use LDA for more advanced analysis)
            chunk.topic_coherence = await self._calculate_topic_coherence(chunk)

        return chunks

    async def _calculate_topic_coherence(self, chunk: SemanticChunk) -> float:
        """
        Calculate topic coherence for a chunk
        Simplified version - could be enhanced with proper topic modeling
        """
        # Extract keywords (simplified TF-IDF style)
        words = re.findall(r"\b\w+\b", chunk.content.lower())

        # Remove common stop words
        stop_words = {
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
        }
        words = [w for w in words if w not in stop_words and len(w) > 2]

        # Calculate word frequency diversity
        if not words:
            return 0.0

        word_freq = {}
        for word in words:
            word_freq[word] = word_freq.get(word, 0) + 1

        # Topic coherence as inverse of word repetition
        unique_words = len(word_freq)
        total_words = len(words)
        coherence = unique_words / total_words if total_words > 0 else 0.0

        # Store top keywords
        top_keywords = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:5]
        chunk.topic_keywords = [kw[0] for kw in top_keywords]

        return coherence


# Factory function for easy instantiation
async def create_semantic_chunker(
    chunk_size: int = 1000, enable_semantic: bool = True
) -> SemanticChunker:
    """
    Create semantic chunker with appropriate configuration

    Args:
        chunk_size: Target chunk size
        enable_semantic: Whether to enable semantic analysis

    Returns:
        Configured semantic chunker
    """
    if enable_semantic:
        return SemanticChunker(
            min_chunk_size=max(200, chunk_size // 4),
            max_chunk_size=chunk_size,
            semantic_threshold=0.7,
            embedding_model="all-MiniLM-L6-v2",
        )
    else:
        # Return a simpler chunker for fallback
        return SemanticChunker(
            min_chunk_size=max(200, chunk_size // 4),
            max_chunk_size=chunk_size,
            enable_topic_modeling=False,
        )
