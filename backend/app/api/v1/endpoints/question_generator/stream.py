"""SSE streaming endpoints: /generate and /edit."""

import asyncio
from datetime import datetime, timezone
import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.dependencies import get_rag_service, get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.agents.graph.state import GenerationConfig
from app.agents.streaming.sse_handler import SSEHandler
from app.models.generation_session import SessionStatus, StoredQuestion
from app.utils.enums import normalize_question_type, normalize_difficulty, normalize_blooms_level

from ._shared import (
    EditQuestionRequest,
    GenerateRequest,
    build_session_chat_message,
    get_session_service,
    normalize_graph_difficulty,
    normalize_graph_question_type,
    persist_qg_usage,
    resolve_tenant_llm_provider,
    stored_to_generated_question,
    _create_web_search_service,
    _get_question_generator_agent_class,
)

logger = structlog.get_logger()
router = APIRouter()


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
        blooms = "AUTO"
        if request.blooms_levels and len(request.blooms_levels) > 0:
            blooms = [normalize_blooms_level(level) for level in request.blooms_levels]

        question_types = request.question_types or ["multiple-choice"]
        config = GenerationConfig(
            question_count=request.question_count,
            question_types=[normalize_graph_question_type(t) for t in question_types],
            difficulty=normalize_graph_difficulty(request.difficulty),
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

        ai_provider, model_name, llm = await resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=request.ai_provider,
            requested_model=request.model_name,
        )
        session_config["ai_provider"] = ai_provider
        session_config["model_name"] = model_name

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
            build_session_chat_message("user", request.prompt),
        )

        web_search_service = _create_web_search_service(database)
        question_generator_agent_class = _get_question_generator_agent_class()
        agent = question_generator_agent_class(
            llm=llm, rag_service=rag_service, web_search_service=web_search_service
        )

        saved_questions_count = 0

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

        async def save_question_callback(question_data: dict) -> bool:
            nonlocal saved_questions_count
            try:
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

        sse_handler = SSEHandler(
            session_id=session.session_id, on_question_complete=save_question_callback
        )

        async def run_generation():
            nonlocal saved_questions_count
            try:
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
                    build_session_chat_message(
                        "assistant",
                        f"Generated {saved_questions_count} question(s).",
                    ),
                )

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
                    build_session_chat_message(
                        "assistant",
                        f"Generation failed: {str(e)}",
                    ),
                )
                await sse_handler.send_error(str(e))
            finally:
                await persist_qg_usage(
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
            session_event = {
                "event_type": "session:created",
                "session_id": session.session_id,
                "timestamp": session.created_at.isoformat()
                if hasattr(session, "created_at")
                else None,
            }
            yield f"event: session:created\ndata: {json.dumps(session_event)}\n\n"

            generation_task = asyncio.create_task(run_generation())
            try:
                async for event in sse_handler.event_generator():
                    yield event
            finally:
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
                normalize_graph_question_type(q_type) for q_type in question_types
            ],
            difficulty=normalize_graph_difficulty(
                config_data.get("difficulty", question_to_edit.difficulty)
            ),
            blooms_levels=blooms_levels,
            subject=config_data.get("subject"),
            topic=config_data.get("topic"),
            grade_level=config_data.get("grade_level"),
        )

        ai_provider, model_name, llm = await resolve_tenant_llm_provider(
            tenant_id=current_user.tutor_id,
            database=database,
            requested_provider=(config_data.get("ai_provider") or None),
            requested_model=(config_data.get("model_name") or None),
        )

        question_generator_agent_class = _get_question_generator_agent_class()
        agent = question_generator_agent_class(llm=llm, rag_service=rag_service)
        existing_questions = [
            stored_to_generated_question(stored_q) for stored_q in session.questions
        ]

        sse_handler = SSEHandler(session_id=session_id)

        await session_service.append_chat_message(
            session_id,
            current_user.clerk_id,
            build_session_chat_message(
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
                    build_session_chat_message(
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
                    build_session_chat_message(
                        "assistant",
                        f"Edit failed: {str(e)}",
                        referenced_question_id=request.question_id,
                    ),
                )
                await sse_handler.send_error(str(e))
            finally:
                await persist_qg_usage(
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
