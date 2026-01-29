"""
Consolidated AI Manager with Enhanced LangChain Integration
Manages multiple AI providers with intelligent fallback and cost optimization
"""

from typing import List, Dict, Any, Optional, Tuple
from decimal import Decimal
import structlog
import asyncio

from app.core.config import settings
from app.ai.providers.base import BaseAIProvider, AIProvider
from app.ai.providers.openai_provider import OpenAIProvider
from app.ai.providers.groq_provider import GroqProvider
from app.ai.providers.gemini_provider import GeminiProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.core.exceptions import AIProviderError

logger = structlog.get_logger()

# Cache for tenant-specific AI managers
_tenant_ai_managers: Dict[str, "AIManager"] = {}


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
            "YOUR_",
            "sk_test_",
            "api_key",
            "API_KEY",
            "placeholder",
            "PLACEHOLDER",
            "dummy",
            "test_key",
        ]
        return not any(placeholder in key.lower() for placeholder in placeholders)

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
                self.providers[AIProvider.OPENAI] = OpenAIProvider(openai_key)
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
                self.providers[AIProvider.GROQ] = GroqProvider(groq_key)
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
                self.providers[AIProvider.GEMINI] = GeminiProvider(gemini_key)
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
        if preferred_provider and preferred_provider in self.providers:
            providers_to_try.append(preferred_provider)

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

    async def extract_text_from_content(
        self,
        content: str,
        file_type: str,
        preferred_provider: Optional[str] = None,
    ) -> str:
        """Extract text using best available provider with fallback"""
        provider = await self.get_best_provider(
            task_type="text_extraction",
            preferred_provider=preferred_provider,
        )

        try:
            return await provider.extract_text_from_content(content, file_type)
        except Exception as e:
            logger.error(
                "Text extraction failed with provider",
                provider=provider.provider_name,
                error=str(e),
            )

            # Try fallback providers
            for provider_name, fallback_provider in self.providers.items():
                if fallback_provider != provider:
                    try:
                        logger.info(
                            "Trying fallback provider for text extraction",
                            fallback=provider_name,
                        )
                        return await fallback_provider.extract_text_from_content(
                            content, file_type
                        )
                    except Exception as fallback_error:
                        logger.warning(
                            "Fallback provider also failed",
                            fallback=provider_name,
                            error=str(fallback_error),
                        )
                        continue

            raise AIProviderError(
                f"Text extraction failed with all providers: {str(e)}"
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
        provider = await self.get_best_provider(
            task_type="question_generation",
            preferred_provider=preferred_provider,
        )

        try:
            return await provider.generate_questions(
                text_content=text_content,
                subject=subject,
                topic=topic,
                question_count=question_count,
                difficulty=difficulty,
                question_types=question_types or [QuestionType.MULTIPLE_CHOICE],
            )
        except Exception as e:
            logger.error(
                "Question generation failed with provider",
                provider=provider.provider_name,
                error=str(e),
            )

            # Try fallback providers
            for provider_name, fallback_provider in self.providers.items():
                if fallback_provider != provider:
                    try:
                        logger.info(
                            "Trying fallback provider for question generation",
                            fallback=provider_name,
                        )
                        return await fallback_provider.generate_questions(
                            text_content=text_content,
                            subject=subject,
                            topic=topic,
                            question_count=question_count,
                            difficulty=difficulty,
                            question_types=question_types
                            or [QuestionType.MULTIPLE_CHOICE],
                        )
                    except Exception as fallback_error:
                        logger.warning(
                            "Fallback provider also failed",
                            fallback=provider_name,
                            error=str(fallback_error),
                        )
                        continue

            raise AIProviderError(
                f"Question generation failed with all providers: {str(e)}"
            )

    async def validate_question(
        self,
        question: QuestionCreate,
        preferred_provider: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Validate question using best available provider with fallback"""
        provider = await self.get_best_provider(
            task_type="question_validation",
            preferred_provider=preferred_provider,
        )

        try:
            return await provider.validate_question(question)
        except Exception as e:
            logger.error(
                "Question validation failed with provider",
                provider=provider.provider_name,
                error=str(e),
            )

            # Try fallback providers
            for provider_name, fallback_provider in self.providers.items():
                if fallback_provider != provider:
                    try:
                        logger.info(
                            "Trying fallback provider for question validation",
                            fallback=provider_name,
                        )
                        return await fallback_provider.validate_question(question)
                    except Exception as fallback_error:
                        logger.warning(
                            "Fallback provider also failed",
                            fallback=provider_name,
                            error=str(fallback_error),
                        )
                        continue

            raise AIProviderError(
                f"Question validation failed with all providers: {str(e)}"
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
        combined_content = f"RAG Context:\n{rag_context}\n\nOriginal Content:\n{text_content}"
        
        return await self.generate_questions(
            text_content=combined_content,
            subject=subject,
            topic=topic,
            question_count=question_count,
            difficulty=difficulty,
            question_types=question_types,
            preferred_provider=preferred_provider,
        )
    
    async def set_provider_model(
        self,
        provider_name: str,
        model_name: str
    ) -> bool:
        """Set the model for a specific provider"""
        if provider_name in self.providers:
            provider = self.providers[provider_name]
            if hasattr(provider, 'model_name'):
                provider.model_name = model_name
                logger.info("Set provider model", provider=provider_name, model=model_name)
                return True
        return False
    
    def get_available_models(self, provider_name: Optional[str] = None) -> Dict[str, List[str]]:
        """Get available models for providers"""
        # This would be implemented based on each provider's capabilities
        return {
            "openai": [
                "gpt-4o",
                "gpt-4o-mini",
                "gpt-4-turbo",
                "gpt-3.5-turbo",
            ],
            "groq": [
                "mixtral-8x7b-32768",
                "llama3-70b-8192",
                "llama3-8b-8192",
            ],
            "gemini": [
                "gemini-1.5-pro",
                "gemini-1.5-flash",
                "gemini-pro",
            ],
        }


def get_ai_manager_for_tenant(
    tenant_id: str,
    tenant_config: Optional[Dict[str, Any]] = None,
) -> AIManager:
    """Get or create AI manager for a specific tenant"""
    if tenant_id not in _tenant_ai_managers:
        _tenant_ai_managers[tenant_id] = AIManager(tenant_config=tenant_config)
    return _tenant_ai_managers[tenant_id]


def create_ai_manager(
    ai_settings: Optional[Dict[str, Any]] = None,
    tenant_config: Optional[Dict[str, Any]] = None,
) -> AIManager:
    """Create a new AI manager instance"""
    return AIManager(ai_settings=ai_settings, tenant_config=tenant_config)


def get_default_ai_manager() -> AIManager:
    """Get the default AI manager"""
    return create_ai_manager()


def invalidate_tenant_ai_manager(tenant_id: str) -> None:
    """Invalidate the cached AI manager for a tenant"""
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
    return get_ai_manager_for_tenant(tenant_id)
