"""
Enhanced Document Processing Service with Semantic Chunking and Cost Tracking
Integrates semantic chunking, OCR capabilities, and cost management
"""

from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
import structlog
from decimal import Decimal

from app.services.document_processors import (
    DocumentProcessorFactory,
    ProcessedDocument,
    ProcessorType,
)
from app.services.semantic_chunker import SemanticChunker, create_semantic_chunker
from app.services.cost_tracking_service import CostTrackingService
from app.services.rag_service import RAGService
from app.models.cost_tracking import CostProvider, CostModel
from app.core.config import settings
from app.core.exceptions import ValidationError

logger = structlog.get_logger()


@dataclass
class ProcessingOptions:
    """Options for document processing"""

    use_semantic_chunking: bool = True
    preserve_structure: bool = True
    force_processor: Optional[ProcessorType] = None
    chunk_size: int = 1000
    chunk_overlap: int = 200
    semantic_threshold: float = 0.7


class EnhancedDocumentProcessor:
    """
    Enhanced document processor with:
    - Semantic chunking capabilities
    - Cost tracking integration
    - OCR processing for images
    - Multi-modal support
    """

    def __init__(self, database):
        self.db = database
        self.cost_service = CostTrackingService(database)
        self.rag_service = RAGService(database)

        # Initialize document processor factory
        self.document_factory = DocumentProcessorFactory()

        # Semantic chunker (lazy initialization)
        self.semantic_chunker = None

        # OCR processing placeholder
        self.ocr_enabled = False  # Will be enabled when OCR is implemented

    async def process_document_with_tracking(
        self,
        file_path: str,
        file_id: str,
        tenant_id: str,
        options: Optional[ProcessingOptions] = None,
        file_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process document with semantic chunking and cost tracking

        Args:
            file_path: Path to the document
            file_id: Unique file identifier
            tenant_id: Tenant ID for tracking
            options: Processing options
            file_url: Optional URL to fetch document from

        Returns:
            Processing results with cost tracking
        """
        start_time = datetime.now(timezone.utc)
        options = options or ProcessingOptions()

        logger.info(
            "Starting enhanced document processing",
            file_id=file_id,
            tenant_id=tenant_id,
            use_semantic_chunking=options.use_semantic_chunking,
            chunk_size=options.chunk_size,
        )

        try:
            # Estimate processing costs
            estimated_cost = await self._estimate_processing_cost(
                file_path, options, tenant_id
            )

            # Check quota before processing
            allowed, reason = await self.cost_service.check_quota(
                tenant_id, estimated_cost
            )
            if not allowed:
                raise ValidationError(f"Processing quota exceeded: {reason}")

            # Process document
            result = await self.rag_service.process_document(
                file_path=file_path,
                file_id=file_id,
                tutor_id=tenant_id,
                file_url=file_url,
                force_processor=options.force_processor,
                use_semantic_chunking=options.use_semantic_chunking,
            )

            # Track actual costs
            actual_cost = await self._track_processing_cost(
                file_id, tenant_id, result, options, start_time
            )

            # Add cost tracking to result
            result.update(
                {
                    "cost_tracked": True,
                    "estimated_cost": float(estimated_cost),
                    "actual_cost": float(actual_cost),
                    "processing_time_seconds": (
                        datetime.now(timezone.utc) - start_time
                    ).total_seconds(),
                }
            )

            return result

        except Exception as e:
            logger.error(
                "Enhanced document processing failed",
                file_id=file_id,
                tenant_id=tenant_id,
                error=str(e),
            )

            # Track failed processing
            await self.cost_service.track_usage(
                tenant_id=tenant_id,
                provider=CostProvider.OPENAI,  # Default provider
                model=CostModel.GPT_4O_MINI,
                input_tokens=0,
                output_tokens=0,
                operation="document_processing_failed",
                metadata={
                    "file_id": file_id,
                    "error": str(e),
                    "processing_time": (
                        datetime.now(timezone.utc) - start_time
                    ).total_seconds(),
                },
            )
            raise

    async def _estimate_processing_cost(
        self, file_path: str, options: ProcessingOptions, tenant_id: str
    ) -> Decimal:
        """
        Estimate processing cost for a document

        This is a simplified estimation - real implementation would
        consider file size, type, and processing complexity
        """
        import os

        try:
            # Basic cost estimation based on file size
            file_size = os.path.getsize(file_path)

            # Estimate tokens based on file size
            estimated_tokens = file_size // 4  # Rough estimate: 1 token per 4 bytes

            # Estimate embedding cost (primary cost for document processing)
            embedding_config = await self.rag_service._get_embedding_config(tenant_id)
            estimated_cost = await self.rag_service._estimate_embedding_cost(
                embedding_config["provider"],
                embedding_config["model"],
                estimated_tokens,
            )

            # Add semantic chunking overhead if enabled
            if options.use_semantic_chunking:
                semantic_overhead = estimated_cost * Decimal("0.2")  # 20% overhead
                estimated_cost += semantic_overhead

            return estimated_cost

        except Exception as e:
            logger.warning(
                "Failed to estimate processing cost, using default", error=str(e)
            )
            return Decimal("0.01")  # Small default cost

    async def _track_processing_cost(
        self,
        file_id: str,
        tenant_id: str,
        processing_result: Dict[str, Any],
        options: ProcessingOptions,
        start_time: datetime,
    ) -> Decimal:
        """Track actual processing cost"""

        # Get embedding config for cost calculation
        embedding_config = await self.rag_service._get_embedding_config(tenant_id)

        # Use token estimates from processing result
        total_tokens = processing_result.get("token_estimate", 1000)

        # Calculate embedding cost
        embedding_cost = await self.rag_service._estimate_embedding_cost(
            embedding_config["provider"], embedding_config["model"], total_tokens
        )

        # Track the cost
        await self.cost_service.track_usage(
            tenant_id=tenant_id,
            provider=embedding_config["provider"],
            model=CostModel(embedding_config["model"]),
            input_tokens=total_tokens,
            output_tokens=0,
            operation="document_processing",
            metadata={
                "file_id": file_id,
                "chunks": processing_result.get("chunks", 0),
                "semantic_chunking": options.use_semantic_chunking,
                "processor_used": processing_result.get("processor_used"),
                "page_count": processing_result.get("page_count", 0),
                "character_count": processing_result.get("character_count", 0),
                "processing_time": (
                    datetime.now(timezone.utc) - start_time
                ).total_seconds(),
            },
        )

        return embedding_cost

    async def process_with_semantic_analysis(
        self,
        file_path: str,
        file_id: str,
        tenant_id: str,
        analysis_type: str = "content",  # content, structure, topics
    ) -> Dict[str, Any]:
        """
        Process document with advanced semantic analysis

        Args:
            file_path: Path to document
            file_id: Unique file identifier
            tenant_id: Tenant ID
            analysis_type: Type of semantic analysis to perform

        Returns:
            Semantic analysis results
        """
        start_time = datetime.now(timezone.utc)

        try:
            # Process document first
            processed_doc = await self.rag_service._load_document_with_processor(
                file_path
            )

            if not processed_doc:
                raise ValueError("Failed to load document")

            # Initialize semantic chunker for analysis
            if not self.semantic_chunker:
                self.semantic_chunker = await create_semantic_chunker(
                    chunk_size=800,  # Smaller chunks for better analysis
                    enable_semantic=True,
                )

            # Apply semantic chunking
            semantic_chunks = await self.semantic_chunker.chunk_document(
                processed_doc, preserve_structure=True
            )

            # Perform analysis based on type
            if analysis_type == "content":
                analysis = self._analyze_content(semantic_chunks)
            elif analysis_type == "structure":
                analysis = self._analyze_structure(semantic_chunks)
            elif analysis_type == "topics":
                analysis = self._analyze_topics(semantic_chunks)
            else:
                analysis = {"error": f"Unknown analysis type: {analysis_type}"}

            # Track cost for analysis
            await self.cost_service.track_usage(
                tenant_id=tenant_id,
                provider=CostProvider.OPENAI,
                model=CostModel.GPT_4O_MINI,
                input_tokens=len(processed_doc.raw_text.split()),
                output_tokens=200,  # Estimated tokens for analysis
                operation="semantic_analysis",
                metadata={
                    "file_id": file_id,
                    "analysis_type": analysis_type,
                    "chunks_analyzed": len(semantic_chunks),
                    "processing_time": (
                        datetime.now(timezone.utc) - start_time
                    ).total_seconds(),
                },
            )

            return {
                "file_id": file_id,
                "analysis_type": analysis_type,
                "semantic_chunks": len(semantic_chunks),
                "analysis": analysis,
                "processing_time": (
                    datetime.now(timezone.utc) - start_time
                ).total_seconds(),
                "chunk_details": [
                    {
                        "index": i,
                        "content": chunk.content[:200] + "..."
                        if len(chunk.content) > 200
                        else chunk.content,
                        "semantic_score": chunk.semantic_score,
                        "topic_coherence": chunk.topic_coherence,
                        "topic_keywords": chunk.topic_keywords[:5]
                        if chunk.topic_keywords
                        else [],
                    }
                    for i, chunk in enumerate(semantic_chunks[:10])  # First 10 chunks
                ],
            }

        except Exception as e:
            logger.error(
                "Semantic analysis failed",
                file_id=file_id,
                tenant_id=tenant_id,
                error=str(e),
            )
            raise

    def _analyze_content(self, semantic_chunks: List) -> Dict[str, Any]:
        """Analyze content quality and characteristics"""
        if not semantic_chunks:
            return {"error": "No chunks to analyze"}

        # Calculate content metrics
        total_chunks = len(semantic_chunks)
        avg_semantic_score = (
            sum(chunk.semantic_score for chunk in semantic_chunks) / total_chunks
        )
        avg_coherence = (
            sum(chunk.topic_coherence for chunk in semantic_chunks) / total_chunks
        )

        # Find high-quality chunks
        high_quality_chunks = [
            chunk
            for chunk in semantic_chunks
            if chunk.semantic_score > 0.7 and chunk.topic_coherence > 0.6
        ]

        return {
            "total_chunks": total_chunks,
            "average_semantic_score": avg_semantic_score,
            "average_topic_coherence": avg_coherence,
            "high_quality_chunks": len(high_quality_chunks),
            "quality_percentage": (len(high_quality_chunks) / total_chunks) * 100,
            "recommendations": self._generate_content_recommendations(semantic_chunks),
        }

    def _analyze_structure(self, semantic_chunks: List) -> Dict[str, Any]:
        """Analyze document structure"""
        sections = {}
        headings = {}

        for chunk in semantic_chunks:
            # Track sections
            section = chunk.section or "unknown"
            if section not in sections:
                sections[section] = 0
            sections[section] += 1

            # Track headings
            heading = chunk.heading
            if heading and heading not in headings:
                headings[heading] = 0
            if heading:
                headings[heading] += 1

        return {
            "sections": sections,
            "headings": headings,
            "structure_score": self._calculate_structure_score(semantic_chunks),
            "recommendations": self._generate_structure_recommendations(
                semantic_chunks
            ),
        }

    def _analyze_topics(self, semantic_chunks: List) -> Dict[str, Any]:
        """Analyze topics across chunks"""
        all_keywords = []
        chunk_topics = []

        for chunk in semantic_chunks:
            if chunk.topic_keywords:
                all_keywords.extend(chunk.topic_keywords)
                chunk_topics.append(
                    {
                        "chunk_index": chunk.chunk_index,
                        "keywords": chunk.topic_keywords[:5],
                        "topic_coherence": chunk.topic_coherence,
                    }
                )

        # Aggregate keywords
        keyword_counts = {}
        for keyword in all_keywords:
            keyword_counts[keyword] = keyword_counts.get(keyword, 0) + 1

        # Top topics
        top_topics = sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True)[
            :10
        ]

        return {
            "top_topics": top_topics,
            "total_unique_topics": len(keyword_counts),
            "average_topics_per_chunk": len(all_keywords) / len(semantic_chunks)
            if semantic_chunks
            else 0,
            "chunk_topics": chunk_topics[:10],  # First 10 chunks
            "topic_diversity": len(keyword_counts) / len(all_keywords)
            if all_keywords
            else 0,
        }

    def _calculate_structure_score(self, semantic_chunks: List) -> float:
        """Calculate document structure quality score"""
        if not semantic_chunks:
            return 0.0

        has_sections = any(chunk.section for chunk in semantic_chunks)
        has_headings = any(chunk.heading for chunk in semantic_chunks)

        score = 0.0
        if has_sections:
            score += 0.4
        if has_headings:
            score += 0.4

        # Bonus for logical flow
        if len(semantic_chunks) > 1:
            flow_score = sum(
                chunk.similarity_to_neighbors[0] if chunk.similarity_to_neighbors else 0
                for chunk in semantic_chunks[1:]
            ) / (len(semantic_chunks) - 1)
            score += flow_score * 0.2

        return min(score, 1.0)

    def _generate_content_recommendations(self, semantic_chunks: List) -> List[str]:
        """Generate content quality recommendations"""
        recommendations = []

        avg_semantic = sum(chunk.semantic_score for chunk in semantic_chunks) / len(
            semantic_chunks
        )
        avg_coherence = sum(chunk.topic_coherence for chunk in semantic_chunks) / len(
            semantic_chunks
        )

        if avg_semantic < 0.6:
            recommendations.append(
                "Consider breaking down complex concepts into simpler explanations"
            )

        if avg_coherence < 0.5:
            recommendations.append(
                "Content lacks clear topical focus - consider organizing by themes"
            )

        if len(semantic_chunks) < 5:
            recommendations.append(
                "Document is quite short - consider adding more examples or details"
            )

        low_quality_ratio = len(
            [c for c in semantic_chunks if c.semantic_score < 0.5]
        ) / len(semantic_chunks)
        if low_quality_ratio > 0.3:
            recommendations.append(
                "Many sections have low semantic quality - consider content review"
            )

        return recommendations

    def _generate_structure_recommendations(self, semantic_chunks: List) -> List[str]:
        """Generate structure quality recommendations"""
        recommendations = []

        has_sections = any(chunk.section for chunk in semantic_chunks)
        has_headings = any(chunk.heading for chunk in semantic_chunks)

        if not has_sections:
            recommendations.append(
                "Add section headings to improve document organization"
            )

        if not has_headings:
            recommendations.append("Include descriptive headings for better navigation")

        sections_with_headings = set()
        for chunk in semantic_chunks:
            if chunk.section and chunk.heading:
                sections_with_headings.add(chunk.section)

        if len(sections_with_headings) < len(
            set(chunk.section for chunk in semantic_chunks if chunk.section)
        ):
            recommendations.append("Some sections lack proper headings")

        return recommendations
