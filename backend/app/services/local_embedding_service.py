"""
Local High-Quality Embedding Service
Provides API-key-free embeddings using advanced open-source models
"""

import os
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
import structlog
from sentence_transformers import SentenceTransformer
import numpy as np
from pathlib import Path

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
    # Large, high-quality models
    "e5-large-v2": EmbeddingModel(
        name="e5-large-v2",
        dimensions=1024,
        description="Best quality for semantic understanding",
        max_sequence_length=512,
        is_cached=True,
    ),
    "bge-large-en-v1.5": EmbeddingModel(
        name="bge-large-en-v1.5",
        dimensions=1024,
        description="Excellent for English text understanding",
        max_sequence_length=512,
        is_cached=True,
    ),
    # Multilingual models
    "paraphrase-multilingual-MiniLM-L12-v2": EmbeddingModel(
        name="paraphrase-multilingual-MiniLM-L12-v2",
        dimensions=384,
        description="Multilingual support with good quality",
        max_sequence_length=512,
        is_cached=True,
    ),
}


class LocalEmbeddingService:
    """Local embedding service with high-quality models"""

    def __init__(self, model_name: str = "e5-base-v2", cache_dir: Optional[str] = None):
        self.model_name = model_name
        self.cache_dir = cache_dir or "./models_cache"

        # Create cache directory
        os.makedirs(self.cache_dir, exist_ok=True)

        # Initialize model
        self.model = None
        self._load_model()

        logger.info(
            f"Initialized local embedding service with {model_name}",
            dimensions=self.get_model_info().dimensions,
            cache_dir=self.cache_dir,
        )

    def _load_model(self):
        """Load the embedding model"""
        try:
            model_info = LOCAL_MODELS[self.model_name]

            # Configure for optimal performance
            self.model = SentenceTransformer(
                model_info.model_path or model_info.name,
                cache_folder=self.cache_dir,
                device="cpu",  # Can be 'cuda' for GPU
                trust_remote_code=False,
            )

            # Optimize for inference
            if hasattr(self.model, "eval"):
                self.model.eval()

        except Exception as e:
            logger.error(f"Failed to load model {self.model_name}: {e}")
            # Fallback to smaller model
            self.model_name = "all-MiniLM-L6-v2"
            self.model = SentenceTransformer(
                self.model_name, cache_folder=self.cache_dir
            )
            logger.warning(f"Fell back to {self.model_name}")

    def get_model_info(self) -> EmbeddingModel:
        """Get information about current model"""
        return LOCAL_MODELS.get(self.model_name, LOCAL_MODELS["all-MiniLM-L6-v2"])

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts"""
        if not self.model:
            raise RuntimeError("Model not loaded")

        try:
            # Batch encode for efficiency
            embeddings = self.model.encode(
                texts,
                batch_size=32,
                normalize_embeddings=True,  # L2 normalize for cosine similarity
                show_progress_bar=False,
            )

            # Convert to list format
            return embeddings.tolist()

        except Exception as e:
            logger.error(f"Embedding failed: {e}")
            raise

    async def embed_text(self, text: str) -> List[float]:
        """Generate embedding for single text"""
        embeddings = await self.embed_texts([text])
        return embeddings[0] if embeddings else []

    def compute_similarity(
        self, embedding1: List[float], embedding2: List[float]
    ) -> float:
        """Compute cosine similarity between two embeddings"""
        if not embedding1 or not embedding2:
            return 0.0

        # Convert to numpy arrays
        emb1 = np.array(embedding1)
        emb2 = np.array(embedding2)

        # Compute cosine similarity
        dot_product = np.dot(emb1, emb2)
        norm1 = np.linalg.norm(emb1)
        norm2 = np.linalg.norm(emb2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return float(dot_product / (norm1 * norm2))

    async def find_similar_texts(
        self, query: str, candidates: List[str], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """Find most similar texts to query"""
        # Embed query and candidates
        query_embedding = await self.embed_text(query)
        candidate_embeddings = await self.embed_texts(candidates)

        # Compute similarities
        similarities = []
        for i, candidate_embedding in enumerate(candidate_embeddings):
            similarity = self.compute_similarity(query_embedding, candidate_embedding)
            similarities.append(
                {"text": candidates[i], "similarity": similarity, "index": i}
            )

        # Sort by similarity and return top_k
        similarities.sort(key=lambda x: x["similarity"], reverse=True)
        return similarities[:top_k]

    def get_available_models(self) -> Dict[str, EmbeddingModel]:
        """Get all available local models"""
        return LOCAL_MODELS.copy()

    def switch_model(self, model_name: str):
        """Switch to different embedding model"""
        if model_name not in LOCAL_MODELS:
            raise ValueError(f"Unknown model: {model_name}")

        if model_name != self.model_name:
            self.model_name = model_name
            self._load_model()

            logger.info(f"Switched to model: {model_name}")


class HybridEmbeddingService:
    """Hybrid service that can use both local and API-based embeddings"""

    def __init__(
        self, local_model: str = "e5-base-v2", cache_dir: Optional[str] = None
    ):
        self.local_service = LocalEmbeddingService(local_model, cache_dir)
        self.api_key = os.getenv("OPENAI_API_KEY")  # Fallback API key
        self.use_local_only = not bool(self.api_key)

        logger.info(
            f"Initialized hybrid embedding service",
            local_model=local_model,
            use_local_only=self.use_local_only,
        )

    async def embed_texts(
        self, texts: List[str], prefer_local: bool = True
    ) -> List[List[float]]:
        """
        Generate embeddings with fallback to API if needed

        Args:
            texts: Texts to embed
            prefer_local: Try local first even if API key available

        Returns:
            List of embeddings
        """
        # Use local if preferred or no API key
        if prefer_local or self.use_local_only:
            try:
                return await self.local_service.embed_texts(texts)
            except Exception as e:
                if self.use_local_only:
                    raise
                logger.warning(f"Local embedding failed, trying API: {e}")

        # Fallback to API (if available)
        if self.api_key:
            return await self._embed_with_api(texts)

        raise RuntimeError("No embedding method available")

    async def embed_with_quality(
        self, texts: List[str], quality: str = "medium"
    ) -> List[List[float]]:
        """
        Generate embeddings with specified quality level

        Args:
            texts: Texts to embed
            quality: "low", "medium", "high"

        Returns:
            List of embeddings
        """
        if quality == "high" and not self.use_local_only:
            # Use API for highest quality
            return await self._embed_with_api(texts)
        elif quality == "low":
            # Use smallest local model for speed
            original_model = self.local_service.model_name
            self.local_service.switch_model("all-MiniLM-L6-v2")
            try:
                embeddings = await self.local_service.embed_texts(texts)
                self.local_service.switch_model(original_model)  # Restore
                return embeddings
            except:
                self.local_service.switch_model(original_model)
                raise
        else:
            # Use default local model
            return await self.local_service.embed_texts(texts)

    async def _embed_with_api(self, texts: List[str]) -> List[List[float]]:
        """Fallback to OpenAI API for embeddings"""
        try:
            import openai

            client = openai.AsyncOpenAI(api_key=self.api_key)

            response = await client.embeddings.create(
                model="text-embedding-3-large",  # Use higher quality API model
                input=texts,
            )

            return [item.embedding for item in response.data]

        except Exception as e:
            logger.error(f"API embedding failed: {e}")
            raise


# Factory functions
def create_local_embedding_service(
    model_name: str = "e5-base-v2",
) -> LocalEmbeddingService:
    """Create local embedding service with optimal model"""
    return LocalEmbeddingService(model_name=model_name)


def create_hybrid_embedding_service(
    local_model: str = "e5-base-v2", use_local_only: bool = True
) -> HybridEmbeddingService:
    """Create hybrid embedding service"""
    return HybridEmbeddingService(local_model=local_model)


# Model recommendations based on use case
def recommend_model(
    use_case: str, multilingual: bool = False, quality_priority: str = "balanced"
) -> str:
    """
    Recommend best model for specific use case

    Args:
        use_case: "semantic_search", "clustering", "classification", "retrieval"
        multilingual: Whether multilingual support is needed
        quality_priority: "speed", "balanced", "quality"

    Returns:
        Recommended model name
    """
    if quality_priority == "speed":
        return "all-MiniLM-L6-v2"

    if multilingual:
        return "paraphrase-multilingual-MiniLM-L12-v2"

    if use_case in ["semantic_search", "retrieval"]:
        if quality_priority == "quality":
            return "e5-large-v2"
        return "e5-base-v2"

    if use_case == "clustering":
        return "all-mpnet-base-v2"

    # Default recommendation
    return "e5-base-v2"


# Performance monitoring
class EmbeddingPerformanceMonitor:
    """Monitor embedding service performance"""

    def __init__(self):
        self.stats = {
            "total_requests": 0,
            "total_texts": 0,
            "total_tokens": 0,
            "cache_hits": 0,
            "api_fallbacks": 0,
            "average_response_time": 0.0,
        }

    def log_request(
        self,
        text_count: int,
        token_count: int,
        response_time: float,
        cache_hit: bool = False,
        api_fallback: bool = False,
    ):
        """Log embedding request performance"""
        self.stats["total_requests"] += 1
        self.stats["total_texts"] += text_count
        self.stats["total_tokens"] += token_count
        self.stats["average_response_time"] = (
            self.stats["average_response_time"] * (self.stats["total_requests"] - 1)
            + response_time
        ) / self.stats["total_requests"]

        if cache_hit:
            self.stats["cache_hits"] += 1
        if api_fallback:
            self.stats["api_fallbacks"] += 1

    def get_performance_report(self) -> Dict[str, Any]:
        """Get performance statistics"""
        total_requests = self.stats["total_requests"]

        return {
            **self.stats,
            "cache_hit_rate": self.stats["cache_hits"] / total_requests
            if total_requests > 0
            else 0,
            "api_fallback_rate": self.stats["api_fallbacks"] / total_requests
            if total_requests > 0
            else 0,
            "texts_per_request": self.stats["total_texts"] / total_requests
            if total_requests > 0
            else 0,
            "tokens_per_request": self.stats["total_tokens"] / total_requests
            if total_requests > 0
            else 0,
        }
