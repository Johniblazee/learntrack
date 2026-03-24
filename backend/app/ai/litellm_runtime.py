"""
LiteLLM runtime wrapper with app-level retries, capability checks, and usage capture.

This keeps LiteLLM as the provider abstraction layer while giving the app a
stable interface for:
- consistent retry behavior
- structured outputs
- tool calling
- token usage aggregation for downstream cost tracking
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Any, AsyncIterator, Optional, Sequence

import litellm
import structlog
from langchain_community.chat_models import ChatLiteLLM
from langchain_core.messages import BaseMessage
from langchain_core.messages.utils import message_chunk_to_message

from app.core.ai_models_config import get_model_capabilities
from app.core.exceptions import AIProviderError

logger = structlog.get_logger()

_NON_RETRYABLE_EXCEPTIONS = tuple(
    exc
    for exc in (
        getattr(litellm, "AuthenticationError", None),
        getattr(litellm, "BadRequestError", None),
        getattr(litellm, "ContentPolicyViolationError", None),
        getattr(litellm, "ContextWindowExceededError", None),
    )
    if exc is not None
)

_RETRYABLE_EXCEPTIONS = tuple(
    exc
    for exc in (
        getattr(litellm, "APIConnectionError", None),
        getattr(litellm, "Timeout", None),
        getattr(litellm, "RateLimitError", None),
        getattr(litellm, "ServiceUnavailableError", None),
        getattr(litellm, "InternalServerError", None),
    )
    if exc is not None
)


@dataclass
class UsageSnapshot:
    request_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


class LiteLLMRuntime:
    """Small app-owned wrapper around ChatLiteLLM."""

    def __init__(
        self,
        *,
        provider_id: str,
        model_id: str,
        litellm_model: str,
        api_key: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        timeout_seconds: int = 60,
        max_retries: int = 2,
        retry_base_delay_seconds: float = 0.75,
        retry_max_delay_seconds: float = 4.0,
        base_model: Optional[Any] = None,
    ):
        self.provider_id = provider_id
        self.model_id = model_id
        self.litellm_model = litellm_model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_base_delay_seconds = retry_base_delay_seconds
        self.retry_max_delay_seconds = retry_max_delay_seconds
        self.capabilities = get_model_capabilities(provider_id, model_id)
        self._usage = UsageSnapshot()

        self._model = base_model or ChatLiteLLM(
            model=litellm_model,
            api_key=api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            streaming=True,
            timeout=timeout_seconds,
            num_retries=0,
            drop_params=True,
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._model, name)

    def get_usage_snapshot(self) -> UsageSnapshot:
        return UsageSnapshot(**self._usage.as_dict())

    def consume_usage_snapshot(self) -> UsageSnapshot:
        snapshot = self.get_usage_snapshot()
        self._usage = UsageSnapshot()
        return snapshot

    def _prepare_kwargs(
        self, kwargs: dict[str, Any], *, stream: bool = False
    ) -> dict[str, Any]:
        prepared = dict(kwargs)
        prepared.setdefault("timeout", self.timeout_seconds)
        prepared.setdefault("drop_params", True)
        if stream:
            stream_options = dict(prepared.get("stream_options") or {})
            stream_options.setdefault("include_usage", True)
            prepared["stream_options"] = stream_options
        return prepared

    def _backoff_seconds(self, attempt_index: int) -> float:
        return min(
            self.retry_base_delay_seconds * (2 ** max(attempt_index - 1, 0)),
            self.retry_max_delay_seconds,
        )

    def _is_retryable_exception(self, exc: Exception) -> bool:
        if _NON_RETRYABLE_EXCEPTIONS and isinstance(exc, _NON_RETRYABLE_EXCEPTIONS):
            return False
        if _RETRYABLE_EXCEPTIONS and isinstance(exc, _RETRYABLE_EXCEPTIONS):
            return True

        message = str(exc).lower()
        retryable_fragments = (
            "rate limit",
            "too many requests",
            "timed out",
            "timeout",
            "connection",
            "temporarily unavailable",
            "service unavailable",
            "internal server error",
            "bad gateway",
            "gateway timeout",
        )
        return any(fragment in message for fragment in retryable_fragments)

    async def _call_with_retry(self, call, *args: Any, **kwargs: Any) -> Any:
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                return await call(*args, **kwargs)
            except Exception as exc:
                last_error = exc
                if not self._is_retryable_exception(exc) or attempt >= self.max_retries:
                    raise

                delay = self._backoff_seconds(attempt)
                logger.warning(
                    "Retrying LiteLLM call",
                    provider=self.provider_id,
                    model=self.model_id,
                    attempt=attempt + 1,
                    max_retries=self.max_retries,
                    delay_seconds=delay,
                    error=str(exc),
                )
                await asyncio.sleep(delay)

        if last_error is not None:
            raise last_error

    def _record_usage_values(self, input_tokens: int, output_tokens: int) -> None:
        total_tokens = input_tokens + output_tokens
        if total_tokens <= 0:
            return

        self._usage.request_count += 1
        self._usage.input_tokens += max(input_tokens, 0)
        self._usage.output_tokens += max(output_tokens, 0)
        self._usage.total_tokens += max(total_tokens, 0)

    def _record_usage_from_message(self, message: Optional[BaseMessage]) -> None:
        if message is None:
            return

        input_tokens, output_tokens = self._extract_usage_values(message)
        self._record_usage_values(input_tokens, output_tokens)

    def _extract_usage_values(self, message: BaseMessage) -> tuple[int, int]:
        usage = getattr(message, "usage_metadata", None) or {}
        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(
            usage.get("output_tokens") or usage.get("completion_tokens") or 0
        )

        if input_tokens or output_tokens:
            return input_tokens, output_tokens

        response_metadata = getattr(message, "response_metadata", None) or {}
        token_usage = (
            response_metadata.get("token_usage")
            or response_metadata.get("usage")
            or response_metadata.get("usage_metadata")
            or {}
        )

        input_tokens = int(
            token_usage.get("prompt_tokens") or token_usage.get("input_tokens") or 0
        )
        output_tokens = int(
            token_usage.get("completion_tokens")
            or token_usage.get("output_tokens")
            or 0
        )
        return input_tokens, output_tokens

    def _require_capability(self, capability: str, message: str) -> None:
        if getattr(self.capabilities, capability, False):
            return
        raise AIProviderError(message, provider=self.provider_id)

    async def ainvoke(
        self,
        input: Any,
        config: Optional[dict[str, Any]] = None,
        *,
        stop: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> BaseMessage:
        response = await self._call_with_retry(
            self._model.ainvoke,
            input,
            config=config,
            stop=stop,
            **self._prepare_kwargs(kwargs),
        )
        self._record_usage_from_message(response)
        return response

    async def astream(
        self,
        input: Any,
        config: Optional[dict[str, Any]] = None,
        *,
        stop: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> AsyncIterator[BaseMessage]:
        prepared_kwargs = self._prepare_kwargs(kwargs, stream=True)

        for attempt in range(self.max_retries + 1):
            yielded_chunks = False
            last_chunk: Optional[BaseMessage] = None
            usage_candidate: Optional[tuple[int, int]] = None
            try:
                async for chunk in self._model.astream(
                    input,
                    config=config,
                    stop=stop,
                    **prepared_kwargs,
                ):
                    yielded_chunks = True
                    last_chunk = chunk
                    input_tokens, output_tokens = self._extract_usage_values(chunk)
                    if input_tokens or output_tokens:
                        usage_candidate = (input_tokens, output_tokens)
                    yield chunk

                if usage_candidate is not None:
                    self._record_usage_values(*usage_candidate)
                elif last_chunk is not None:
                    self._record_usage_from_message(
                        message_chunk_to_message(last_chunk)
                    )
                return
            except Exception as exc:
                if (
                    yielded_chunks
                    or not self._is_retryable_exception(exc)
                    or attempt >= self.max_retries
                ):
                    raise

                delay = self._backoff_seconds(attempt)
                logger.warning(
                    "Retrying LiteLLM stream before first chunk",
                    provider=self.provider_id,
                    model=self.model_id,
                    attempt=attempt + 1,
                    max_retries=self.max_retries,
                    delay_seconds=delay,
                    error=str(exc),
                )
                await asyncio.sleep(delay)

    async def ainvoke_structured(
        self,
        input: Any,
        schema: Any,
        config: Optional[dict[str, Any]] = None,
        *,
        include_raw: bool = False,
        **kwargs: Any,
    ) -> Any:
        self._require_capability(
            "supports_structured_output",
            f"Model '{self.model_id}' does not support structured outputs.",
        )
        self._require_capability(
            "supports_tools",
            f"Model '{self.model_id}' does not support tool-based structured outputs.",
        )

        runnable = self._model.with_structured_output(schema, include_raw=True)
        result = await self._call_with_retry(
            runnable.ainvoke,
            input,
            config=config,
            **self._prepare_kwargs(kwargs),
        )

        raw_message = result.get("raw") if isinstance(result, dict) else None
        self._record_usage_from_message(raw_message)

        parsing_error = (
            result.get("parsing_error") if isinstance(result, dict) else None
        )
        if parsing_error is not None:
            raise parsing_error

        if include_raw:
            return result
        return result.get("parsed") if isinstance(result, dict) else result

    async def ainvoke_with_tools(
        self,
        input: Any,
        tools: Sequence[Any],
        config: Optional[dict[str, Any]] = None,
        *,
        tool_choice: Optional[Any] = "auto",
        **kwargs: Any,
    ) -> BaseMessage:
        self._require_capability(
            "supports_tools",
            f"Model '{self.model_id}' does not support tool calling.",
        )

        runnable = self._model.bind_tools(tools, tool_choice=tool_choice)
        response = await self._call_with_retry(
            runnable.ainvoke,
            input,
            config=config,
            **self._prepare_kwargs(kwargs),
        )
        self._record_usage_from_message(response)
        return response


async def persist_usage_snapshot(
    *,
    database: Any,
    llm: Any,
    tenant_id: str,
    provider_id: str,
    model_id: str,
    operation: str,
    metadata: Optional[dict[str, Any]] = None,
) -> Any:
    """Persist accumulated LiteLLM usage to the existing cost tracker."""

    if not hasattr(llm, "consume_usage_snapshot"):
        return None

    snapshot = llm.consume_usage_snapshot()
    if snapshot.total_tokens <= 0:
        return None

    from app.ai.services.cost_tracker import CostTrackingService

    service = CostTrackingService(database)
    payload = dict(metadata or {})
    payload.update(
        {
            "request_count": snapshot.request_count,
            "tracked_via": "litellm_runtime",
            "total_tokens": snapshot.total_tokens,
        }
    )

    return await service.track_usage(
        tenant_id=tenant_id,
        provider=provider_id,
        model=model_id,
        input_tokens=snapshot.input_tokens,
        output_tokens=snapshot.output_tokens,
        operation=operation,
        metadata=payload,
    )
