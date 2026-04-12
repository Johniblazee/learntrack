"""Planning chat endpoints: /chat and /chat-with-tools."""

import json
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.core.dependencies import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.exceptions import AIProviderError

from ._shared import (
    ChatRequest,
    ChatResponse,
    ToolCallTrace,
    ToolChatResponse,
    build_session_chat_message,
    chat_config_to_session_config,
    check_generation_readiness,
    coerce_response_text,
    get_missing_generation_fields,
    get_missing_generation_fields_from_values,
    get_saved_ai_defaults,
    get_session_service,
    list_enabled_models,
    normalize_provider,
    persist_qg_usage,
    resolve_tenant_llm_provider,
    _create_generation_session_service,
    _create_tenant_config_service,
)

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Native tool-planning helpers
# ---------------------------------------------------------------------------

async def _execute_native_planning_tool(
    *,
    tool_name: str,
    tool_args: Dict[str, Any],
    request: ChatRequest,
    current_user: ClerkUserContext,
    database: AsyncIOMotorDatabase,
) -> Dict[str, Any]:
    if tool_name == "check_generation_readiness":
        missing_fields = get_missing_generation_fields_from_values(
            subject=tool_args.get("subject") or request.subject,
            topic=tool_args.get("topic") or request.topic,
            question_types=tool_args.get("question_types") or request.question_types,
            question_count=tool_args.get("question_count") or request.question_count,
        )
        return {
            "ready_to_generate": len(missing_fields) == 0,
            "missing_fields": missing_fields,
            "difficulty": tool_args.get("difficulty") or "medium",
        }

    if tool_name == "list_enabled_models":
        service = _create_tenant_config_service(database)
        providers = await service.get_tutor_provider_status(current_user.tutor_id)
        requested_provider = tool_args.get("provider_id") or request.ai_provider
        provider_filter = (
            normalize_provider(requested_provider) if requested_provider else None
        )
        filtered = [
            provider
            for provider in providers
            if provider_filter is None or provider.provider_id == provider_filter
        ]
        return {
            "providers": [
                {
                    "provider_id": provider.provider_id,
                    "name": provider.name,
                    "available": provider.available,
                    "key_source": provider.key_source,
                    "models": [
                        {
                            "model_id": model.model_id,
                            "name": model.name,
                            "context_window": model.context_window,
                        }
                        for model in provider.models
                    ],
                }
                for provider in filtered
            ]
        }

    if tool_name == "get_saved_ai_defaults":
        service = _create_tenant_config_service(database)
        config = await service.get_or_create_default(current_user.tutor_id)
        return {
            "default_provider": config.default_provider,
            "default_model": config.default_model,
            "allow_custom_api_keys": config.allow_custom_api_keys,
        }

    return {"error": f"Unsupported tool '{tool_name}'"}


async def _run_native_tool_planning_chat(
    *,
    llm: Any,
    messages: List[Any],
    request: ChatRequest,
    current_user: ClerkUserContext,
    database: AsyncIOMotorDatabase,
    max_rounds: int = 2,
) -> tuple[Any, List[ToolCallTrace]]:
    tools = [check_generation_readiness, list_enabled_models, get_saved_ai_defaults]
    working_messages: List[Any] = list(messages)
    traces: List[ToolCallTrace] = []

    for _ in range(max_rounds):
        ai_message = await llm.ainvoke_with_tools(
            working_messages, tools=tools, tool_choice="auto"
        )
        tool_calls = getattr(ai_message, "tool_calls", None) or []
        if not tool_calls:
            return ai_message, traces

        tool_messages: List[ToolMessage] = []
        for tool_call in tool_calls:
            tool_name = str(tool_call.get("name") or "")
            tool_args = tool_call.get("args") or {}
            result = await _execute_native_planning_tool(
                tool_name=tool_name,
                tool_args=tool_args,
                request=request,
                current_user=current_user,
                database=database,
            )
            traces.append(
                ToolCallTrace(name=tool_name, arguments=tool_args, result=result)
            )
            tool_messages.append(
                ToolMessage(
                    content=json.dumps(result),
                    tool_call_id=str(tool_call.get("id") or uuid.uuid4()),
                )
            )

        working_messages.extend([ai_message, *tool_messages])

    fallback_text = (
        "I checked your current planning setup and gathered the latest AI settings. "
        "Please refine your request or try again."
    )
    return AIMessage(content=fallback_text), traces


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def chat_about_question_generation(
    request: ChatRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Fast chat endpoint for planning requirements before running generation."""
    try:
        ai_provider, model_name, llm = await resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=request.ai_provider,
            requested_model=request.model_name,
        )

        missing_fields = get_missing_generation_fields(request)
        ready_to_generate = len(missing_fields) == 0
        planning_message = request.message.strip()
        if not planning_message:
            raise HTTPException(status_code=400, detail="Message cannot be empty")

        session_service = _create_generation_session_service(database)
        session = None
        if request.session_id:
            session = await session_service.get_session(
                request.session_id, current_user.clerk_id
            )

        session_config = chat_config_to_session_config(request)
        if not session:
            session = await session_service.create_session(
                user_id=current_user.clerk_id,
                tenant_id=current_user.tutor_id,
                prompt=planning_message,
                config=session_config,
                material_ids=[],
            )
        else:
            await session_service.update_session(
                session.session_id,
                current_user.clerk_id,
                config=session_config,
                original_prompt=session.original_prompt or planning_message,
            )

        await session_service.append_chat_message(
            session.session_id,
            current_user.clerk_id,
            build_session_chat_message("user", planning_message),
        )

        system_prompt = (
            "You are an AI teaching assistant helping a tutor plan question generation. "
            "Respond conversationally and concisely. Do not start generating questions yet. "
            "Help the tutor clarify requirements (subject, topic, question types, count, difficulty) "
            "until they explicitly request generation."
        )

        if missing_fields:
            system_prompt += (
                "\nCurrent missing fields for generation readiness: "
                + ", ".join(missing_fields)
                + ". Ask only for the most important missing detail next."
            )

        context_summary = (
            f"\nCurrent settings:\n"
            f"- Subject: {request.subject or 'not set'}\n"
            f"- Topic: {request.topic or 'not set'}\n"
            f"- Question count: {request.question_count or 'not set'}\n"
            f"- Question types: {', '.join(request.question_types or []) or 'not set'}"
        )

        messages: List[Any] = [SystemMessage(content=system_prompt + context_summary)]
        for turn in (request.history or [])[-10:]:
            content = (turn.content or "").strip()
            if not content:
                continue
            role = (turn.role or "").strip().lower()
            if role == "assistant":
                messages.append(AIMessage(content=content))
            else:
                messages.append(HumanMessage(content=content))
        messages.append(HumanMessage(content=planning_message))

        llm_response = await llm.ainvoke(messages)
        response_content = llm_response.content
        if isinstance(response_content, list):
            response_content = "\n".join(
                str(part) for part in response_content if part is not None
            )
        response_text = (
            str(response_content).strip() or "Can you share a bit more detail?"
        )

        await session_service.append_chat_message(
            session.session_id,
            current_user.clerk_id,
            build_session_chat_message("assistant", response_text),
        )

        await session_service.update_session(
            session.session_id,
            current_user.clerk_id,
            config=session_config,
        )

        await persist_qg_usage(
            database=database,
            llm=llm,
            tenant_id=current_user.tutor_id,
            provider_id=ai_provider,
            model_id=model_name,
            operation="generation_planning_chat",
            metadata={
                "session_id": session.session_id,
                "ready_to_generate": ready_to_generate,
                "missing_fields": missing_fields,
            },
        )

        return ChatResponse(
            response=response_text,
            ready_to_generate=ready_to_generate,
            missing_fields=missing_fields,
            session_id=session.session_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Question generator chat failed", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to process chat message")


@router.post("/chat-with-tools", response_model=ToolChatResponse)
async def chat_about_question_generation_with_tools(
    request: ChatRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Planning chat endpoint that uses model-native tool calling for settings-aware responses."""
    try:
        ai_provider, model_name, llm = await resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=request.ai_provider,
            requested_model=request.model_name,
        )

        missing_fields = get_missing_generation_fields(request)
        ready_to_generate = len(missing_fields) == 0
        planning_message = request.message.strip()
        if not planning_message:
            raise HTTPException(status_code=400, detail="Message cannot be empty")

        session_service = _create_generation_session_service(database)
        session = None
        if request.session_id:
            session = await session_service.get_session(
                request.session_id, current_user.clerk_id
            )

        session_config = chat_config_to_session_config(request)
        if not session:
            session = await session_service.create_session(
                user_id=current_user.clerk_id,
                tenant_id=current_user.tutor_id,
                prompt=planning_message,
                config=session_config,
                material_ids=[],
            )
        else:
            await session_service.update_session(
                session.session_id,
                current_user.clerk_id,
                config=session_config,
                original_prompt=session.original_prompt or planning_message,
            )

        await session_service.append_chat_message(
            session.session_id,
            current_user.clerk_id,
            build_session_chat_message("user", planning_message),
        )

        system_prompt = (
            "You are an AI teaching assistant helping a tutor plan question generation. "
            "Respond conversationally and concisely. Do not start generating questions yet. "
            "Use tools when you need to inspect generation readiness, saved defaults, or available models."
        )

        context_summary = (
            f"\nCurrent settings:\n"
            f"- Subject: {request.subject or 'not set'}\n"
            f"- Topic: {request.topic or 'not set'}\n"
            f"- Question count: {request.question_count or 'not set'}\n"
            f"- Question types: {', '.join(request.question_types or []) or 'not set'}"
        )

        messages: List[Any] = [SystemMessage(content=system_prompt + context_summary)]
        for turn in (request.history or [])[-10:]:
            content = (turn.content or "").strip()
            if not content:
                continue
            role = (turn.role or "").strip().lower()
            if role == "assistant":
                messages.append(AIMessage(content=content))
            else:
                messages.append(HumanMessage(content=content))
        messages.append(HumanMessage(content=planning_message))

        final_message, tool_traces = await _run_native_tool_planning_chat(
            llm=llm,
            messages=messages,
            request=request,
            current_user=current_user,
            database=database,
        )
        response_text = (
            coerce_response_text(final_message) or "Can you share a bit more detail?"
        )

        await session_service.append_chat_message(
            session.session_id,
            current_user.clerk_id,
            build_session_chat_message("assistant", response_text),
        )
        await session_service.update_session(
            session.session_id,
            current_user.clerk_id,
            config=session_config,
        )

        await persist_qg_usage(
            database=database,
            llm=llm,
            tenant_id=current_user.tutor_id,
            provider_id=ai_provider,
            model_id=model_name,
            operation="generation_planning_tool_chat",
            metadata={
                "session_id": session.session_id,
                "tool_call_count": len(tool_traces),
                "ready_to_generate": ready_to_generate,
            },
        )

        return ToolChatResponse(
            response=response_text,
            ready_to_generate=ready_to_generate,
            missing_fields=missing_fields,
            session_id=session.session_id,
            tool_calls=tool_traces,
        )
    except HTTPException:
        raise
    except AIProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        logger.error("Question generator tool chat failed", error=str(e))
        raise HTTPException(
            status_code=500, detail="Failed to process tool chat message"
        )
