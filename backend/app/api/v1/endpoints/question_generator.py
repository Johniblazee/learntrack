"""
AI Question Generator Endpoints - LangGraph Agent

Provides streaming SSE endpoints for question generation using the
LangGraph ReAct agent architecture.
"""

from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.ai.runtime import persist_usage_snapshot
from app.core.dependencies import get_rag_service, get_database, get_question_service
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.exceptions import AIProviderError
from app.agents.graph.state import (
    GenerationConfig,
    QuestionType,
    Difficulty,
    BloomsLevel,
    GenerationSession,
    GeneratedQuestion,
    SourceCitation,
)
from app.agents.streaming.sse_handler import SSEHandler
from app.models.generation_session import SessionStatus, QuestionStatus, StoredQuestion
from app.models.generation_session import SessionChatMessage
from app.models.question import (
    QuestionCreate,
    QuestionStatus as BankQuestionStatus,
    QuestionType as BankQuestionType,
    QuestionDifficulty as BankQuestionDifficulty,
    QuestionOption,
)
from app.utils.enums import (
    normalize_question_type,
    normalize_difficulty,
    normalize_blooms_level,
)

logger = structlog.get_logger()
router = APIRouter()


def _get_question_generator_agent_class():
    try:
        from app.agents.graph.question_generator_graph import QuestionGeneratorAgent

        return QuestionGeneratorAgent
    except Exception as exc:
        logger.warning(
            "Question generator agent unavailable",
            error=str(exc),
        )
        raise HTTPException(
            status_code=503,
            detail="Advanced question generation is currently unavailable on this server.",
        )


def _create_tenant_config_service(database: AsyncIOMotorDatabase):
    from app.services.tenant_ai_config_service import TenantAIConfigService

    return TenantAIConfigService(database)


def _create_generation_session_service(database: AsyncIOMotorDatabase):
    from app.services.generation_session_service import GenerationSessionService

    return GenerationSessionService(database)


def _create_web_search_service(database: AsyncIOMotorDatabase):
    from app.services.web_search_service import WebSearchService

    return WebSearchService(database)


def _create_question_service(database: AsyncIOMotorDatabase):
    from app.services.question_service import QuestionService

    return QuestionService(database)


async def _resolve_tenant_llm_provider(
    tenant_id: str,
    database: AsyncIOMotorDatabase,
    requested_provider: Optional[str] = None,
    requested_model: Optional[str] = None,
):
    """Resolve the tenant's LLM with BYOK -> system-key fallback."""
    from app.ai.services.tenant_ai_resolver import resolve_tenant_chat_model

    try:
        resolved = await resolve_tenant_chat_model(
            db=database,
            tenant_id=tenant_id,
            requested_provider=requested_provider,
            requested_model=requested_model,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return resolved.provider_id, resolved.model_id, resolved.llm


async def _persist_question_generator_usage(
    *,
    database: AsyncIOMotorDatabase,
    llm: Any,
    tenant_id: str,
    provider_id: str,
    model_id: str,
    operation: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        await persist_usage_snapshot(
            database=database,
            llm=llm,
            tenant_id=tenant_id,
            provider_id=provider_id,
            model_id=model_id,
            operation=operation,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning(
            "Failed to persist chat runtime usage snapshot",
            provider=provider_id,
            model=model_id,
            operation=operation,
            error=str(exc),
        )


async def get_session_service(db=Depends(get_database)):
    """Dependency for session service"""
    return _create_generation_session_service(db)


def _stored_to_generated_question(stored: StoredQuestion) -> GeneratedQuestion:
    """Convert persisted session question shape into graph question shape."""
    citations = []
    for citation in stored.source_citations or []:
        try:
            citations.append(SourceCitation(**citation))
        except Exception:
            continue

    return GeneratedQuestion(
        question_id=stored.question_id,
        type=_normalize_graph_question_type(stored.type),
        difficulty=_normalize_graph_difficulty(stored.difficulty),
        blooms_level=normalize_blooms_level(stored.blooms_level),
        question_text=stored.question_text,
        options=stored.options,
        correct_answer=stored.correct_answer,
        explanation=stored.explanation,
        source_citations=citations,
        tags=stored.tags or [],
        quality_score=stored.quality_score or 0.85,
        is_valid=True,
    )


def _normalize_graph_question_type(value: Optional[str]) -> QuestionType:
    raw = (value or "multiple-choice").strip().lower().replace("_", "-")
    if raw in {"mcq", "multiple choice"}:
        raw = "multiple-choice"
    elif raw in {"true false", "true_false", "true/false"}:
        raw = "true-false"
    elif raw in {"short answer", "short_answer"}:
        raw = "short-answer"
    try:
        return QuestionType(raw)
    except ValueError:
        return QuestionType.MULTIPLE_CHOICE


def _normalize_graph_difficulty(value: Optional[str]) -> Difficulty:
    raw = (value or "medium").strip().lower()
    if raw in {"beginner", "low"}:
        raw = "easy"
    elif raw in {"intermediate"}:
        raw = "medium"
    elif raw in {"advanced", "high"}:
        raw = "hard"
    try:
        return Difficulty(raw)
    except ValueError:
        return Difficulty.MEDIUM


class GenerateRequest(BaseModel):
    """Request body for question generation"""

    prompt: str = Field(..., description="User's generation prompt")
    question_count: int = Field(
        default=1, ge=1, le=20, description="Number of questions"
    )
    question_types: List[str] = Field(
        default=["multiple-choice"], description="Question types to generate"
    )
    difficulty: str = Field(default="medium", description="Difficulty level")
    material_ids: Optional[List[str]] = Field(
        default=None, description="Material IDs to use"
    )
    grade_level: Optional[str] = Field(default=None, description="Target grade level")
    subject: Optional[str] = Field(default=None, description="Subject area")
    topic: Optional[str] = Field(default=None, description="Specific topic")
    ai_provider: Optional[str] = Field(default=None, description="AI provider to use")
    model_name: Optional[str] = Field(default=None, description="Specific model to use")
    blooms_levels: Optional[List[str]] = Field(
        default=None,
        description="Bloom's taxonomy levels to target (REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE)",
    )
    session_id: Optional[str] = Field(
        default=None, description="Existing session ID to continue"
    )


class ChatTurn(BaseModel):
    role: str = Field(..., description="Message role: user or assistant")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User's chat message")
    session_id: Optional[str] = Field(
        default=None, description="Existing generation session ID"
    )
    history: Optional[List[ChatTurn]] = Field(
        default=None, description="Recent conversation turns"
    )
    ai_provider: Optional[str] = Field(default=None, description="AI provider to use")
    model_name: Optional[str] = Field(default=None, description="Specific model to use")
    question_count: Optional[int] = Field(default=None, ge=1, le=20)
    question_types: Optional[List[str]] = Field(default=None)
    subject: Optional[str] = Field(default=None)
    topic: Optional[str] = Field(default=None)


class ChatResponse(BaseModel):
    response: str
    ready_to_generate: bool
    missing_fields: List[str] = Field(default_factory=list)
    session_id: Optional[str] = None


class ToolCallTrace(BaseModel):
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    result: Dict[str, Any] = Field(default_factory=dict)


class ToolChatResponse(ChatResponse):
    tool_calls: List[ToolCallTrace] = Field(default_factory=list)


class EditQuestionRequest(BaseModel):
    """Request body for editing a question"""

    question_id: str = Field(..., description="ID of question to edit")
    edit_instruction: str = Field(..., description="What to change")
    new_source_ids: Optional[List[str]] = Field(
        default=None, description="New sources for regeneration"
    )


class SessionResponse(BaseModel):
    """Response with session info"""

    session_id: str
    status: str
    questions_count: int
    message: str


def _get_missing_generation_fields(request: ChatRequest) -> List[str]:
    return _get_missing_generation_fields_from_values(
        subject=request.subject,
        topic=request.topic,
        question_types=request.question_types,
        question_count=request.question_count,
    )


def _get_missing_generation_fields_from_values(
    *,
    subject: Optional[str],
    topic: Optional[str],
    question_types: Optional[List[str]],
    question_count: Optional[int],
) -> List[str]:
    missing_fields = []
    if not subject:
        missing_fields.append("subject")
    if not topic:
        missing_fields.append("topic")
    if not question_types:
        missing_fields.append("question_types")
    if not question_count:
        missing_fields.append("question_count")
    return missing_fields


def check_generation_readiness(
    subject: Optional[str] = None,
    topic: Optional[str] = None,
    question_types: Optional[List[str]] = None,
    question_count: Optional[int] = None,
    difficulty: Optional[str] = None,
) -> str:
    """Check whether the current planning inputs are sufficient to start generating questions."""
    raise NotImplementedError


def list_enabled_models(provider_id: Optional[str] = None) -> str:
    """List enabled AI providers and approved models available to the current tutor."""
    raise NotImplementedError


def get_saved_ai_defaults() -> str:
    """Return the tutor's saved default AI provider and model along with BYOK availability."""
    raise NotImplementedError


def _chat_config_to_session_config(request: ChatRequest) -> Dict[str, Any]:
    """Map chat planning parameters to persisted session config."""
    return {
        "question_count": request.question_count or 3,
        "question_types": request.question_types or ["multiple-choice"],
        "difficulty": "medium",
        "subject": request.subject,
        "topic": request.topic,
        "ai_provider": request.ai_provider,
        "model_name": request.model_name,
    }


def _build_session_chat_message(
    role: str, content: str, referenced_question_id: Optional[str] = None
) -> SessionChatMessage:
    """Create a normalized persisted chat message object."""
    return SessionChatMessage(
        id=str(uuid.uuid4()),
        role=role,  # type: ignore[arg-type]
        content=content,
        referenced_question_id=referenced_question_id,
    )


def _coerce_response_text(message: Any) -> str:
    response_content = getattr(message, "content", message)
    if isinstance(response_content, list):
        response_content = "\n".join(
            str(part) for part in response_content if part is not None
        )
    return str(response_content).strip()


async def _execute_native_planning_tool(
    *,
    tool_name: str,
    tool_args: Dict[str, Any],
    request: ChatRequest,
    current_user: ClerkUserContext,
    database: AsyncIOMotorDatabase,
) -> Dict[str, Any]:
    if tool_name == "check_generation_readiness":
        missing_fields = _get_missing_generation_fields_from_values(
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
    tools = [
        check_generation_readiness,
        list_enabled_models,
        get_saved_ai_defaults,
    ]
    working_messages: List[Any] = list(messages)
    traces: List[ToolCallTrace] = []

    for _ in range(max_rounds):
        ai_message = await llm.ainvoke_with_tools(
            working_messages,
            tools=tools,
            tool_choice="auto",
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


@router.post("/chat", response_model=ChatResponse)
async def chat_about_question_generation(
    request: ChatRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Fast chat endpoint for planning requirements before running generation."""
    try:
        ai_provider, model_name, llm = await _resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=request.ai_provider,
            requested_model=request.model_name,
        )

        missing_fields = _get_missing_generation_fields(request)
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

        session_config = _chat_config_to_session_config(request)
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
            _build_session_chat_message("user", planning_message),
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
            _build_session_chat_message("assistant", response_text),
        )

        await session_service.update_session(
            session.session_id,
            current_user.clerk_id,
            config=session_config,
        )

        await _persist_question_generator_usage(
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
        ai_provider, model_name, llm = await _resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=request.ai_provider,
            requested_model=request.model_name,
        )

        missing_fields = _get_missing_generation_fields(request)
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

        session_config = _chat_config_to_session_config(request)
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
            _build_session_chat_message("user", planning_message),
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
            _coerce_response_text(final_message) or "Can you share a bit more detail?"
        )

        await session_service.append_chat_message(
            session.session_id,
            current_user.clerk_id,
            _build_session_chat_message("assistant", response_text),
        )
        await session_service.update_session(
            session.session_id,
            current_user.clerk_id,
            config=session_config,
        )

        await _persist_question_generator_usage(
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


@router.post("/generate", response_class=StreamingResponse)
async def generate_questions(
    request: GenerateRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    rag_service=Depends(get_rag_service),
    session_service: Any = Depends(get_session_service),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Generate questions with streaming SSE output.

    Returns a Server-Sent Events stream with real-time updates:
    - session:created - Session ID for tracking
    - agent:thinking - Agent's reasoning steps
    - agent:action - Actions being taken
    - source:found - Source materials discovered
    - generation:chunk - Streamed question content
    - generation:question_complete - Individual question completion
    - done - Stream complete with final session data
    """
    try:
        # Build config with blooms_levels
        blooms = "AUTO"
        if request.blooms_levels and len(request.blooms_levels) > 0:
            blooms = [normalize_blooms_level(level) for level in request.blooms_levels]

        question_types = request.question_types or ["multiple-choice"]
        config = GenerationConfig(
            question_count=request.question_count,
            question_types=[_normalize_graph_question_type(t) for t in question_types],
            difficulty=_normalize_graph_difficulty(request.difficulty),
            blooms_levels=blooms,
            subject=request.subject,
            topic=request.topic,
            grade_level=request.grade_level,
        )

        session_config = (
            config.model_dump(mode="json")
            if hasattr(config, "model_dump")
            else dict(config)
        )

        ai_provider, model_name, llm = await _resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=request.ai_provider,
            requested_model=request.model_name,
        )
        session_config["ai_provider"] = ai_provider
        session_config["model_name"] = model_name

        # Reuse existing planning session when provided, otherwise create new.
        session = None
        if request.session_id:
            session = await session_service.get_session(
                request.session_id, current_user.clerk_id
            )

        if session:
            session = await session_service.update_session(
                session.session_id,
                current_user.clerk_id,
                status=SessionStatus.PENDING.value,
                original_prompt=request.prompt,
                config=session_config,
                material_ids=request.material_ids or [],
                questions=[],
                current_question_index=0,
                retrieved_chunks=[],
                thinking_steps=[],
                error_message=None,
                completed_at=None,
            )
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            session = await session_service.create_session(
                user_id=current_user.clerk_id,
                tenant_id=current_user.tutor_id,
                prompt=request.prompt,
                config=session_config,
                material_ids=request.material_ids,
            )

        await session_service.append_chat_message(
            session.session_id,
            current_user.clerk_id,
            _build_session_chat_message("user", request.prompt),
        )

        # Create agent with web search service for fallback
        web_search_service = _create_web_search_service(database)
        question_generator_agent_class = _get_question_generator_agent_class()
        agent = question_generator_agent_class(
            llm=llm, rag_service=rag_service, web_search_service=web_search_service
        )

        # Track saved questions count
        saved_questions_count = 0

        # Helpers to normalize enum/string values
        def normalize_question_type_value(
            val: Optional[Any], default: str = "multiple-choice"
        ) -> str:
            if val is None:
                return default
            raw = val.value if hasattr(val, "value") else str(val)
            return normalize_question_type(raw).value

        def normalize_difficulty_value(
            val: Optional[Any], default: str = "medium"
        ) -> str:
            if val is None:
                return default
            raw = val.value if hasattr(val, "value") else str(val)
            return normalize_difficulty(raw).value

        # Callback to save questions as they're generated
        async def save_question_callback(question_data: dict) -> bool:
            """Save a question to the database when it's generated"""
            nonlocal saved_questions_count
            try:
                # Handle both enum objects and string values
                q_type = normalize_question_type_value(
                    question_data.get("type"), "multiple-choice"
                )
                q_difficulty = normalize_difficulty_value(
                    question_data.get("difficulty"), "medium"
                )
                q_blooms: Any = question_data.get("blooms_level")
                if hasattr(q_blooms, "value"):
                    q_blooms = q_blooms.value
                if not q_blooms:
                    q_blooms = "UNDERSTAND"

                # Handle source_citations - may be SourceCitation objects or dicts
                raw_citations = question_data.get("source_citations", [])
                citations = []
                for c in raw_citations:
                    if hasattr(c, "model_dump"):
                        citations.append(c.model_dump())
                    elif isinstance(c, dict):
                        citations.append(c)

                logger.info(
                    "Saving question to database",
                    session_id=session.session_id,
                    question_id=question_data.get("question_id"),
                    type=q_type,
                    difficulty=q_difficulty,
                )

                stored_q = StoredQuestion(
                    question_id=question_data.get(
                        "question_id", f"q{saved_questions_count + 1}"
                    ),
                    type=q_type,
                    difficulty=q_difficulty,
                    blooms_level=q_blooms,
                    question_text=question_data.get("question_text", ""),
                    options=question_data.get("options"),
                    correct_answer=question_data.get("correct_answer", ""),
                    explanation=question_data.get("explanation", ""),
                    source_citations=citations,
                    tags=question_data.get("tags", []),
                    quality_score=question_data.get("quality_score", 0.85),
                )
                result = await session_service.add_question(
                    session.session_id, current_user.clerk_id, stored_q
                )
                if result:
                    saved_questions_count += 1
                    logger.info(
                        "Question saved to database successfully",
                        session_id=session.session_id,
                        question_id=stored_q.question_id,
                        total_saved=saved_questions_count,
                    )
                else:
                    logger.warning(
                        "Question save returned False",
                        session_id=session.session_id,
                        question_id=stored_q.question_id,
                    )
                return result
            except Exception as e:
                logger.error(
                    "Failed to save question",
                    error=str(e),
                    error_type=type(e).__name__,
                    question_id=question_data.get("question_id"),
                )
                import traceback

                logger.error("Traceback", traceback=traceback.format_exc())
                return False

        # Create SSE handler with session ID and save callback
        sse_handler = SSEHandler(
            session_id=session.session_id, on_question_complete=save_question_callback
        )

        async def run_generation():
            """Background task to run generation"""
            nonlocal saved_questions_count
            try:
                # Update session status
                await session_service.update_session(
                    session.session_id,
                    current_user.clerk_id,
                    status=SessionStatus.IN_PROGRESS.value,
                )

                result = await agent.generate(
                    prompt=request.prompt,
                    config=config,
                    user_id=current_user.clerk_id,
                    tenant_id=current_user.tutor_id,
                    material_ids=request.material_ids,
                    sse_handler=sse_handler,
                )

                # Questions are now saved via callback as they're generated
                # Just update the session status
                serialized_thinking_steps = []
                for step in result.thinking_steps or []:
                    if hasattr(step, "model_dump"):
                        serialized_thinking_steps.append(step.model_dump(mode="json"))
                    elif isinstance(step, dict):
                        serialized_thinking_steps.append(step)

                await session_service.update_session(
                    session.session_id,
                    current_user.clerk_id,
                    status=SessionStatus.COMPLETED.value,
                    enhanced_prompt=result.enhanced_prompt,
                    thinking_steps=serialized_thinking_steps,
                    completed_at=datetime.now(timezone.utc),
                )

                await session_service.append_chat_message(
                    session.session_id,
                    current_user.clerk_id,
                    _build_session_chat_message(
                        "assistant",
                        f"Generated {saved_questions_count} question(s).",
                    ),
                )

                # Note: send_done is already called in agent.generate()
                # But ensure it's called if agent didn't call it
                if not sse_handler._is_closed:
                    await sse_handler.send_done(saved_questions_count)

            except Exception as e:
                logger.error("Generation error", error=str(e))
                await session_service.update_session(
                    session.session_id,
                    current_user.clerk_id,
                    status=SessionStatus.FAILED.value,
                    error_message=str(e),
                )
                await session_service.append_chat_message(
                    session.session_id,
                    current_user.clerk_id,
                    _build_session_chat_message(
                        "assistant",
                        f"Generation failed: {str(e)}",
                    ),
                )
                await sse_handler.send_error(str(e))
            finally:
                await _persist_question_generator_usage(
                    database=database,
                    llm=llm,
                    tenant_id=current_user.tutor_id,
                    provider_id=ai_provider,
                    model_id=model_name,
                    operation="question_generation",
                    metadata={
                        "session_id": session.session_id,
                        "saved_questions": saved_questions_count,
                        "requested_question_count": request.question_count,
                    },
                )

        async def stream_events():
            """Stream events while generation runs concurrently"""
            import asyncio
            import json

            # Send session created event first
            session_event = {
                "event_type": "session:created",
                "session_id": session.session_id,
                "timestamp": session.created_at.isoformat()
                if hasattr(session, "created_at")
                else None,
            }
            yield f"event: session:created\ndata: {json.dumps(session_event)}\n\n"

            # Start generation in background task
            generation_task = asyncio.create_task(run_generation())

            # Stream events as they arrive
            try:
                async for event in sse_handler.event_generator():
                    yield event
            finally:
                # Ensure generation task completes
                if not generation_task.done():
                    await generation_task

        return StreamingResponse(
            stream_events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except Exception as e:
        logger.error("Failed to start generation", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/edit", response_class=StreamingResponse)
async def edit_question(
    request: EditQuestionRequest,
    session_id: str = Query(..., description="Generation session ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    rag_service=Depends(get_rag_service),
    session_service: Any = Depends(get_session_service),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Edit a question via LangGraph and stream progress as SSE events."""
    try:
        session = await session_service.get_session(session_id, current_user.clerk_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        question_to_edit = next(
            (q for q in session.questions if q.question_id == request.question_id), None
        )
        if not question_to_edit:
            raise HTTPException(status_code=404, detail="Question not found in session")

        config_data = session.config or {}
        question_types = config_data.get("question_types") or [question_to_edit.type]
        if isinstance(question_types, str):
            question_types = [question_types]

        blooms_levels = "AUTO"
        raw_blooms_levels = config_data.get("blooms_levels")
        if isinstance(raw_blooms_levels, list) and raw_blooms_levels:
            blooms_levels = [
                normalize_blooms_level(level) for level in raw_blooms_levels
            ]

        config = GenerationConfig(
            question_count=max(len(session.questions), 1),
            question_types=[
                _normalize_graph_question_type(q_type) for q_type in question_types
            ],
            difficulty=_normalize_graph_difficulty(
                config_data.get("difficulty", question_to_edit.difficulty)
            ),
            blooms_levels=blooms_levels,
            subject=config_data.get("subject"),
            topic=config_data.get("topic"),
            grade_level=config_data.get("grade_level"),
        )

        ai_provider, model_name, llm = await _resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=(config_data.get("ai_provider") or None),
            requested_model=(config_data.get("model_name") or None),
        )

        question_generator_agent_class = _get_question_generator_agent_class()
        agent = question_generator_agent_class(llm=llm, rag_service=rag_service)
        existing_questions = [
            _stored_to_generated_question(stored_q) for stored_q in session.questions
        ]

        sse_handler = SSEHandler(session_id=session_id)

        await session_service.append_chat_message(
            session_id,
            current_user.clerk_id,
            _build_session_chat_message(
                "user",
                request.edit_instruction,
                referenced_question_id=request.question_id,
            ),
        )

        async def run_edit():
            try:
                result = await agent.generate(
                    prompt=session.original_prompt or request.edit_instruction,
                    config=config,
                    user_id=current_user.clerk_id,
                    tenant_id=current_user.tutor_id,
                    material_ids=request.new_source_ids or session.material_ids,
                    sse_handler=sse_handler,
                    existing_session_id=session_id,
                    existing_questions=existing_questions,
                    target_question_id=request.question_id,
                    user_query=request.edit_instruction,
                )

                edited_question = next(
                    (
                        q
                        for q in result.questions
                        if q.question_id == request.question_id
                    ),
                    None,
                )
                if not edited_question:
                    raise ValueError("Edited question not found in LangGraph output")

                update_payload = {
                    "type": edited_question.type.value,
                    "difficulty": edited_question.difficulty.value,
                    "blooms_level": edited_question.blooms_level.value,
                    "question_text": edited_question.question_text,
                    "options": edited_question.options,
                    "correct_answer": edited_question.correct_answer,
                    "explanation": edited_question.explanation,
                    "source_citations": [
                        citation.model_dump(mode="json")
                        for citation in edited_question.source_citations
                    ],
                    "tags": edited_question.tags,
                    "quality_score": edited_question.quality_score,
                }
                if request.new_source_ids:
                    update_payload["source_ids"] = request.new_source_ids

                success = await session_service.update_question_content(
                    session_id=session_id,
                    user_id=current_user.clerk_id,
                    question_id=request.question_id,
                    update_data=update_payload,
                )
                if not success:
                    raise ValueError("Failed to persist edited question")

                await session_service.append_chat_message(
                    session_id,
                    current_user.clerk_id,
                    _build_session_chat_message(
                        "assistant",
                        "Updated the selected question.",
                        referenced_question_id=request.question_id,
                    ),
                )

                if not sse_handler._is_closed:
                    await sse_handler.send_done(len(result.questions))

            except Exception as e:
                logger.error("LangGraph edit failed", error=str(e))
                await session_service.append_chat_message(
                    session_id,
                    current_user.clerk_id,
                    _build_session_chat_message(
                        "assistant",
                        f"Edit failed: {str(e)}",
                        referenced_question_id=request.question_id,
                    ),
                )
                await sse_handler.send_error(str(e))
            finally:
                await _persist_question_generator_usage(
                    database=database,
                    llm=llm,
                    tenant_id=current_user.tutor_id,
                    provider_id=ai_provider,
                    model_id=model_name,
                    operation="question_edit",
                    metadata={
                        "session_id": session_id,
                        "question_id": request.question_id,
                    },
                )

        async def stream_events():
            import asyncio
            import json

            session_event = {
                "event_type": "session:created",
                "session_id": session_id,
                "timestamp": session.updated_at.isoformat()
                if hasattr(session, "updated_at")
                else None,
            }
            yield f"event: session:created\ndata: {json.dumps(session_event)}\n\n"

            edit_task = asyncio.create_task(run_edit())
            try:
                async for event in sse_handler.event_generator():
                    yield event
            finally:
                if not edit_task.done():
                    await edit_task

        return StreamingResponse(
            stream_events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to start edit stream", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """
    Get a generation session by ID.

    Used for resuming incomplete generations or reviewing completed ones.
    """
    session = await session_service.get_session(session_id, current_user.clerk_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return session.model_dump()


@router.get("/sessions")
async def list_sessions(
    status: Optional[str] = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """
    List generation sessions for the current user.
    """
    status_enum = SessionStatus(status) if status else None

    sessions, total = await session_service.list_sessions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,  # tutor_id is used for tenant isolation
        status=status_enum,
        page=page,
        per_page=per_page,
    )

    return {
        "items": [s.model_dump() for s in sessions],
        "page": page,
        "per_page": per_page,
        "total": total,
    }


@router.get("/pending-questions")
async def get_pending_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """
    Get all pending questions across all sessions for the current tutor.
    Returns questions that haven't been approved or rejected yet.
    """
    questions, total = await session_service.get_pending_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        page=page,
        per_page=per_page,
    )

    return {"items": questions, "page": page, "per_page": per_page, "total": total}


@router.get("/all-questions")
async def get_all_questions(
    status: Optional[str] = Query(
        None, description="Filter by status: pending, approved, rejected"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=200, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """
    Get all questions across all sessions for the current tutor.
    Optionally filter by question status.
    """
    status_enum = QuestionStatus(status) if status else None

    questions, total = await session_service.get_all_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        status=status_enum,
        page=page,
        per_page=per_page,
    )

    return {"items": questions, "page": page, "per_page": per_page, "total": total}


@router.get("/sessions-with-questions")
async def get_sessions_with_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=50, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """
    Get all generation sessions with their questions and status counts.
    Used for the Review & Approve tab to show all generation history.
    """
    sessions, total = await session_service.get_sessions_with_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        page=page,
        per_page=per_page,
    )

    return {"items": sessions, "page": page, "per_page": per_page, "total": total}


@router.post("/sessions/{session_id}/questions/{question_id}/approve")
async def approve_question(
    session_id: str,
    question_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Approve a generated draft question for publishing."""
    success = await session_service.update_question_status(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        status=QuestionStatus.APPROVED,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {
        "message": "Question approved for publishing",
        "question_id": question_id,
    }


@router.post("/sessions/{session_id}/questions/{question_id}/reject")
async def reject_question(
    session_id: str,
    question_id: str,
    reason: Optional[str] = Query(None, description="Optional rejection reason"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Reject a generated question"""
    success = await session_service.update_question_status(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        status=QuestionStatus.REJECTED,
        review_comments=reason,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"message": "Question rejected", "question_id": question_id}


@router.post("/sessions/{session_id}/questions/{question_id}/request-revision")
async def request_question_revision(
    session_id: str,
    question_id: str,
    notes: str = Query(..., description="Revision guidance for the draft"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Attach review guidance while keeping the draft in the review queue."""
    success = await session_service.request_question_revision(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        notes=notes,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {
        "message": "Revision requested",
        "question_id": question_id,
        "review_comments": notes,
    }


class SaveToQuestionBankRequest(BaseModel):
    """Request for saving approved generated questions to the bank."""

    question_ids: Optional[List[str]] = Field(default=None)
    subject_id: Optional[str] = Field(default=None)
    topic: Optional[str] = Field(default=None)


def _normalize_bank_question_type(value: Optional[str]) -> BankQuestionType:
    raw = (value or "").strip().lower().replace("_", "-")
    if raw in {"multiple-choice", "mcq"}:
        return BankQuestionType.MULTIPLE_CHOICE
    if raw == "true-false":
        return BankQuestionType.TRUE_FALSE
    if raw == "essay":
        return BankQuestionType.ESSAY
    return BankQuestionType.SHORT_ANSWER


def _normalize_bank_difficulty(value: Optional[str]) -> BankQuestionDifficulty:
    raw = (value or "").strip().lower()
    if raw == "easy":
        return BankQuestionDifficulty.EASY
    if raw == "hard":
        return BankQuestionDifficulty.HARD
    return BankQuestionDifficulty.MEDIUM


def _strip_option_prefix(value: str) -> str:
    import re

    return re.sub(r"^[A-Za-z][\).:-]\s*", "", value).strip()


def _build_mcq_options(options: Optional[List[str]], answer: str):
    normalized = [
        _strip_option_prefix(opt) for opt in (options or []) if opt and opt.strip()
    ]
    if len(normalized) < 2:
        raise ValueError("MCQ requires at least 2 options")

    resolved_answer = (answer or "").strip()
    if len(resolved_answer) == 1 and resolved_answer.isalpha():
        idx = ord(resolved_answer.upper()) - 65
        if 0 <= idx < len(normalized):
            resolved_answer = normalized[idx]

    if resolved_answer not in normalized:
        raise ValueError("Correct answer does not match options")

    return [
        QuestionOption(text=opt, is_correct=opt == resolved_answer)
        for opt in normalized
    ], resolved_answer


@router.post("/sessions/{session_id}/save-to-question-bank")
async def save_session_questions_to_bank(
    session_id: str,
    request: SaveToQuestionBankRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
    question_service: Any = Depends(get_question_service),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Persist approved generated session questions into the tutor question bank."""
    session = await session_service.get_session(session_id, current_user.clerk_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    selected_question_ids = set(request.question_ids or [])
    approved_questions = [
        question
        for question in session.questions
        if question.status == QuestionStatus.APPROVED
        and not question.published_question_id
        and (not selected_question_ids or question.question_id in selected_question_ids)
    ]

    if not approved_questions:
        raise HTTPException(status_code=400, detail="No approved questions to save")

    subject_id = request.subject_id
    if not subject_id:
        configured_subject_name = (session.config or {}).get("subject")
        if configured_subject_name:
            subject_doc = await database.subjects.find_one(
                {
                    "tutor_id": current_user.clerk_id,
                    "name": configured_subject_name,
                    "is_active": True,
                }
            )
            if subject_doc and subject_doc.get("_id"):
                subject_id = str(subject_doc["_id"])

    if not subject_id:
        raise HTTPException(
            status_code=400,
            detail="Unable to resolve subject_id from session subject. Provide subject_id.",
        )

    topic = request.topic or (session.config or {}).get("topic") or "AI Generated"
    ai_provider = (session.config or {}).get("ai_provider")
    model_name = (session.config or {}).get("model_name")
    generation_model = (
        f"{ai_provider}/{model_name}" if ai_provider and model_name else model_name
    )

    saved_count = 0
    failed_items = []
    published_map: Dict[str, str] = {}

    for question in approved_questions:
        try:
            bank_type = _normalize_bank_question_type(question.type)
            bank_difficulty = _normalize_bank_difficulty(question.difficulty)
            reference_materials = question.source_ids or session.material_ids

            option_payload = []
            correct_answer = question.correct_answer
            if bank_type == BankQuestionType.MULTIPLE_CHOICE:
                option_payload, correct_answer = _build_mcq_options(
                    question.options,
                    question.correct_answer,
                )

            payload = QuestionCreate(
                question_text=question.question_text,
                question_type=bank_type,
                subject_id=subject_id,
                topic=topic,
                difficulty=bank_difficulty,
                points=1,
                explanation=question.explanation,
                tags=question.tags,
                tutor_id=current_user.clerk_id,
                options=option_payload,
                correct_answer=correct_answer,
            )

            saved_question = await question_service.create_question(
                question_data=payload,
                tutor_id=current_user.clerk_id,
                ai_generated=True,
                generation_id=session_id,
                extra_fields={
                    "status": BankQuestionStatus.ACTIVE.value,
                    "approved_by": current_user.clerk_id,
                    "approved_at": question.reviewed_at or datetime.now(timezone.utc),
                    "ai_generated": True,
                    "ai_provider": ai_provider,
                    "ai_confidence": question.quality_score,
                    "reference_materials": reference_materials,
                    "source_documents": reference_materials,
                    "source_chunks": question.source_citations,
                    "generation_model": generation_model,
                },
            )
            published_map[question.question_id] = str(saved_question.id)
            saved_count += 1
        except Exception as exc:
            failed_items.append(
                {"question_id": question.question_id, "reason": str(exc)}
            )

    if published_map:
        await session_service.mark_questions_published(
            session_id=session_id,
            user_id=current_user.clerk_id,
            published_map=published_map,
        )
        await session_service.append_chat_message(
            session_id,
            current_user.clerk_id,
            _build_session_chat_message(
                "assistant",
                f"Published {len(published_map)} approved question(s) to the question bank.",
            ),
        )

    return {
        "session_id": session_id,
        "requested": len(approved_questions),
        "saved_count": saved_count,
        "published_count": saved_count,
        "failed_count": len(failed_items),
        "failed_items": failed_items,
        "published_items": published_map,
    }


class UpdateQuestionRequest(BaseModel):
    """Request body for updating a question"""

    question_text: Optional[str] = None
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    explanation: Optional[str] = None


@router.put("/sessions/{session_id}/questions/{question_id}")
async def update_question(
    session_id: str,
    question_id: str,
    request: UpdateQuestionRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Manually update a question's content"""
    # Build update data from non-None fields
    update_data = {}
    if request.question_text is not None:
        update_data["question_text"] = request.question_text
    if request.options is not None:
        update_data["options"] = request.options
    if request.correct_answer is not None:
        update_data["correct_answer"] = request.correct_answer
    if request.explanation is not None:
        update_data["explanation"] = request.explanation

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    success = await session_service.update_question_content(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        update_data=update_data,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"message": "Question updated", "question_id": question_id}


@router.delete("/sessions/{session_id}/questions/{question_id}")
async def delete_session_question(
    session_id: str,
    question_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Delete a generated draft question from a session."""
    success = await session_service.delete_question(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"message": "Question deleted", "question_id": question_id}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """Delete a generation session and all its questions"""
    success = await session_service.delete_session(
        session_id=session_id, user_id=current_user.clerk_id
    )

    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"message": "Session deleted", "session_id": session_id}


@router.get("/stats")
async def get_generation_stats(
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: Any = Depends(get_session_service),
):
    """
    Get generation statistics for the current user.

    Returns:
    - total_generated: Total questions generated all time
    - this_month: Questions generated this month
    - success_rate: Percentage of successful generations
    - avg_quality: Average quality score (based on approval rate)
    """
    stats = await session_service.get_stats(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,  # tutor_id is used for tenant isolation
    )
    return stats


@router.get("/available-models")
async def get_available_models(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get the tenant-approved AI providers and models for question generation.

    Returns a structure like:
    {
        "providers": [
            {
                "id": "groq",
                "name": "Groq",
                "description": "Ultra-fast inference",
                "available": true,
                "models": [
                    {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B", "description": "..."}
                ]
            }
        ]
    }
    """
    from app.ai.services.tenant_ai_resolver import PROVIDER_DESCRIPTIONS

    service = _create_tenant_config_service(database)
    providers = await service.get_tutor_provider_status(current_user.tutor_id)
    return {
        "providers": [
            {
                "id": provider.provider_id,
                "name": provider.name,
                "description": PROVIDER_DESCRIPTIONS.get(
                    provider.provider_id, provider.name
                ),
                "available": provider.available,
                "has_byok_key": provider.has_custom_key,
                "key_source": provider.key_source,
                "models": [
                    {
                        "id": model.model_id,
                        "name": model.name,
                        "description": model.description,
                        "available": model.available,
                        "context_window": model.context_window,
                        "priority": model.priority,
                    }
                    for model in provider.models
                ],
            }
            for provider in providers
        ]
    }
