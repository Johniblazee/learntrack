"""
Consolidated AI Manager with Enhanced LangChain Integration
Manages multiple AI providers with intelligent fallback and cost optimization
"""

from importlib import import_module
from typing import Callable, List, Dict, Any, Optional, Tuple, Type
from decimal import Decimal
import structlog
import asyncio

from app.core.config import settings
from app.ai.providers.base import BaseAIProvider, AIProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.core.exceptions import AIProviderError

logger = structlog.get_logger()

# Cache for tenant-specific AI managers
_tenant_ai_managers: Dict[str, "AIManager"] = {}
# Async lock to guard tenant AI manager cache
_tenant_cache_lock = asyncio.Lock()
# Per-tenant creation futures to prevent concurrent construction
_tenant_creation_futures: Dict[str, asyncio.Future] = {}

PROVIDER_CLASS_PATHS: Dict[AIProvider, Tuple[str, str]] = {
    AIProvider.OPENAI: ("app.ai.providers.openai_provider", "OpenAIProvider"),
    AIProvider.GROQ: ("app.ai.providers.groq_provider", "GroqProvider"),
    AIProvider.GEMINI: ("app.ai.providers.gemini_provider", "GeminiProvider"),
}


def _load_provider_class(provider: AIProvider) -> Type[BaseAIProvider]:
    module_name, class_name = PROVIDER_CLASS_PATHS[provider]
    module = import_module(module_name)
    provider_class = getattr(module, class_name)
    return provider_class


class AIManager:
    """
    Enhanced AI manager with LangChain integration and intelligent fallback
    Replaces the original ai_manager.py with consolidated functionality
    """

    def __init__(
        self,
        ai_settings: Optional[Dict[str, Any]] = None,
        tenant_config: Optional[Dict[str, Any]] = None,
    ):
        self.providers: Dict[str, BaseAIProvider] = {}
        self.default_provider = AIProvider.OPENAI
        self.ai_settings = ai_settings or {}
        self.tenant_config = tenant_config  # Per-tenant configuration
        self._initialize_providers()

    def _is_valid_api_key(self, key: Optional[str], provider: str) -> bool:
        """Check if API key is valid (not a placeholder)"""
        if not key:
            return False
        # Reject common placeholder patterns
        placeholders = [
            "your_",
            "sk_test_",
            "api_key",
            "placeholder",
            "dummy",
            "test_key",
        ]
        key_l = key.lower()
        return not any(placeholder in key_l for placeholder in placeholders)

    def _initialize_providers(self) -> None:
        """Initialize all available AI providers"""
        # Initialize OpenAI
        openai_key = (
            self.tenant_config.get("openai_api_key")
            if self.tenant_config
            else getattr(settings, "OPENAI_API_KEY", None)
        )
        if self._is_valid_api_key(openai_key, "openai"):
            try:
                provider_class = _load_provider_class(AIProvider.OPENAI)
                self.providers[AIProvider.OPENAI] = provider_class(str(openai_key))
                logger.info("Initialized OpenAI provider")
            except Exception as e:
                logger.warning("Failed to initialize OpenAI provider", error=str(e))

        # Initialize Groq
        groq_key = (
            self.tenant_config.get("groq_api_key")
            if self.tenant_config
            else getattr(settings, "GROQ_API_KEY", None)
        )
        if self._is_valid_api_key(groq_key, "groq"):
            try:
                provider_class = _load_provider_class(AIProvider.GROQ)
                self.providers[AIProvider.GROQ] = provider_class(str(groq_key))
                logger.info("Initialized Groq provider")
            except Exception as e:
                logger.warning("Failed to initialize Groq provider", error=str(e))

        # Initialize Gemini
        gemini_key = (
            self.tenant_config.get("gemini_api_key")
            if self.tenant_config
            else getattr(settings, "GEMINI_API_KEY", None)
        )
        if self._is_valid_api_key(gemini_key, "gemini"):
            try:
                provider_class = _load_provider_class(AIProvider.GEMINI)
                self.providers[AIProvider.GEMINI] = provider_class(str(gemini_key))
                logger.info("Initialized Gemini provider")
            except Exception as e:
                logger.warning("Failed to initialize Gemini provider", error=str(e))

        # Set default provider based on availability
        if not self.providers:
            logger.warning("No AI providers available - check API keys")
        elif self.default_provider not in self.providers:
            # Set first available provider as default
            self.default_provider = next(iter(self.providers))
            logger.info(
                "Default provider not available, using fallback",
                fallback=self.default_provider,
            )

        logger.info(
            "AI Manager initialized",
            available_providers=list(self.providers.keys()),
            default_provider=self.default_provider,
        )

    async def get_best_provider(
        self,
        task_type: str = "question_generation",
        preferred_provider: Optional[str] = None,
        fallback_enabled: bool = True,
    ) -> BaseAIProvider:
        """
        Get the best available provider for a specific task
        with intelligent fallback
        """
        providers_to_try = []

        # Use preferred provider if specified
        # Normalize preferred_provider to AIProvider enum when possible
        preferred_enum = None
        if preferred_provider:
            try:
                preferred_enum = (
                    preferred_provider
                    if isinstance(preferred_provider, AIProvider)
                    else AIProvider(preferred_provider)
                )
            except Exception:
                logger.debug(
                    "preferred_provider could not be mapped to AIProvider",
                    preferred=preferred_provider,
                )

        if preferred_enum and preferred_enum in self.providers:
            providers_to_try.append(preferred_enum)

        # Add default provider
        if self.default_provider in self.providers:
            providers_to_try.append(self.default_provider)

        # Add all other providers
        for provider in self.providers:
            if provider not in providers_to_try:
                providers_to_try.append(provider)

        # Try providers in order
        for provider_name in providers_to_try:
            provider = self.providers[provider_name]
            try:
                # Health check
                if await provider.health_check():
                    logger.debug(
                        "Selected AI provider",
                        provider=provider_name,
                        task_type=task_type,
                    )
                    return provider
                else:
                    logger.warning(
                        "Provider health check failed",
                        provider=provider_name,
                    )
            except Exception as e:
                logger.warning(
                    "Provider selection failed",
                    provider=provider_name,
                    error=str(e),
                )
                continue

        # If no provider is available and fallback is disabled
        if not fallback_enabled:
            raise AIProviderError("No available AI providers")

        # As last resort, return first provider even if health check failed
        if self.providers:
            fallback = next(iter(self.providers.values()))
            logger.warning("Using fallback provider despite health check failure")
            return fallback

        raise AIProviderError("No AI providers configured")

    async def _with_fallback(
        self,
        operation: Callable[..., Any],
        task_type: str,
        preferred_provider: Optional[str] = None,
    ) -> Any:
        """Execute an async operation on the best provider, falling back to others on failure.

        Args:
            operation: An async callable that takes a provider and returns the result.
            task_type: A label for logging (e.g. "text_extraction").
            preferred_provider: Optional preferred provider name.
        """
        provider = await self.get_best_provider(
            task_type=task_type,
            preferred_provider=preferred_provider,
        )

        try:
            return await operation(provider)
        except Exception as e:
            logger.error(
                f"{task_type} failed with provider",
                provider=provider.provider_name,
                error=str(e),
            )

            # Try fallback providers
            for provider_name, fallback_provider in self.providers.items():
                if fallback_provider != provider:
                    try:
                        logger.info(
                            f"Trying fallback provider for {task_type}",
                            fallback=provider_name,
                        )
                        return await operation(fallback_provider)
                    except Exception as fallback_error:
                        logger.warning(
                            "Fallback provider also failed",
                            fallback=provider_name,
                            error=str(fallback_error),
                        )
                        continue

            raise AIProviderError(
                f"{task_type} failed with all providers: {str(e)}"
            )

    async def extract_text_from_content(
        self,
        content: str,
        file_type: str,
        preferred_provider: Optional[str] = None,
    ) -> str:
        """Extract text using best available provider with fallback"""
        return await self._with_fallback(
            lambda p: p.extract_text_from_content(content, file_type),
            task_type="text_extraction",
            preferred_provider=preferred_provider,
        )

    async def generate_questions(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        preferred_provider: Optional[str] = None,
    ) -> List[QuestionCreate]:
        """Generate questions using best available provider with fallback"""
        types = question_types or [QuestionType.MULTIPLE_CHOICE]
        return await self._with_fallback(
            lambda p: p.generate_questions(
                text_content=text_content,
                subject=subject,
                topic=topic,
                question_count=question_count,
                difficulty=difficulty,
                question_types=types,
            ),
            task_type="question_generation",
            preferred_provider=preferred_provider,
        )

    async def validate_question(
        self,
        question: QuestionCreate,
        preferred_provider: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Validate question using best available provider with fallback"""
        return await self._with_fallback(
            lambda p: p.validate_question(question),
            task_type="question_validation",
            preferred_provider=preferred_provider,
        )

    def get_available_providers(self) -> List[str]:
        """Get list of available providers"""
        return list(self.providers.keys())

    def get_provider_status(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all providers"""
        status = {}
        for name, provider in self.providers.items():
            status[name] = {
                "name": provider.provider_name,
                "available": True,  # Will be updated by health check
                "is_default": name == self.default_provider,
            }
        return status

    async def health_check_all_providers(self) -> Dict[str, bool]:
        """Check health of all providers"""
        results = {}
        tasks = []

        for name, provider in self.providers.items():
            task = self._check_provider_health(name, provider)
            tasks.append(task)

        health_results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, (name, _) in enumerate(self.providers.items()):
            result = health_results[i]
            if isinstance(result, Exception):
                results[name] = False
                logger.warning(
                    "Provider health check failed", provider=name, error=str(result)
                )
            else:
                results[name] = result

        return results

    async def _check_provider_health(self, name: str, provider: BaseAIProvider) -> bool:
        """Check health of a single provider"""
        try:
            return await provider.health_check()
        except Exception as e:
            logger.warning(
                "Provider health check exception", provider=name, error=str(e)
            )
            return False

    def get_provider(self, provider_name: str) -> Optional[BaseAIProvider]:
        """Get specific provider by name"""
        return self.providers.get(provider_name)

    def get_provider_costs(self) -> Dict[str, Dict[str, Decimal]]:
        """Get cost information for all providers"""
        # This would be enhanced with actual cost tracking from cost tracker
        return {
            "openai": {
                "input_tokens": Decimal("0.005"),
                "output_tokens": Decimal("0.015"),
            },
            "groq": {
                "input_tokens": Decimal("0.0005"),
                "output_tokens": Decimal("0.0015"),
            },
            "gemini": {
                "input_tokens": Decimal("0.00125"),
                "output_tokens": Decimal("0.00375"),
            },
        }

    async def generate_questions_with_rag(
        self,
        rag_context: str,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        preferred_provider: Optional[str] = None,
    ) -> List[QuestionCreate]:
        """Generate questions using RAG context"""
        # Combine RAG context with original content
        combined_content = (
            f"RAG Context:\n{rag_context}\n\nOriginal Content:\n{text_content}"
        )

        return await self.generate_questions(
            text_content=combined_content,
            subject=subject,
            topic=topic,
            question_count=question_count,
            difficulty=difficulty,
            question_types=question_types,
            preferred_provider=preferred_provider,
        )

    async def set_provider_model(self, provider_name: str, model_name: str) -> bool:
        """Set the model for a specific provider"""
        if provider_name in self.providers:
            provider = self.providers[provider_name]
            if hasattr(provider, "model_name"):
                provider.model_name = model_name
                logger.info(
                    "Set provider model", provider=provider_name, model=model_name
                )
                return True
        return False

    def get_available_models(
        self, provider_name: Optional[str] = None
    ) -> Dict[str, List[str]]:
        """Get available models for providers from centralized config.
        If provider_name is provided, return only that provider's models."""
        from app.core.ai_models_config import get_model_ids, ALL_PROVIDER_MODELS

        if provider_name:
            key = provider_name.lower()
            ids = get_model_ids(key, active_only=True)
            return {key: ids} if ids else {}
        return {
            provider: get_model_ids(provider, active_only=True)
            for provider in ALL_PROVIDER_MODELS
        }


async def get_ai_manager_for_tenant(
    tenant_id: str,
    tenant_config: Optional[Dict[str, Any]] = None,
) -> AIManager:
    """Get or create AI manager for a specific tenant (async and guarded).

    If tenant_config differs, recreate the manager.
    Uses per-tenant creation futures to prevent concurrent AIManager construction.
    """
    # First check: see if we can return existing without any heavy work
    creation_future = None
    future_to_await = None

    async with _tenant_cache_lock:
        existing = _tenant_ai_managers.get(tenant_id)
        if existing:
            if not tenant_config or existing.tenant_config == tenant_config:
                return existing
            # tenant_config differs, need to recreate - fall through to outside lock

        # Check if another coroutine is already creating the manager for this tenant
        creation_future = _tenant_creation_futures.get(tenant_id)
        if creation_future is not None:
            # Release lock before awaiting to avoid deadlock
            future_to_await = creation_future

    # If another coroutine is creating it, await the result outside the lock
    if creation_future is not None:
        return await future_to_await

    # We are the first caller - create a future to signal other coroutines
    future = None
    async with _tenant_cache_lock:
        # Double-check after acquiring lock
        existing = _tenant_ai_managers.get(tenant_id)
        if existing:
            if not tenant_config or existing.tenant_config == tenant_config:
                return existing

        # Check again for creation future (race condition check)
        if tenant_id in _tenant_creation_futures:
            future_to_await = _tenant_creation_futures[tenant_id]
            return await future_to_await

        # Create the future to block other coroutines
        future = asyncio.get_running_loop().create_future()
        _tenant_creation_futures[tenant_id] = future

    # Create new manager outside the lock to avoid I/O contention
    try:
        new_mgr = AIManager(tenant_config=tenant_config)
    except Exception as err:
        # Signal failure to waiting coroutines
        future.set_exception(err)
        raise
    finally:
        # Clean up the creation future
        async with _tenant_cache_lock:
            _tenant_creation_futures.pop(tenant_id, None)

    # Store the result
    async with _tenant_cache_lock:
        existing = _tenant_ai_managers.get(tenant_id)
        if existing:
            if tenant_config and existing.tenant_config != tenant_config:
                # Replace with new manager since config differs
                _tenant_ai_managers[tenant_id] = new_mgr
                future.set_result(new_mgr)
                return new_mgr
            # Another coroutine already created it with same config, use existing
            future.set_result(existing)
            return existing

        # Store and return new manager
        _tenant_ai_managers[tenant_id] = new_mgr
        future.set_result(new_mgr)
        return new_mgr


def create_ai_manager(
    ai_settings: Optional[Dict[str, Any]] = None,
    tenant_config: Optional[Dict[str, Any]] = None,
) -> AIManager:
    """Create a new AI manager instance"""
    return AIManager(ai_settings=ai_settings, tenant_config=tenant_config)


def get_default_ai_manager() -> AIManager:
    """Get the default AI manager"""
    return create_ai_manager()


async def invalidate_tenant_ai_manager(tenant_id: str) -> None:
    """Invalidate the cached AI manager for a tenant (async)."""
    async with _tenant_cache_lock:
        if tenant_id in _tenant_ai_managers:
            del _tenant_ai_managers[tenant_id]
            logger.debug("Invalidated AI manager cache for tenant", tenant_id=tenant_id)


async def get_tenant_ai_manager(tenant_id: str, db=None) -> AIManager:
    """
    Get AI manager for a tenant (async wrapper for backward compatibility).

    Args:
        tenant_id: The tenant ID
        db: Database connection (optional, for future use with tenant config)

    Returns:
        AIManager instance for the tenant
    """
    # In future, could load tenant config from db here
    return await get_ai_manager_for_tenant(tenant_id)
