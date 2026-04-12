"""Shared helpers, Pydantic models, service factories, and dependencies for
the question-generator sub-routers."""

from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional
import uuid

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.ai.runtime import persist_usage_snapshot
from app.core.dependencies import get_rag_service, get_database, get_question_service
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.exceptions import AIProviderError, ValidationError
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
from app.models.generation_session import (
    SessionStatus,
    QuestionStatus,
    StoredQuestion,
    SessionChatMessage,
)
from app.models.question import (
    QuestionCreate,
    QuestionUpdate,
    QuestionStatus as BankQuestionStatus,
    QuestionType as BankQuestionType,
    QuestionDifficulty as BankQuestionDifficulty,
    QuestionOption,
)
from app.utils.enums import (
    normalize_question_type,
    normalize_difficulty,
    normalize_blooms_level,
    normalize_provider,
)
from app.core.utils import to_object_id

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Service factories
# ---------------------------------------------------------------------------

def _get_question_generator_agent_class():
    try:
        from app.agents.graph.question_generator_graph import QuestionGeneratorAgent
        return QuestionGeneratorAgent
    except Exception as exc:
        logger.warning("Question generator agent unavailable", error=str(exc))
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


async def get_session_service(db=Depends(get_database)):
    """FastAPI dependency for session service."""
    return _create_generation_session_service(db)


# ---------------------------------------------------------------------------
# Tenant LLM resolution & usage tracking
# ---------------------------------------------------------------------------

async def resolve_tenant_llm_provider(
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


async def persist_qg_usage(
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


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

def normalize_graph_question_type(value: Optional[str]) -> QuestionType:
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


def normalize_graph_difficulty(value: Optional[str]) -> Difficulty:
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


def stored_to_generated_question(stored: StoredQuestion) -> GeneratedQuestion:
    """Convert persisted session question shape into graph question shape."""
    citations = []
    for citation in stored.source_citations or []:
        try:
            citations.append(SourceCitation(**citation))
        except Exception:
            continue

    return GeneratedQuestion(
        question_id=stored.question_id,
        type=normalize_graph_question_type(stored.type),
        difficulty=normalize_graph_difficulty(stored.difficulty),
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


# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    prompt: str = Field(..., description="User's generation prompt")
    question_count: int = Field(default=1, ge=1, le=20, description="Number of questions")
    question_types: List[str] = Field(default=["multiple-choice"], description="Question types to generate")
    difficulty: str = Field(default="medium", description="Difficulty level")
    material_ids: Optional[List[str]] = Field(default=None, description="Material IDs to use")
    grade_level: Optional[str] = Field(default=None, description="Target grade level")
    subject: Optional[str] = Field(default=None, description="Subject area")
    topic: Optional[str] = Field(default=None, description="Specific topic")
    ai_provider: Optional[str] = Field(default=None, description="AI provider to use")
    model_name: Optional[str] = Field(default=None, description="Specific model to use")
    blooms_levels: Optional[List[str]] = Field(
        default=None,
        description="Bloom's taxonomy levels to target (REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE)",
    )
    session_id: Optional[str] = Field(default=None, description="Existing session ID to continue")


class ChatTurn(BaseModel):
    role: str = Field(..., description="Message role: user or assistant")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User's chat message")
    session_id: Optional[str] = Field(default=None, description="Existing generation session ID")
    history: Optional[List[ChatTurn]] = Field(default=None, description="Recent conversation turns")
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
    question_id: str = Field(..., description="ID of question to edit")
    edit_instruction: str = Field(..., description="What to change")
    new_source_ids: Optional[List[str]] = Field(default=None, description="New sources for regeneration")


class SessionResponse(BaseModel):
    session_id: str
    status: str
    questions_count: int
    message: str


class SaveToQuestionBankRequest(BaseModel):
    question_ids: Optional[List[str]] = Field(default=None)
    subject_id: Optional[str] = Field(default=None)
    topic: Optional[str] = Field(default=None)


class UpdateQuestionRequest(BaseModel):
    question_text: Optional[str] = None
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    explanation: Optional[str] = None


# ---------------------------------------------------------------------------
# Small chat / generation utilities
# ---------------------------------------------------------------------------

def get_missing_generation_fields(request: ChatRequest) -> List[str]:
    return get_missing_generation_fields_from_values(
        subject=request.subject,
        topic=request.topic,
        question_types=request.question_types,
        question_count=request.question_count,
    )


def get_missing_generation_fields_from_values(
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


def chat_config_to_session_config(request: ChatRequest) -> Dict[str, Any]:
    return {
        "question_count": request.question_count or 3,
        "question_types": request.question_types or ["multiple-choice"],
        "difficulty": "medium",
        "subject": request.subject,
        "topic": request.topic,
        "ai_provider": request.ai_provider,
        "model_name": request.model_name,
    }


def build_session_chat_message(
    role: str, content: str, referenced_question_id: Optional[str] = None
) -> SessionChatMessage:
    return SessionChatMessage(
        id=str(uuid.uuid4()),
        role=role,  # type: ignore[arg-type]
        content=content,
        referenced_question_id=referenced_question_id,
    )


def coerce_response_text(message: Any) -> str:
    response_content = getattr(message, "content", message)
    if isinstance(response_content, list):
        response_content = "\n".join(
            str(part) for part in response_content if part is not None
        )
    return str(response_content).strip()


# ---------------------------------------------------------------------------
# Bank normalization helpers
# ---------------------------------------------------------------------------

def normalize_bank_question_type(value: Optional[str]) -> BankQuestionType:
    raw = (value or "").strip().lower().replace("_", "-")
    if raw in {"multiple-choice", "mcq"}:
        return BankQuestionType.MULTIPLE_CHOICE
    if raw == "true-false":
        return BankQuestionType.TRUE_FALSE
    if raw == "essay":
        return BankQuestionType.ESSAY
    return BankQuestionType.SHORT_ANSWER


def normalize_bank_difficulty(value: Optional[str]) -> BankQuestionDifficulty:
    raw = (value or "").strip().lower()
    if raw == "easy":
        return BankQuestionDifficulty.EASY
    if raw == "hard":
        return BankQuestionDifficulty.HARD
    return BankQuestionDifficulty.MEDIUM


def strip_option_prefix(value: str) -> str:
    import re
    return re.sub(r"^[A-Za-z][\).:-]\s*", "", value).strip()


def build_mcq_options(options: Optional[List[str]], answer: str):
    normalized = [
        strip_option_prefix(opt) for opt in (options or []) if opt and opt.strip()
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
