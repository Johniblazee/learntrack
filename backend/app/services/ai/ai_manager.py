"""
AI Manager for handling multiple AI providers with LangChain integration
Supports per-tenant configuration for dynamic model selection
"""

from typing import List, Dict, Any, Optional
from decimal import Decimal
import structlog

from app.core.config import settings
from app.services.ai.base import BaseAIProvider, AIProvider
from app.services.ai.openai_provider import OpenAIProvider
from app.services.ai.groq_provider import GroqProvider
from app.services.ai.gemini_provider import GeminiProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.core.exceptions import AIProviderError

logger = structlog.get_logger()

# Cache for tenant-specific AI managers
_tenant_ai_managers: Dict[str, "AIManager"] = {}


class AIManager:
    """Manager for multiple AI providers with LangChain integration"""

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
            "xxx",
            "XXX",
            "<",
            ">",
        ]
        for placeholder in placeholders:
            if placeholder in key and provider != "clerk":  # Allow clerk test keys
                return False
        # Check minimum key length (most API keys are > 20 chars)
        return len(key) > 20

    def _initialize_providers(self):
        """Initialize available AI providers, respecting tenant configuration"""
        # Get enabled providers from tenant config (if available)
        enabled_providers = self._get_enabled_providers()

        openai_key = self._get_api_key("openai") or settings.OPENAI_API_KEY
        anthropic_key = self._get_api_key("anthropic") or settings.ANTHROPIC_API_KEY
        google_key = self._get_api_key("google") or settings.GOOGLE_API_KEY
        groq_key = self._get_api_key("groq") or settings.GROQ_API_KEY
        gemini_key = self._get_api_key("gemini") or settings.GEMINI_API_KEY

        # Set default provider from tenant config or ai_settings
        if self.tenant_config and self.tenant_config.get("default_provider"):
            self.default_provider = self.tenant_config["default_provider"]
        elif self.ai_settings.get("default_provider"):
            self.default_provider = self.ai_settings["default_provider"]

        # OpenAI - only initialize if enabled and has valid key
        if self._is_provider_enabled(
            "openai", enabled_providers
        ) and self._is_valid_api_key(openai_key, "openai"):
            try:
                self.providers[AIProvider.OPENAI] = OpenAIProvider(openai_key)
                logger.info("OpenAI provider initialized")
            except Exception as e:
                logger.error("Failed to initialize OpenAI provider", error=str(e))
        elif openai_key and self._is_provider_enabled("openai", enabled_providers):
            logger.warning(
                "OpenAI API key appears to be a placeholder, skipping initialization"
            )

        # Groq (LangChain) - only initialize if enabled and has valid key
        if self._is_provider_enabled(
            "groq", enabled_providers
        ) and self._is_valid_api_key(groq_key, "groq"):
            try:
                self.providers[AIProvider.GROQ] = GroqProvider(groq_key)
                logger.info("Groq provider initialized")
            except Exception as e:
                logger.error("Failed to initialize Groq provider", error=str(e))
        elif groq_key and self._is_provider_enabled("groq", enabled_providers):
            logger.warning(
                "Groq API key appears to be a placeholder, skipping initialization"
            )

        # Gemini (LangChain) - only initialize if enabled and has valid key
        if self._is_provider_enabled(
            "gemini", enabled_providers
        ) and self._is_valid_api_key(gemini_key, "gemini"):
            try:
                self.providers[AIProvider.GEMINI] = GeminiProvider(gemini_key)
                logger.info("Gemini provider initialized")
            except Exception as e:
                logger.error("Failed to initialize Gemini provider", error=str(e))
        elif gemini_key and self._is_provider_enabled("gemini", enabled_providers):
            logger.warning(
                "Gemini API key appears to be a placeholder, skipping initialization"
            )

        # Anthropic (placeholder)
        if self._is_provider_enabled(
            "anthropic", enabled_providers
        ) and self._is_valid_api_key(anthropic_key, "anthropic"):
            logger.info("Anthropic provider available but not implemented")

        # Google (placeholder - use Gemini instead)
        if google_key and not gemini_key:
            logger.info("Google API key found - use GEMINI_API_KEY for Gemini models")

        # Set default provider to first available if current default is not available
        if self.default_provider not in self.providers and self.providers:
            self.default_provider = next(iter(self.providers.keys()))
            logger.info(
                "Default provider set to first available",
                provider=self.default_provider,
            )

        if not self.providers:
            logger.warning("No AI providers initialized - check your API keys in .env")

    def _get_enabled_providers(self) -> Optional[List[str]]:
        """Get list of enabled providers from tenant config"""
        if self.tenant_config:
            return self.tenant_config.get("enabled_providers")
        return None

    def _is_provider_enabled(
        self, provider_id: str, enabled_providers: Optional[List[str]]
    ) -> bool:
        """Check if a provider is enabled for this tenant"""
        # If no tenant config, all providers are enabled by default
        if enabled_providers is None:
            return True
        return provider_id in enabled_providers

    def _get_api_key(self, provider: str) -> Optional[str]:
        """Get API key for provider from database settings"""
        if not self.ai_settings:
            return None

        provider_settings = self.ai_settings.get("providers", {}).get(provider, {})
        return (
            provider_settings.get("api_key")
            if provider_settings.get("enabled")
            else None
        )

    def get_provider(self, provider_name: Optional[str] = None) -> BaseAIProvider:
        """Get AI provider by name or default"""
        if provider_name is None:
            provider_name = self.default_provider

        # Normalize provider_name to string for comparison
        provider_str = (
            provider_name.value
            if isinstance(provider_name, AIProvider)
            else str(provider_name).lower()
        )

        # Try to find the provider (handles both enum and string keys)
        for key, provider in self.providers.items():
            key_str = key.value if isinstance(key, AIProvider) else str(key).lower()
            if key_str == provider_str:
                return provider

        # Provider not found
        available = [
            k.value if isinstance(k, AIProvider) else str(k)
            for k in self.providers.keys()
        ]
        raise AIProviderError(
            f"Provider '{provider_name}' not available. Available providers: {available}",
            str(provider_name),
        )

    def get_available_providers(self) -> List[str]:
        """Get list of available providers"""
        return list(self.providers.keys())

    async def extract_text_from_content(
        self, content: str, file_type: str, provider_name: Optional[str] = None
    ) -> str:
        """Extract text using specified or default provider"""
        provider = self.get_provider(provider_name)
        return await provider.extract_text_from_content(content, file_type)

    async def generate_questions(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        provider_name: Optional[str] = None,
        tenant_id: Optional[str] = None,
        cost_service=None,
    ) -> List[QuestionCreate]:
        """Generate questions using specified or default provider with cost tracking"""
        provider = self.get_provider(provider_name)

        # Track cost if cost service is available
        if cost_service and tenant_id:
            # Estimate tokens and cost
            estimated_input_tokens = len(text_content.split()) * 1.3  # Rough estimate
            estimated_output_tokens = (
                question_count * 100
            )  # Rough estimate for questions

            from app.services.cost_tracking_service import MODEL_COSTS

            provider_name_for_cost = provider.provider.value
            model_name = (
                provider.model_name if hasattr(provider, "model_name") else "unknown"
            )

            estimated_cost = Decimal("0.01")  # Placeholder estimation

            # Check quota
            allowed, reason = await cost_service.check_quota(tenant_id, estimated_cost)
            if not allowed:
                raise AIProviderError(f"AI quota exceeded: {reason}")

        # Generate questions
        questions = await provider.generate_questions(
            text_content, subject, topic, question_count, difficulty, question_types
        )

        # Track actual cost if cost service is available
        if cost_service and tenant_id and questions:
            from app.models.cost_tracking import CostProvider, CostModel
            from decimal import Decimal

            # This is a simplified tracking - real implementation would get actual token counts
            actual_input_tokens = len(text_content.split()) * 1.3
            actual_output_tokens = len(questions) * 50  # Estimate tokens per question

            await cost_service.track_usage(
                tenant_id=tenant_id,
                provider=CostProvider(provider_name_for_cost),
                model=CostModel(model_name),
                input_tokens=int(actual_input_tokens),
                output_tokens=int(actual_output_tokens),
                operation="question_generation",
                metadata={
                    "question_count": len(questions),
                    "subject": subject,
                    "topic": topic,
                    "difficulty": difficulty.value,
                },
            )

        return questions

    async def validate_question(
        self, question: QuestionCreate, provider_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Validate question using specified or default provider"""
        provider = self.get_provider(provider_name)
        return await provider.validate_question(question)

    async def health_check_all(self) -> Dict[str, bool]:
        """Check health of all providers"""
        results = {}
        for provider_name, provider in self.providers.items():
            try:
                results[provider_name] = await provider.health_check()
            except Exception as e:
                logger.error(f"Health check failed for {provider_name}", error=str(e))
                results[provider_name] = False

        return results

    async def generate_questions_with_fallback(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        preferred_provider: Optional[str] = None,
    ) -> tuple[List[QuestionCreate], str]:
        """Generate questions with fallback to other providers if primary fails"""
        providers_to_try = []

        # Add preferred provider first
        if preferred_provider and preferred_provider in self.providers:
            providers_to_try.append(preferred_provider)

        # Add other providers as fallbacks
        for provider_name in self.providers.keys():
            if provider_name not in providers_to_try:
                providers_to_try.append(provider_name)

        last_error = None
        for provider_name in providers_to_try:
            try:
                logger.info(f"Attempting question generation with {provider_name}")
                questions = await self.generate_questions(
                    text_content,
                    subject,
                    topic,
                    question_count,
                    difficulty,
                    question_types,
                    provider_name,
                )

                if questions:
                    logger.info(
                        f"Successfully generated {len(questions)} questions with {provider_name}"
                    )
                    return questions, provider_name

            except Exception as e:
                last_error = e
                logger.warning(
                    f"Question generation failed with {provider_name}", error=str(e)
                )
                continue

        # If all providers failed
        if last_error:
            raise AIProviderError(
                f"All providers failed. Last error: {str(last_error)}"
            )
        else:
            raise AIProviderError("No questions generated by any provider")

    def get_available_models(self, provider_name: str) -> Dict[str, Dict[str, Any]]:
        """Get available models for a specific provider"""
        if provider_name == AIProvider.GROQ or provider_name == "groq":
            return {}
        elif provider_name == AIProvider.GEMINI or provider_name == "gemini":
            return {}
        elif provider_name == AIProvider.OPENAI or provider_name == "openai":
            return {
                "gpt-5.2": {
                    "context_window": 128000,
                    "description": "GPT-5.2 - Most capable",
                },
                "gpt-5.2-mini": {
                    "context_window": 128000,
                    "description": "GPT-5.2 Mini - Fast and affordable",
                },
                "gpt-4o": {
                    "context_window": 128000,
                    "description": "GPT-4o - Versatile model",
                },
                "gpt-4o-mini": {
                    "context_window": 128000,
                    "description": "GPT-4o Mini - Fast and affordable",
                },
                "gpt-4-turbo": {
                    "context_window": 128000,
                    "description": "GPT-4 Turbo - High performance",
                },
            }
        return {}

    def set_provider_model(self, provider_name: str, model: str):
        """Set the model for a specific provider"""
        provider = self.get_provider(provider_name)
        if hasattr(provider, "set_model"):
            provider.set_model(model)
        else:
            logger.warning(f"Provider {provider_name} does not support model switching")

    async def generate_questions_with_rag(
        self,
        text_content: str,
        rag_context: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        provider_name: Optional[str] = None,
    ) -> List[QuestionCreate]:
        """Generate questions using RAG-enhanced context"""
        combined_content = f"""
RETRIEVED CONTEXT FROM DOCUMENTS:
{rag_context}

ADDITIONAL CONTENT:
{text_content}
"""
        return await self.generate_questions(
            combined_content,
            subject,
            topic,
            question_count,
            difficulty,
            question_types,
            provider_name,
        )


# Global AI manager instance (default, no tenant config)
ai_manager = AIManager()


async def get_tenant_ai_manager(
    tenant_id: str, db=None, force_refresh: bool = False
) -> AIManager:
    """
    Get or create an AIManager instance for a specific tenant.
    Uses caching to avoid recreating managers for each request.

    Args:
        tenant_id: The tenant's clerk_id
        db: MongoDB database instance (optional, will import if needed)
        force_refresh: Force reload of tenant configuration

    Returns:
        AIManager configured for the tenant
    """
    global _tenant_ai_managers

    # Return cached manager if available and not forcing refresh
    if not force_refresh and tenant_id in _tenant_ai_managers:
        return _tenant_ai_managers[tenant_id]

    # Import here to avoid circular imports
    from app.services.tenant_ai_config_service import TenantAIConfigService

    tenant_config = None

    if db is not None:
        try:
            service = TenantAIConfigService(db)
            config = await service.get_or_create_default(tenant_id)
            if config:
                tenant_config = config.model_dump()
                logger.info("Loaded tenant AI config", tenant_id=tenant_id)
        except Exception as e:
            logger.warning(
                "Failed to load tenant AI config, using defaults",
                tenant_id=tenant_id,
                error=str(e),
            )

    # Create new manager with tenant config
    manager = AIManager(tenant_config=tenant_config)
    _tenant_ai_managers[tenant_id] = manager

    return manager


def invalidate_tenant_ai_manager(tenant_id: str) -> None:
    """
    Invalidate cached AIManager for a tenant.
    Call this when tenant configuration changes.
    """
    global _tenant_ai_managers
    if tenant_id in _tenant_ai_managers:
        del _tenant_ai_managers[tenant_id]
        logger.info("Invalidated tenant AI manager cache", tenant_id=tenant_id)


def clear_all_tenant_ai_managers() -> None:
    """Clear all cached tenant AI managers"""
    global _tenant_ai_managers
    _tenant_ai_managers.clear()
    logger.info("Cleared all tenant AI manager caches")
