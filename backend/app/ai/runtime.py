"""App-owned runtime backed by custom provider adapters."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence as SequenceABC
from dataclasses import asdict, dataclass
import inspect
import json
import re
from typing import Any, AsyncIterator, Optional, Sequence, get_args, get_origin

import anthropic
import httpx
import openai
import structlog
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from pydantic import TypeAdapter

from app.ai.custom_adapters import (
    AdapterResponse,
    AdapterStreamChunk,
    AdapterStructuredResponse,
    AdapterToolResponse,
    create_provider_adapter,
)
from app.core.ai_models_config import get_model_capabilities
from app.core.exceptions import (
    AIAuthenticationError,
    AIBadRequestError,
    AIConnectionError,
    AIContentPolicyViolationError,
    AIContextWindowExceededError,
    AIProviderError,
    AIRateLimitError,
    AIServiceUnavailableError,
    AITimeoutError,
)

logger = structlog.get_logger()


def _exception_types(*candidates: Any) -> tuple[type[BaseException], ...]:
    return tuple(candidate for candidate in candidates if isinstance(candidate, type))


_AUTH_EXCEPTIONS = _exception_types(
    getattr(openai, "AuthenticationError", None),
    getattr(anthropic, "AuthenticationError", None),
    getattr(anthropic, "PermissionDeniedError", None),
)

_BAD_REQUEST_EXCEPTIONS = _exception_types(
    getattr(openai, "BadRequestError", None),
    getattr(anthropic, "BadRequestError", None),
)

_RATE_LIMIT_EXCEPTIONS = _exception_types(
    getattr(openai, "RateLimitError", None),
    getattr(anthropic, "RateLimitError", None),
)

_TIMEOUT_EXCEPTIONS = _exception_types(
    getattr(openai, "APITimeoutError", None),
    getattr(anthropic, "APITimeoutError", None),
    httpx.TimeoutException,
)

_CONNECTION_EXCEPTIONS = _exception_types(
    getattr(openai, "APIConnectionError", None),
    getattr(anthropic, "APIConnectionError", None),
    httpx.ConnectError,
)

_SERVICE_EXCEPTIONS = _exception_types(
    getattr(openai, "InternalServerError", None),
    getattr(anthropic, "InternalServerError", None),
)

_NON_RETRYABLE_EXCEPTIONS = tuple(
    exc
    for exc in (
        getattr(openai, "AuthenticationError", None),
        getattr(openai, "BadRequestError", None),
        getattr(anthropic, "AuthenticationError", None),
        getattr(anthropic, "BadRequestError", None),
        getattr(anthropic, "PermissionDeniedError", None),
    )
    if exc is not None
)

_RETRYABLE_EXCEPTIONS = tuple(
    exc
    for exc in (
        getattr(openai, "APIConnectionError", None),
        getattr(openai, "APITimeoutError", None),
        getattr(openai, "RateLimitError", None),
        getattr(openai, "InternalServerError", None),
        getattr(anthropic, "APIConnectionError", None),
        getattr(anthropic, "APITimeoutError", None),
        getattr(anthropic, "RateLimitError", None),
        getattr(anthropic, "InternalServerError", None),
        httpx.ConnectError,
        httpx.TimeoutException,
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


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                else:
                    parts.append(json.dumps(item))
            else:
                parts.append(str(item))
        return "\n".join(part for part in parts if part)
    if isinstance(content, dict):
        return json.dumps(content)
    return str(content)


def _serialize_message(message: Any) -> str:
    if isinstance(message, BaseMessage):
        role = message.__class__.__name__.replace("Message", "") or "Message"
        text = _content_to_text(getattr(message, "content", ""))

        tool_calls = getattr(message, "tool_calls", None) or []
        if tool_calls:
            text = (
                f"{text}\nTool Calls:\n{json.dumps(tool_calls, ensure_ascii=True)}"
                if text
                else f"Tool Calls:\n{json.dumps(tool_calls, ensure_ascii=True)}"
            )

        tool_call_id = getattr(message, "tool_call_id", None)
        if tool_call_id:
            text = (
                f"Tool Call ID: {tool_call_id}\n{text}"
                if text
                else f"Tool Call ID: {tool_call_id}"
            )

        return f"{role}:\n{text}" if text else f"{role}:"

    if isinstance(message, dict):
        role = str(message.get("role") or "message").title()
        content = _content_to_text(message.get("content", ""))
        return f"{role}:\n{content}" if content else f"{role}:"

    return str(message)


def _serialize_input(input_value: Any) -> str:
    if isinstance(input_value, str):
        return input_value
    if isinstance(input_value, BaseMessage):
        return _serialize_message(input_value)
    if isinstance(input_value, SequenceABC) and not isinstance(
        input_value, (str, bytes, bytearray)
    ):
        serialized = [_serialize_message(item) for item in input_value]
        return "\n\n".join(part for part in serialized if part)
    return str(input_value)


def _extract_json_candidate(text: str) -> str:
    if "```json" in text:
        return text.split("```json", 1)[1].split("```", 1)[0].strip()
    if "```" in text:
        return text.split("```", 1)[1].split("```", 1)[0].strip()

    match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def _sanitize_json_string(content: str) -> str:
    try:
        json.loads(content)
        return content
    except json.JSONDecodeError:
        pass

    def fix_escapes(match: re.Match[str]) -> str:
        s = match.group(0)
        result: list[str] = []
        i = 0
        while i < len(s):
            if s[i] == "\\":
                if i + 1 < len(s):
                    next_char = s[i + 1]
                    if next_char in '"\\bfnrtu/':
                        result.append(s[i : i + 2])
                        i += 2
                        continue
                    result.append("\\\\")
                    i += 1
                    continue
                result.append("\\\\")
                i += 1
                continue
            result.append(s[i])
            i += 1
        return "".join(result)

    return re.sub(r'"([^"\\]*(?:\\.[^"\\]*)*)"', fix_escapes, content)


def _annotation_to_json_schema(annotation: Any) -> tuple[dict[str, Any], bool]:
    if annotation is inspect.Signature.empty:
        return {"type": "string"}, False

    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is Optional:
        inner = next((arg for arg in args if arg is not type(None)), str)
        schema, _ = _annotation_to_json_schema(inner)
        return schema, True
    if origin in (list, Sequence):
        inner = args[0] if args else str
        item_schema, _ = _annotation_to_json_schema(inner)
        return {"type": "array", "items": item_schema}, False
    if origin is not None and type(None) in args:
        inner = next((arg for arg in args if arg is not type(None)), str)
        schema, _ = _annotation_to_json_schema(inner)
        return schema, True
    if annotation is int:
        return {"type": "integer"}, False
    if annotation is float:
        return {"type": "number"}, False
    if annotation is bool:
        return {"type": "boolean"}, False
    return {"type": "string"}, False


def _tool_to_spec(tool: Any) -> dict[str, Any]:
    if isinstance(tool, dict):
        if tool.get("type") == "function" and isinstance(tool.get("function"), dict):
            function = tool["function"]
            return {
                "name": function.get("name", "tool"),
                "description": function.get("description", ""),
                "parameters": function.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
        return {
            "name": tool.get("name", "tool"),
            "description": tool.get("description", ""),
            "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
        }

    signature = inspect.signature(tool)
    properties: dict[str, Any] = {}
    required: list[str] = []
    for parameter in signature.parameters.values():
        if parameter.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        ):
            continue
        schema, optional = _annotation_to_json_schema(parameter.annotation)
        properties[parameter.name] = schema
        if parameter.default is inspect.Signature.empty and not optional:
            required.append(parameter.name)

    return {
        "name": getattr(tool, "__name__", "tool"),
        "description": inspect.getdoc(tool) or "Application tool",
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    }


def _response_to_ai_message(
    response: AdapterResponse,
    *,
    tool_calls: Optional[list[dict[str, Any]]] = None,
    content_override: Optional[str] = None,
) -> AIMessage:
    usage_metadata = response.usage_metadata()
    return AIMessage(
        content=content_override if content_override is not None else response.text,
        tool_calls=tool_calls or [],
        usage_metadata=usage_metadata,
        response_metadata=response.response_metadata,
    )


class AIChatRuntime:
    """App-owned chat runtime used across providers."""

    def __init__(
        self,
        *,
        provider_id: str,
        model_id: str,
        provider_model: str,
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
        self.provider_model = provider_model
        self.upstream_model = self._resolve_upstream_model(model_id, provider_model)
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_base_delay_seconds = retry_base_delay_seconds
        self.retry_max_delay_seconds = retry_max_delay_seconds
        self.capabilities = get_model_capabilities(provider_id, model_id)
        self._usage = UsageSnapshot()
        self._adapter = base_model or create_provider_adapter(provider_id, api_key)

    @staticmethod
    def _resolve_upstream_model(model_id: str, provider_model: str) -> str:
        if provider_model and "/" in provider_model:
            return provider_model.split("/", 1)[1]
        return model_id or provider_model

    def get_usage_snapshot(self) -> UsageSnapshot:
        return UsageSnapshot(**self._usage.as_dict())

    def consume_usage_snapshot(self) -> UsageSnapshot:
        snapshot = self.get_usage_snapshot()
        self._usage = UsageSnapshot()
        return snapshot

    def _backoff_seconds(self, attempt_index: int) -> float:
        return min(
            self.retry_base_delay_seconds * (2 ** max(attempt_index - 1, 0)),
            self.retry_max_delay_seconds,
        )

    def _record_usage_values(self, input_tokens: int, output_tokens: int) -> None:
        total_tokens = input_tokens + output_tokens
        if total_tokens <= 0:
            return
        self._usage.request_count += 1
        self._usage.input_tokens += max(input_tokens, 0)
        self._usage.output_tokens += max(output_tokens, 0)
        self._usage.total_tokens += max(total_tokens, 0)

    def _record_usage_from_response(self, response: AdapterResponse) -> None:
        self._record_usage_values(response.input_tokens, response.output_tokens)

    def _require_capability(self, capability: str, message: str) -> None:
        if getattr(self.capabilities, capability, False):
            return
        raise AIProviderError(message, provider=self.provider_id)

    def _map_bad_request(self, message: str) -> AIProviderError:
        lowered = message.lower()
        if any(
            fragment in lowered
            for fragment in (
                "context window",
                "maximum context",
                "too many tokens",
                "context length",
                "prompt is too long",
            )
        ):
            return AIContextWindowExceededError(
                message=message, provider=self.provider_id
            )
        if any(
            fragment in lowered
            for fragment in ("safety", "policy", "content_filter", "refusal", "blocked")
        ):
            return AIContentPolicyViolationError(
                message=message, provider=self.provider_id
            )
        return AIBadRequestError(message=message, provider=self.provider_id)

    def _map_exception(self, exc: Exception) -> AIProviderError:
        if isinstance(exc, AIProviderError):
            return exc
        if _AUTH_EXCEPTIONS and isinstance(exc, _AUTH_EXCEPTIONS):
            return AIAuthenticationError(message=str(exc), provider=self.provider_id)
        if _RATE_LIMIT_EXCEPTIONS and isinstance(exc, _RATE_LIMIT_EXCEPTIONS):
            return AIRateLimitError(message=str(exc), provider=self.provider_id)
        if _TIMEOUT_EXCEPTIONS and isinstance(exc, _TIMEOUT_EXCEPTIONS):
            return AITimeoutError(message=str(exc), provider=self.provider_id)
        if _CONNECTION_EXCEPTIONS and isinstance(exc, _CONNECTION_EXCEPTIONS):
            return AIConnectionError(message=str(exc), provider=self.provider_id)
        if _SERVICE_EXCEPTIONS and isinstance(exc, _SERVICE_EXCEPTIONS):
            return AIServiceUnavailableError(
                message=str(exc), provider=self.provider_id
            )
        if _BAD_REQUEST_EXCEPTIONS and isinstance(exc, _BAD_REQUEST_EXCEPTIONS):
            return self._map_bad_request(str(exc))
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            message = exc.response.text or str(exc)
            if status in (401, 403):
                return AIAuthenticationError(message=message, provider=self.provider_id)
            if status == 429:
                return AIRateLimitError(message=message, provider=self.provider_id)
            if status >= 500:
                return AIServiceUnavailableError(
                    message=message, provider=self.provider_id
                )
            return self._map_bad_request(message)
        if isinstance(exc, asyncio.TimeoutError):
            return AITimeoutError(
                message=str(exc) or "Request timed out", provider=self.provider_id
            )
        return AIProviderError(message=str(exc), provider=self.provider_id)

    def _can_fallback_to_prompt_mode(self, exc: Exception) -> bool:
        mapped = self._map_exception(exc)
        return not isinstance(
            mapped,
            (
                AIAuthenticationError,
                AIRateLimitError,
                AITimeoutError,
                AIConnectionError,
                AIServiceUnavailableError,
                AIContentPolicyViolationError,
            ),
        )

    def _is_retryable_exception(self, exc: Exception) -> bool:
        if isinstance(
            exc,
            (
                AIRateLimitError,
                AITimeoutError,
                AIConnectionError,
                AIServiceUnavailableError,
            ),
        ):
            return True
        if isinstance(
            exc,
            (
                AIAuthenticationError,
                AIBadRequestError,
                AIContextWindowExceededError,
                AIContentPolicyViolationError,
            ),
        ):
            return False
        if _NON_RETRYABLE_EXCEPTIONS and isinstance(exc, _NON_RETRYABLE_EXCEPTIONS):
            return False
        if _RETRYABLE_EXCEPTIONS and isinstance(exc, _RETRYABLE_EXCEPTIONS):
            return True

        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            if status == 429 or status >= 500:
                return True
            return False

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
            "overloaded",
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
                    raise self._map_exception(exc) from exc

                delay = self._backoff_seconds(attempt)
                logger.warning(
                    "Retrying custom LLM call",
                    provider=self.provider_id,
                    model=self.model_id,
                    attempt=attempt + 1,
                    max_retries=self.max_retries,
                    delay_seconds=delay,
                    error=str(exc),
                )
                await asyncio.sleep(delay)

        if last_error is not None:
            raise self._map_exception(last_error) from last_error

    async def _complete(
        self,
        prompt: str,
        *,
        stop: Optional[list[str]] = None,
        timeout_seconds: Optional[int] = None,
    ) -> AdapterResponse:
        return await self._call_with_retry(
            self._adapter.complete,
            prompt,
            model=self.upstream_model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            stop=stop,
            timeout_seconds=timeout_seconds or self.timeout_seconds,
        )

    async def ainvoke(
        self,
        input: Any,
        config: Optional[dict[str, Any]] = None,
        *,
        stop: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> AIMessage:
        timeout_seconds = int(kwargs.get("timeout") or self.timeout_seconds)
        if hasattr(self._adapter, "complete_messages"):
            response = await self._call_with_retry(
                self._adapter.complete_messages,
                input,
                model=self.upstream_model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            )
        else:
            prompt = _serialize_input(input)
            response = await self._complete(
                prompt, stop=stop, timeout_seconds=timeout_seconds
            )
        self._record_usage_from_response(response)
        return _response_to_ai_message(response)

    async def astream(
        self,
        input: Any,
        config: Optional[dict[str, Any]] = None,
        *,
        stop: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> AsyncIterator[AIMessageChunk]:
        timeout_seconds = int(kwargs.get("timeout") or self.timeout_seconds)
        if not hasattr(self._adapter, "stream_messages"):
            prompt = _serialize_input(input)
            response = await self._complete(
                prompt, stop=stop, timeout_seconds=timeout_seconds
            )
            self._record_usage_from_response(response)
            yield AIMessageChunk(
                content=response.text,
                response_metadata=response.response_metadata,
                usage_metadata=response.usage_metadata(),
            )
            return

        last_usage: Optional[AdapterStreamChunk] = None
        for attempt in range(self.max_retries + 1):
            yielded_chunks = False
            try:
                async for chunk in self._adapter.stream_messages(
                    input,
                    model=self.upstream_model,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    stop=stop,
                    timeout_seconds=timeout_seconds,
                ):
                    yielded_chunks = True
                    if chunk.total_tokens:
                        last_usage = chunk
                    yield AIMessageChunk(
                        content=chunk.text,
                        response_metadata=chunk.response_metadata,
                        usage_metadata=chunk.usage_metadata()
                        if chunk.total_tokens
                        else None,
                    )
                if last_usage is not None:
                    self._record_usage_values(
                        last_usage.input_tokens, last_usage.output_tokens
                    )
                return
            except Exception as exc:
                if (
                    yielded_chunks
                    or not self._is_retryable_exception(exc)
                    or attempt >= self.max_retries
                ):
                    raise self._map_exception(exc) from exc
                delay = self._backoff_seconds(attempt)
                logger.warning(
                    "Retrying custom LLM stream before first chunk",
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

        timeout_seconds = int(kwargs.get("timeout") or self.timeout_seconds)
        if hasattr(self._adapter, "complete_structured"):
            try:
                response: AdapterStructuredResponse = await self._call_with_retry(
                    self._adapter.complete_structured,
                    input,
                    schema,
                    model=self.upstream_model,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    stop=kwargs.get("stop"),
                    timeout_seconds=timeout_seconds,
                )
                self._record_usage_from_response(response)
                raw_message = _response_to_ai_message(response)
                parsing_error = (
                    None
                    if response.parsed is not None
                    else ValueError("Provider returned no structured output")
                )
                if include_raw:
                    return {
                        "raw": raw_message,
                        "parsed": response.parsed,
                        "parsing_error": parsing_error,
                    }
                if parsing_error is not None:
                    raise parsing_error
                return response.parsed
            except Exception as exc:
                if not self._can_fallback_to_prompt_mode(exc):
                    raise self._map_exception(exc) from exc
                logger.warning(
                    "Native structured output failed, falling back to prompt JSON mode",
                    provider=self.provider_id,
                    model=self.model_id,
                    error=str(exc),
                )

        base_prompt = _serialize_input(input)
        schema_json = json.dumps(TypeAdapter(schema).json_schema(), ensure_ascii=True)
        structured_prompt = (
            f"{base_prompt}\n\n"
            "Return only valid JSON that matches this JSON schema exactly. "
            "Do not include markdown fences or any commentary.\n"
            f"JSON Schema:\n{schema_json}"
        )

        raw_message = await self.ainvoke(
            structured_prompt,
            config=config,
            stop=kwargs.get("stop"),
            timeout=kwargs.get("timeout"),
        )

        parsed: Any = None
        parsing_error: Optional[Exception] = None
        try:
            candidate = _extract_json_candidate(raw_message.content)
            adapter = TypeAdapter(schema)
            try:
                parsed = adapter.validate_json(candidate)
            except Exception:
                parsed = adapter.validate_json(_sanitize_json_string(candidate))
        except Exception as exc:
            parsing_error = exc

        if include_raw:
            return {
                "raw": raw_message,
                "parsed": parsed,
                "parsing_error": parsing_error,
            }
        if parsing_error is not None:
            raise parsing_error
        return parsed

    async def ainvoke_with_tools(
        self,
        input: Any,
        tools: Sequence[Any],
        config: Optional[dict[str, Any]] = None,
        *,
        tool_choice: Optional[Any] = "auto",
        **kwargs: Any,
    ) -> AIMessage:
        self._require_capability(
            "supports_tools",
            f"Model '{self.model_id}' does not support tool calling.",
        )

        tool_specs = [_tool_to_spec(tool) for tool in tools]
        timeout_seconds = int(kwargs.get("timeout") or self.timeout_seconds)
        if hasattr(self._adapter, "complete_with_tools"):
            try:
                response: AdapterToolResponse = await self._call_with_retry(
                    self._adapter.complete_with_tools,
                    input,
                    tool_specs,
                    model=self.upstream_model,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    tool_choice=tool_choice,
                    stop=kwargs.get("stop"),
                    timeout_seconds=timeout_seconds,
                )
                self._record_usage_from_response(response)
                return AIMessage(
                    content=response.text,
                    tool_calls=response.tool_calls,
                    usage_metadata=response.usage_metadata(),
                    response_metadata=response.response_metadata,
                )
            except Exception as exc:
                if not self._can_fallback_to_prompt_mode(exc):
                    raise self._map_exception(exc) from exc
                logger.warning(
                    "Native tool calling failed, falling back to prompt tool mode",
                    provider=self.provider_id,
                    model=self.model_id,
                    error=str(exc),
                )

        base_prompt = _serialize_input(input)
        tool_prompt = (
            f"{base_prompt}\n\n"
            "Available tools:\n"
            f"{json.dumps(tool_specs, ensure_ascii=True)}\n\n"
            "Return only valid JSON with this shape:\n"
            '{"tool_calls": [{"name": "tool_name", "arguments": {}}], "content": "final assistant reply"}\n\n'
            "Rules:\n"
            "- If a tool is needed, include one or more tool_calls and keep content empty or brief.\n"
            "- If no tool is needed, set tool_calls to an empty array and put the final reply in content.\n"
            "- Never invent tool names or arguments outside the provided schemas.\n"
            f"- tool_choice is {json.dumps(tool_choice, ensure_ascii=True)}."
        )

        raw_message = await self.ainvoke(
            tool_prompt,
            config=config,
            stop=kwargs.get("stop"),
            timeout=kwargs.get("timeout"),
        )

        content = raw_message.content
        tool_calls: list[dict[str, Any]] = []
        try:
            payload = json.loads(
                _sanitize_json_string(_extract_json_candidate(raw_message.content))
            )
            if isinstance(payload, dict):
                content = str(payload.get("content") or "")
                raw_tool_calls = payload.get("tool_calls") or []
                if isinstance(raw_tool_calls, list):
                    for index, item in enumerate(raw_tool_calls):
                        if not isinstance(item, dict):
                            continue
                        tool_calls.append(
                            {
                                "name": str(item.get("name") or ""),
                                "args": item.get("arguments") or item.get("args") or {},
                                "id": str(item.get("id") or f"tool_call_{index}"),
                                "type": "tool_call",
                            }
                        )
        except Exception as exc:
            logger.warning(
                "Failed to parse tool call response, returning plain text",
                provider=self.provider_id,
                model=self.model_id,
                error=str(exc),
            )

        return AIMessage(
            content=content,
            tool_calls=tool_calls,
            usage_metadata=raw_message.usage_metadata,
            response_metadata=raw_message.response_metadata,
        )


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
    """Persist accumulated runtime usage to the existing cost tracker."""

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
            "tracked_via": "custom_ai_runtime",
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
