"""Native provider adapters for the app-owned chat runtime."""

from __future__ import annotations

from collections.abc import Sequence as SequenceABC
from dataclasses import dataclass, field
import json
import re
from typing import Any, AsyncIterator, Optional

import anthropic
import httpx
import structlog
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from openai import AsyncOpenAI
from pydantic import TypeAdapter

logger = structlog.get_logger()

_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


@dataclass
class AdapterResponse:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    response_metadata: dict[str, Any] = field(default_factory=dict)

    def usage_metadata(self) -> dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class AdapterStructuredResponse(AdapterResponse):
    parsed: Any = None


@dataclass
class AdapterToolResponse(AdapterResponse):
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class AdapterStreamChunk:
    text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    response_metadata: dict[str, Any] = field(default_factory=dict)

    def usage_metadata(self) -> dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
        }


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
                    parts.append(json.dumps(item, ensure_ascii=True))
            else:
                parts.append(str(item))
        return "\n".join(part for part in parts if part)
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=True)
    return str(content)


def _normalize_messages(input_value: Any) -> list[Any]:
    if isinstance(input_value, BaseMessage):
        return [input_value]
    if isinstance(input_value, str):
        return [HumanMessage(content=input_value)]
    if isinstance(input_value, SequenceABC) and not isinstance(
        input_value, (str, bytes, bytearray)
    ):
        return list(input_value)
    return [HumanMessage(content=str(input_value))]


def _extract_json_from_text(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("```", 1)[1]
        if stripped.startswith("json"):
            stripped = stripped[4:]
        stripped = stripped.split("```", 1)[0].strip()
    return stripped


def _normalize_tool_call(
    tool_name: str, tool_args: Any, tool_call_id: str
) -> dict[str, Any]:
    return {
        "name": tool_name,
        "args": tool_args if isinstance(tool_args, dict) else {},
        "id": tool_call_id,
        "type": "tool_call",
    }


def _extract_openai_compat_tool_calls(
    raw_text: str,
) -> tuple[str, list[dict[str, Any]]]:
    pattern = re.compile(
        r"<function(?:=|\s+name=)(?P<name>[^>]+)>(?P<args>.*?)</function>",
        re.DOTALL | re.IGNORECASE,
    )
    tool_calls: list[dict[str, Any]] = []

    for index, match in enumerate(pattern.finditer(raw_text or "")):
        tool_name = match.group("name").strip().strip("\"'")
        args_text = match.group("args").strip()
        try:
            tool_args = json.loads(args_text) if args_text else {}
        except json.JSONDecodeError:
            tool_args = {}
        tool_calls.append(
            _normalize_tool_call(tool_name, tool_args, f"compat_tool_call_{index}")
        )

    cleaned_text = pattern.sub("", raw_text or "").strip()
    return cleaned_text, tool_calls


def _openai_usage_to_counts(usage: Any) -> tuple[int, int, int]:
    input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(
        getattr(usage, "total_tokens", input_tokens + output_tokens) or 0
    )
    return input_tokens, output_tokens, total_tokens


def _anthropic_usage_to_counts(usage: Any) -> tuple[int, int, int]:
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    total_tokens = input_tokens + output_tokens
    return input_tokens, output_tokens, total_tokens


def _gemini_usage_to_counts(usage: dict[str, Any]) -> tuple[int, int, int]:
    input_tokens = int(usage.get("promptTokenCount") or 0)
    output_tokens = int(usage.get("candidatesTokenCount") or 0)
    total_tokens = int(usage.get("totalTokenCount") or (input_tokens + output_tokens))
    return input_tokens, output_tokens, total_tokens


class OpenAICompatibleAdapter:
    def __init__(self, api_key: str, *, base_url: Optional[str] = None):
        kwargs: dict[str, Any] = {"api_key": api_key, "max_retries": 0}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = AsyncOpenAI(**kwargs)
        self._base_url = base_url
        self._supports_parse = base_url is None

    def _to_openai_messages(self, input_value: Any) -> list[dict[str, Any]]:
        messages = _normalize_messages(input_value)
        payload: list[dict[str, Any]] = []
        for message in messages:
            if isinstance(message, SystemMessage):
                payload.append(
                    {"role": "system", "content": _content_to_text(message.content)}
                )
                continue
            if isinstance(message, HumanMessage):
                payload.append(
                    {"role": "user", "content": _content_to_text(message.content)}
                )
                continue
            if isinstance(message, ToolMessage):
                payload.append(
                    {
                        "role": "tool",
                        "content": _content_to_text(message.content),
                        "tool_call_id": message.tool_call_id,
                    }
                )
                continue
            if isinstance(message, AIMessage):
                assistant_message: dict[str, Any] = {
                    "role": "assistant",
                    "content": _content_to_text(message.content) or None,
                }
                tool_calls = getattr(message, "tool_calls", None) or []
                if tool_calls:
                    assistant_message["tool_calls"] = [
                        {
                            "id": tool_call.get("id") or f"call_{index}",
                            "type": "function",
                            "function": {
                                "name": str(tool_call.get("name") or "tool"),
                                "arguments": json.dumps(
                                    tool_call.get("args") or {}, ensure_ascii=True
                                ),
                            },
                        }
                        for index, tool_call in enumerate(tool_calls)
                    ]
                payload.append(assistant_message)
                continue
            payload.append({"role": "user", "content": str(message)})
        return payload

    def _tool_choice(self, tool_choice: Any) -> Any:
        if tool_choice in (None, "auto"):
            return "auto"
        if tool_choice == "none":
            return "none"
        if isinstance(tool_choice, str):
            return {"type": "function", "function": {"name": tool_choice}}
        if isinstance(tool_choice, dict):
            function = tool_choice.get("function") or {}
            if function.get("name"):
                return {"type": "function", "function": {"name": function["name"]}}
            if tool_choice.get("name"):
                return {"type": "function", "function": {"name": tool_choice["name"]}}
        return "auto"

    def _build_request_kwargs(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> dict[str, Any]:
        request_kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "timeout": timeout_seconds,
        }
        if model.startswith(("o1", "o3", "o4")):
            request_kwargs["max_completion_tokens"] = max_tokens
        else:
            request_kwargs["temperature"] = temperature
            request_kwargs["max_tokens"] = max_tokens
            if stop:
                request_kwargs["stop"] = stop
        return request_kwargs

    async def complete_messages(
        self,
        input_value: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterResponse:
        messages = self._to_openai_messages(input_value)
        response = await self._client.chat.completions.create(
            **self._build_request_kwargs(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            )
        )
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice is not None else None
        text = _content_to_text(getattr(message, "content", ""))
        input_tokens, output_tokens, total_tokens = _openai_usage_to_counts(
            getattr(response, "usage", None)
        )
        return AdapterResponse(
            text=text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(response, "id", None),
                "model": getattr(response, "model", model),
                "finish_reason": getattr(choice, "finish_reason", None),
            },
        )

    async def stream_messages(
        self,
        input_value: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AsyncIterator[AdapterStreamChunk]:
        messages = self._to_openai_messages(input_value)
        stream = await self._client.chat.completions.create(
            **self._build_request_kwargs(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            ),
            stream=True,
            stream_options={"include_usage": True},
        )

        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            delta = getattr(choice, "delta", None)
            text = _content_to_text(getattr(delta, "content", "")) if delta else ""
            usage = getattr(chunk, "usage", None)
            input_tokens, output_tokens, total_tokens = _openai_usage_to_counts(usage)
            yield AdapterStreamChunk(
                text=text,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                response_metadata={"model": getattr(chunk, "model", model)},
            )

    async def complete_structured(
        self,
        input_value: Any,
        schema: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterStructuredResponse:
        messages = self._to_openai_messages(input_value)
        if self._supports_parse:
            response = await self._client.beta.chat.completions.parse(
                **self._build_request_kwargs(
                    messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stop=stop,
                    timeout_seconds=timeout_seconds,
                ),
                response_format=schema,
            )
            choice = response.choices[0]
            parsed_message = choice.message
            input_tokens, output_tokens, total_tokens = _openai_usage_to_counts(
                getattr(response, "usage", None)
            )
            return AdapterStructuredResponse(
                text=_content_to_text(getattr(parsed_message, "content", "")),
                parsed=getattr(parsed_message, "parsed", None),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                response_metadata={
                    "id": getattr(response, "id", None),
                    "model": getattr(response, "model", model),
                    "finish_reason": getattr(choice, "finish_reason", None),
                },
            )

        response = await self._client.chat.completions.create(
            **self._build_request_kwargs(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            ),
            response_format={"type": "json_object"},
        )
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice is not None else None
        text = _content_to_text(getattr(message, "content", ""))
        parsed = TypeAdapter(schema).validate_json(_extract_json_from_text(text))
        input_tokens, output_tokens, total_tokens = _openai_usage_to_counts(
            getattr(response, "usage", None)
        )
        return AdapterStructuredResponse(
            text=text,
            parsed=parsed,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(response, "id", None),
                "model": getattr(response, "model", model),
                "finish_reason": getattr(choice, "finish_reason", None),
            },
        )

    async def complete_with_tools(
        self,
        input_value: Any,
        tool_specs: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        tool_choice: Any = "auto",
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterToolResponse:
        messages = self._to_openai_messages(input_value)
        openai_tools = [
            {
                "type": "function",
                "function": {
                    "name": spec["name"],
                    "description": spec.get("description", ""),
                    "parameters": spec.get(
                        "parameters", {"type": "object", "properties": {}}
                    ),
                },
            }
            for spec in tool_specs
        ]
        response = await self._client.chat.completions.create(
            **self._build_request_kwargs(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            ),
            tools=openai_tools,
            tool_choice=self._tool_choice(tool_choice),
            parallel_tool_calls=False,
        )
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice is not None else None
        parsed_tool_calls: list[dict[str, Any]] = []
        raw_text = _content_to_text(getattr(message, "content", ""))
        for index, tool_call in enumerate(getattr(message, "tool_calls", []) or []):
            function = getattr(tool_call, "function", None)
            try:
                args = json.loads(getattr(function, "arguments", "{}") or "{}")
            except json.JSONDecodeError:
                args = {}
            parsed_tool_calls.append(
                _normalize_tool_call(
                    tool_name=str(getattr(function, "name", "tool")),
                    tool_args=args,
                    tool_call_id=str(getattr(tool_call, "id", f"call_{index}")),
                )
            )
        text = raw_text
        if not parsed_tool_calls and raw_text:
            text, parsed_tool_calls = _extract_openai_compat_tool_calls(raw_text)
        input_tokens, output_tokens, total_tokens = _openai_usage_to_counts(
            getattr(response, "usage", None)
        )
        return AdapterToolResponse(
            text=text,
            tool_calls=parsed_tool_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(response, "id", None),
                "model": getattr(response, "model", model),
                "finish_reason": getattr(choice, "finish_reason", None),
            },
        )


class AnthropicAdapter:
    def __init__(self, api_key: str):
        self._client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=0)

    def _to_anthropic_payload(
        self, input_value: Any
    ) -> tuple[Optional[str], list[dict[str, Any]]]:
        messages = _normalize_messages(input_value)
        system_parts: list[str] = []
        payload: list[dict[str, Any]] = []

        for message in messages:
            if isinstance(message, SystemMessage):
                text = _content_to_text(message.content)
                if text:
                    system_parts.append(text)
                continue
            if isinstance(message, HumanMessage):
                payload.append(
                    {"role": "user", "content": _content_to_text(message.content)}
                )
                continue
            if isinstance(message, ToolMessage):
                payload.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": message.tool_call_id,
                                "content": _content_to_text(message.content),
                            }
                        ],
                    }
                )
                continue
            if isinstance(message, AIMessage):
                blocks: list[dict[str, Any]] = []
                text = _content_to_text(message.content)
                if text:
                    blocks.append({"type": "text", "text": text})
                for index, tool_call in enumerate(
                    getattr(message, "tool_calls", None) or []
                ):
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": str(tool_call.get("id") or f"tool_use_{index}"),
                            "name": str(tool_call.get("name") or "tool"),
                            "input": tool_call.get("args") or {},
                        }
                    )
                payload.append({"role": "assistant", "content": blocks or text or ""})
                continue
            payload.append({"role": "user", "content": str(message)})

        system_text = "\n\n".join(part for part in system_parts if part) or None
        return system_text, payload

    def _request_kwargs(
        self,
        *,
        input_value: Any,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> dict[str, Any]:
        system_text, messages = self._to_anthropic_payload(input_value)
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "timeout": timeout_seconds,
        }
        if system_text:
            kwargs["system"] = system_text
        if stop:
            kwargs["stop_sequences"] = stop
        if not model.startswith("claude-opus-4"):
            kwargs["temperature"] = temperature
        return kwargs

    async def complete_messages(
        self,
        input_value: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterResponse:
        response = await self._client.messages.create(
            **self._request_kwargs(
                input_value=input_value,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            )
        )
        text = "".join(
            getattr(block, "text", "")
            for block in getattr(response, "content", [])
            if getattr(block, "type", None) == "text"
        )
        input_tokens, output_tokens, total_tokens = _anthropic_usage_to_counts(
            getattr(response, "usage", None)
        )
        return AdapterResponse(
            text=text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(response, "id", None),
                "model": getattr(response, "model", model),
                "stop_reason": getattr(response, "stop_reason", None),
            },
        )

    async def stream_messages(
        self,
        input_value: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AsyncIterator[AdapterStreamChunk]:
        async with self._client.messages.stream(
            **self._request_kwargs(
                input_value=input_value,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            )
        ) as stream:
            async for event in stream:
                if event.type == "text":
                    yield AdapterStreamChunk(text=event.text)
            final_message = await stream.get_final_message()

        input_tokens, output_tokens, total_tokens = _anthropic_usage_to_counts(
            getattr(final_message, "usage", None)
        )
        yield AdapterStreamChunk(
            text="",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(final_message, "id", None),
                "model": getattr(final_message, "model", model),
                "stop_reason": getattr(final_message, "stop_reason", None),
            },
        )

    async def complete_structured(
        self,
        input_value: Any,
        schema: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterStructuredResponse:
        async with self._client.messages.stream(
            **self._request_kwargs(
                input_value=input_value,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            ),
            output_format=schema,
        ) as stream:
            final_message = await stream.get_final_message()

        parsed = None
        text_parts: list[str] = []
        for block in getattr(final_message, "content", []) or []:
            if getattr(block, "type", None) == "text":
                text_parts.append(getattr(block, "text", ""))
                parsed = parsed or getattr(block, "parsed_output", None)

        input_tokens, output_tokens, total_tokens = _anthropic_usage_to_counts(
            getattr(final_message, "usage", None)
        )
        return AdapterStructuredResponse(
            text="".join(text_parts),
            parsed=parsed,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(final_message, "id", None),
                "model": getattr(final_message, "model", model),
                "stop_reason": getattr(final_message, "stop_reason", None),
            },
        )

    async def complete_with_tools(
        self,
        input_value: Any,
        tool_specs: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        tool_choice: Any = "auto",
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterToolResponse:
        anthropic_tools = [
            {
                "name": spec["name"],
                "description": spec.get("description", ""),
                "input_schema": spec.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
            for spec in tool_specs
        ]
        anthropic_tool_choice: Any = {"type": "auto"}
        if isinstance(tool_choice, str) and tool_choice not in ("auto", "none"):
            anthropic_tool_choice = {"type": "tool", "name": tool_choice}
        if isinstance(tool_choice, dict):
            function = tool_choice.get("function") or {}
            name = function.get("name") or tool_choice.get("name")
            if name:
                anthropic_tool_choice = {"type": "tool", "name": name}

        response = await self._client.messages.create(
            **self._request_kwargs(
                input_value=input_value,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop,
                timeout_seconds=timeout_seconds,
            ),
            tools=anthropic_tools,
            tool_choice=anthropic_tool_choice,
        )
        text = "".join(
            getattr(block, "text", "")
            for block in getattr(response, "content", [])
            if getattr(block, "type", None) == "text"
        )
        tool_calls = [
            _normalize_tool_call(
                tool_name=str(getattr(block, "name", "tool")),
                tool_args=getattr(block, "input", {}) or {},
                tool_call_id=str(getattr(block, "id", f"tool_use_{index}")),
            )
            for index, block in enumerate(getattr(response, "content", []))
            if getattr(block, "type", None) == "tool_use"
        ]
        input_tokens, output_tokens, total_tokens = _anthropic_usage_to_counts(
            getattr(response, "usage", None)
        )
        return AdapterToolResponse(
            text=text,
            tool_calls=tool_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "id": getattr(response, "id", None),
                "model": getattr(response, "model", model),
                "stop_reason": getattr(response, "stop_reason", None),
            },
        )


class GeminiAdapter:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def _to_gemini_payload(
        self, input_value: Any
    ) -> tuple[Optional[dict[str, Any]], list[dict[str, Any]]]:
        messages = _normalize_messages(input_value)
        system_parts: list[dict[str, Any]] = []
        contents: list[dict[str, Any]] = []
        tool_names_by_id: dict[str, str] = {}

        for message in messages:
            if isinstance(message, SystemMessage):
                text = _content_to_text(message.content)
                if text:
                    system_parts.append({"text": text})
                continue
            if isinstance(message, HumanMessage):
                contents.append(
                    {
                        "role": "user",
                        "parts": [{"text": _content_to_text(message.content)}],
                    }
                )
                continue
            if isinstance(message, ToolMessage):
                tool_name = tool_names_by_id.get(message.tool_call_id, "tool")
                contents.append(
                    {
                        "role": "user",
                        "parts": [
                            {
                                "functionResponse": {
                                    "name": tool_name,
                                    "response": {
                                        "content": json.loads(
                                            _content_to_text(message.content) or "{}"
                                        )
                                        if _content_to_text(message.content)
                                        .strip()
                                        .startswith(("{", "["))
                                        else {
                                            "content": _content_to_text(message.content)
                                        }
                                    },
                                }
                            }
                        ],
                    }
                )
                continue
            if isinstance(message, AIMessage):
                parts: list[dict[str, Any]] = []
                text = _content_to_text(message.content)
                if text:
                    parts.append({"text": text})
                for index, tool_call in enumerate(
                    getattr(message, "tool_calls", None) or []
                ):
                    tool_call_id = str(tool_call.get("id") or f"tool_call_{index}")
                    tool_name = str(tool_call.get("name") or "tool")
                    tool_names_by_id[tool_call_id] = tool_name
                    parts.append(
                        {
                            "functionCall": {
                                "name": tool_name,
                                "args": tool_call.get("args") or {},
                            }
                        }
                    )
                contents.append({"role": "model", "parts": parts or [{"text": text}]})
                continue
            contents.append({"role": "user", "parts": [{"text": str(message)}]})

        system_instruction = {"parts": system_parts} if system_parts else None
        return system_instruction, contents

    async def _post(
        self,
        endpoint: str,
        body: dict[str, Any],
        *,
        timeout_seconds: int,
    ) -> dict[str, Any]:
        url = f"{_GEMINI_BASE_URL}/models/{endpoint}"
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, params={"key": self.api_key}, json=body)
            response.raise_for_status()
            return response.json()

    async def complete_messages(
        self,
        input_value: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterResponse:
        system_instruction, contents = self._to_gemini_payload(input_value)
        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
        if stop:
            generation_config["stopSequences"] = stop
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": generation_config,
        }
        if system_instruction:
            body["systemInstruction"] = system_instruction
        payload = await self._post(
            f"{model}:generateContent",
            body,
            timeout_seconds=timeout_seconds,
        )
        candidate = (payload.get("candidates") or [{}])[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(str(part.get("text", "")) for part in parts if part is not None)
        input_tokens, output_tokens, total_tokens = _gemini_usage_to_counts(
            payload.get("usageMetadata") or {}
        )
        return AdapterResponse(
            text=text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "model": model,
                "finish_reason": candidate.get("finishReason"),
            },
        )

    async def stream_messages(
        self,
        input_value: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AsyncIterator[AdapterStreamChunk]:
        system_instruction, contents = self._to_gemini_payload(input_value)
        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
        if stop:
            generation_config["stopSequences"] = stop
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": generation_config,
        }
        if system_instruction:
            body["systemInstruction"] = system_instruction

        url = f"{_GEMINI_BASE_URL}/models/{model}:streamGenerateContent"
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            async with client.stream(
                "POST",
                url,
                params={"key": self.api_key, "alt": "sse"},
                json=body,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = json.loads(line[5:].strip())
                    candidate = (payload.get("candidates") or [{}])[0]
                    parts = (candidate.get("content") or {}).get("parts") or []
                    text = "".join(
                        str(part.get("text", "")) for part in parts if part is not None
                    )
                    input_tokens, output_tokens, total_tokens = _gemini_usage_to_counts(
                        payload.get("usageMetadata") or {}
                    )
                    yield AdapterStreamChunk(
                        text=text,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        total_tokens=total_tokens,
                        response_metadata={
                            "model": model,
                            "finish_reason": candidate.get("finishReason"),
                        },
                    )

    async def complete_structured(
        self,
        input_value: Any,
        schema: Any,
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterStructuredResponse:
        system_instruction, contents = self._to_gemini_payload(input_value)
        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
            "responseSchema": TypeAdapter(schema).json_schema(),
        }
        if stop:
            generation_config["stopSequences"] = stop
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": generation_config,
        }
        if system_instruction:
            body["systemInstruction"] = system_instruction

        payload = await self._post(
            f"{model}:generateContent",
            body,
            timeout_seconds=timeout_seconds,
        )
        candidate = (payload.get("candidates") or [{}])[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(str(part.get("text", "")) for part in parts if part is not None)
        parsed = TypeAdapter(schema).validate_json(_extract_json_from_text(text))
        input_tokens, output_tokens, total_tokens = _gemini_usage_to_counts(
            payload.get("usageMetadata") or {}
        )
        return AdapterStructuredResponse(
            text=text,
            parsed=parsed,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "model": model,
                "finish_reason": candidate.get("finishReason"),
            },
        )

    async def complete_with_tools(
        self,
        input_value: Any,
        tool_specs: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        tool_choice: Any = "auto",
        stop: Optional[list[str]] = None,
        timeout_seconds: int = 60,
    ) -> AdapterToolResponse:
        system_instruction, contents = self._to_gemini_payload(input_value)
        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
        if stop:
            generation_config["stopSequences"] = stop

        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": generation_config,
            "tools": [
                {
                    "functionDeclarations": [
                        {
                            "name": spec["name"],
                            "description": spec.get("description", ""),
                            "parameters": spec.get(
                                "parameters", {"type": "object", "properties": {}}
                            ),
                        }
                        for spec in tool_specs
                    ]
                }
            ],
            "toolConfig": {"functionCallingConfig": {"mode": "AUTO"}},
        }
        if isinstance(tool_choice, str) and tool_choice not in ("auto", "none"):
            body["toolConfig"] = {
                "functionCallingConfig": {
                    "mode": "ANY",
                    "allowedFunctionNames": [tool_choice],
                }
            }
        if system_instruction:
            body["systemInstruction"] = system_instruction

        payload = await self._post(
            f"{model}:generateContent",
            body,
            timeout_seconds=timeout_seconds,
        )
        candidate = (payload.get("candidates") or [{}])[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(str(part.get("text", "")) for part in parts if part is not None)
        tool_calls: list[dict[str, Any]] = []
        for index, part in enumerate(parts):
            function_call = part.get("functionCall") if isinstance(part, dict) else None
            if not function_call:
                continue
            tool_calls.append(
                _normalize_tool_call(
                    tool_name=str(function_call.get("name") or "tool"),
                    tool_args=function_call.get("args") or {},
                    tool_call_id=str(function_call.get("id") or f"tool_call_{index}"),
                )
            )

        input_tokens, output_tokens, total_tokens = _gemini_usage_to_counts(
            payload.get("usageMetadata") or {}
        )
        return AdapterToolResponse(
            text=text,
            tool_calls=tool_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            response_metadata={
                "model": model,
                "finish_reason": candidate.get("finishReason"),
            },
        )


def create_provider_adapter(provider_id: str, api_key: str) -> Any:
    if provider_id == "openai":
        return OpenAICompatibleAdapter(api_key)
    if provider_id == "groq":
        return OpenAICompatibleAdapter(api_key, base_url=_GROQ_BASE_URL)
    if provider_id == "anthropic":
        return AnthropicAdapter(api_key)
    if provider_id == "gemini":
        return GeminiAdapter(api_key)
    raise ValueError(f"Unsupported provider adapter: {provider_id}")
