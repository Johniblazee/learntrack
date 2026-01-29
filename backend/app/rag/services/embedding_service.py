"""
Unified Embedding Service using LangChain
Local embeddings only - no API embeddings to reduce costs
"""

import os
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import structlog

from langchain_community.embeddings import SentenceTransformerEmbeddings
from sentence_transformers import SentenceTransformer
import numpy as np

from app.core.config import settings

logger = structlog.get_logger()


@dataclass
class EmbeddingModel:
    """Configuration for local embedding model"""

    name: str
    dimensions: int
    description: str
    max_sequence_length: int
    model_path: Optional[str] = None
    is_cached: bool = False


# High-quality local embedding models
LOCAL_MODELS: Dict[str, EmbeddingModel] = {
    # Small, fast models
    "all-MiniLM-L6-v2": EmbeddingModel(
        name="all-MiniLM-L6-v2",
        dimensions=384,
        description="Fast, lightweight model for general text",
        max_sequence_length=512,
        is_cached=True,
    ),
    # Medium-quality models
    "all-mpnet-base-v2": EmbeddingModel(
        name="all-mpnet-base-v2",
        dimensions=768,
        description="Good quality for semantic search",
        max_sequence_length=512,
        is_cached=True,
    ),
    "e5-base-v2": EmbeddingModel(
        name="e5-base-v2",
        dimensions=768,
        description="High-quality embeddings optimized for retrieval",
        max_sequence_length=512,
        is_cached=True,
    ),
    # High-quality models
    "e5-large-v2": EmbeddingModel(
        name="e5-large-v2",
        dimensions=1024,
        description="Excellent quality for complex semantic understanding",
        max_sequence_length=512,
        is_cached=False,  # Download on first use
    ),
    "bge-large-en-v1.5": EmbeddingModel(
        name="bge-large-en-v1.5",
        dimensions=1024,
        description="State-of-the-art multilingual embeddings",
        max_sequence_length=512,
        is_cached=False,  # Download on first use
    ),
}


class EmbeddingService:
    """
    Unified embedding service using only local models
    Replaces custom implementation with LangChain SentenceTransformerEmbeddings
    """

    def __init__(self, model_name: str = "e5-base-v2"):
        self.model_name = model_name
        self.model_config = LOCAL_MODELS.get(model_name, LOCAL_MODELS["e5-base-v2"])
        self._embeddings = None
        self._model = None

        logger.info(
            "Initialized EmbeddingService",
            model_name=model_name,
            dimensions=self.model_config.dimensions,
            description=self.model_config.description,
        )

    @property
    def embeddings(self) -> SentenceTransformerEmbeddings:
        """Lazy initialization of LangChain embeddings"""
        if self._embeddings is None:
            self._embeddings = SentenceTransformerEmbeddings(
                model_name=self.model_name,
                cache_folder=os.path.join(settings.BASE_DIR, "embedding_cache"),
                model_kwargs={"device": "cpu"},  # Can be configured to use GPU
            )
            logger.info("Loaded embedding model", model=self.model_name)
        return self._embeddings

    @property
    def model(self) -> SentenceTransformer:
        """Access to the underlying sentence-transformers model"""
        if self._model is None:
            self._model = SentenceTransformer(self.model_name)
        return self._model

    async def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Get embeddings for a list of texts
        Uses LangChain's optimized embeddings
        """
        try:
            # Use LangChain's async embedding
            embeddings = await self.embeddings.aembed_documents(texts)
            return embeddings
        except Exception as e:
            logger.error("Failed to generate embeddings", error=str(e))
            raise

    async def get_embedding(self, text: str) -> List[float]:
        """Get embedding for a single text"""
        try:
            embedding = await self.embeddings.aembed_query(text)
            return embedding
        except Exception as e:
            logger.error("Failed to generate embedding", error=str(e))
            raise

    def get_embeddings_sync(self, texts: List[str]) -> List[List[float]]:
        """Synchronous embedding generation"""
        try:
            return self.embeddings.embed_documents(texts)
        except Exception as e:
            logger.error("Failed to generate embeddings", error=str(e))
            raise

    def get_embedding_sync(self, text: str) -> List[float]:
        """Synchronous single embedding generation"""
        try:
            return self.embeddings.embed_query(text)
        except Exception as e:
            logger.error("Failed to generate embedding", error=str(e))
            raise

    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the current model"""
        return {
            "name": self.model_name,
            "dimensions": self.model_config.dimensions,
            "description": self.model_config.description,
            "max_sequence_length": self.model_config.max_sequence_length,
            "is_cached": self.model_config.is_cached,
        }

    def list_available_models(self) -> List[Dict[str, Any]]:
        """List all available local models"""
        return [
            {
                "name": model.name,
                "dimensions": model.dimensions,
                "description": model.description,
                "max_sequence_length": model.max_sequence_length,
                "is_cached": model.is_cached,
            }
            for model in LOCAL_MODELS.values()
        ]

    def switch_model(self, model_name: str) -> None:
        """Switch to a different model"""
        if model_name not in LOCAL_MODELS:
            raise ValueError(f"Unknown model: {model_name}")

        self.model_name = model_name
        self.model_config = LOCAL_MODELS[model_name]
        self._embeddings = None  # Reset embeddings to reload with new model
        self._model = None

        logger.info("Switched embedding model", new_model=model_name)

    def compute_similarity(
        self, embedding1: List[float], embedding2: List[float]
    ) -> float:
        """Compute cosine similarity between two embeddings"""
        try:
            # Convert to numpy arrays
            e1 = np.array(embedding1)
            e2 = np.array(embedding2)

            # Compute cosine similarity
            similarity = np.dot(e1, e2) / (np.linalg.norm(e1) * np.linalg.norm(e2))
            return float(similarity)
        except Exception as e:
            logger.error("Failed to compute similarity", error=str(e))
            raise

    async def find_most_similar(
        self,
        query_embedding: List[float],
        candidate_embeddings: List[List[float]],
        threshold: float = 0.7,
    ) -> List[tuple[int, float]]:
        """Find most similar embeddings to query"""
        similarities = []
        for i, candidate in enumerate(candidate_embeddings):
            similarity = self.compute_similarity(query_embedding, candidate)
            if similarity >= threshold:
                similarities.append((i, similarity))

        # Sort by similarity descending
        similarities.sort(key=lambda x: x[1], reverse=True)
        return similarities


# Global instance for convenience
_default_embedding_service = None


def get_embedding_service(model_name: str = "e5-base-v2") -> EmbeddingService:
    """Get or create default embedding service"""
    global _default_embedding_service
    if (
        _default_embedding_service is None
        or _default_embedding_service.model_name != model_name
    ):
        _default_embedding_service = EmbeddingService(model_name)
    return _default_embedding_service


def create_embedding_service(model_name: str = "e5-base-v2") -> EmbeddingService:
    """Create a new embedding service instance"""
    return EmbeddingService(model_name)
