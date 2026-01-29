"""
AI Question Generator Endpoints - LangGraph Agent

Provides streaming SSE endpoints for question generation using the
LangGraph ReAct agent architecture.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.dependencies import get_rag_service, get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.ai_models_config import get_all_active_models_for_dropdown
from app.agents.graph.state import GenerationConfig, QuestionType, Difficulty, BloomsLevel, GenerationSession
from app.agents.graph.question_generator_graph import QuestionGeneratorAgent
from app.agents.streaming.sse_handler import SSEHandler
from app.ai.services.ai_manager import get_tenant_ai_manager
from app.services.tenant_ai_config_service import TenantAIConfigService
from app.services.generation_session_service import GenerationSessionService
from app.models.generation_session import SessionStatus, QuestionStatus, StoredQuestion
from app.utils.enums import normalize_question_type, normalize_difficulty, normalize_provider

logger = structlog.get_logger()
router = APIRouter()

async def get_session_service(db = Depends(get_database)):
    """Dependency for session service"""
    return GenerationSessionService(db)


class GenerateRequest(BaseModel):
    """Request body for question generation"""
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
    blooms_levels: Optional[List[str]] = Field(default=None, description="Bloom's taxonomy levels to target (REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE)")


class EditQuestionRequest(BaseModel):
    """Request body for editing a question"""
    question_id: str = Field(..., description="ID of question to edit")
    edit_instruction: str = Field(..., description="What to change")
    new_source_ids: Optional[List[str]] = Field(default=None, description="New sources for regeneration")


class SessionResponse(BaseModel):
    """Response with session info"""
    session_id: str
    status: str
    questions_count: int
    message: str


@router.post("/generate", response_class=StreamingResponse)
async def generate_questions(
    request: GenerateRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    rag_service = Depends(get_rag_service),
    session_service: GenerationSessionService = Depends(get_session_service),
    database: AsyncIOMotorDatabase = Depends(get_database)
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
            blooms = [BloomsLevel(level) for level in request.blooms_levels]

        question_types = request.question_types or ["multiple-choice"]
        config = GenerationConfig(
            question_count=request.question_count,
            question_types=[normalize_question_type(t) for t in question_types],
            difficulty=normalize_difficulty(request.difficulty),
            blooms_levels=blooms,
            subject=request.subject,
            topic=request.topic,
            grade_level=request.grade_level,
        )

        # Create session for persistence
        session = await session_service.create_session(
            user_id=current_user.clerk_id,
            tenant_id=current_user.tutor_id,
            prompt=request.prompt,
            config=config.model_dump() if hasattr(config, 'model_dump') else dict(config),
            material_ids=request.material_ids
        )

        # Get LLM with tenant-aware configuration
        config_service = TenantAIConfigService(database)
        tenant_config = await config_service.get_or_create_default(current_user.tutor_id)

        # Normalize provider name (handles legacy 'google' -> 'gemini' mapping)
        ai_provider = normalize_provider(request.ai_provider) if request.ai_provider else tenant_config.default_provider
        model_name = request.model_name or tenant_config.default_model

        if ai_provider not in tenant_config.enabled_providers:
            raise HTTPException(status_code=400, detail=f"Provider {ai_provider} is not enabled for this tenant")

        provider_config = tenant_config.provider_configs.get(ai_provider) if tenant_config.provider_configs else None
        if provider_config and provider_config.enabled_models and model_name not in provider_config.enabled_models:
            raise HTTPException(status_code=400, detail=f"Model {model_name} is not enabled for provider {ai_provider}")

        ai_manager = await get_tenant_ai_manager(current_user.tutor_id, database)
        provider = ai_manager.get_provider(ai_provider)

        # Set specific model if provided
        if model_name and hasattr(provider, 'set_model'):
            try:
                provider.set_model(model_name)
                logger.info("Model set", model=model_name, provider=ai_provider)
            except ValueError as e:
                logger.warning("Failed to set model, using default", error=str(e))

        llm = provider.llm

        # Create agent
        agent = QuestionGeneratorAgent(llm=llm, rag_service=rag_service)

        # Track saved questions count
        saved_questions_count = 0

        # Helpers to normalize enum/string values
        def normalize_question_type_value(val: Optional[str], default: str = "multiple-choice") -> str:
            if val is None:
                return default
            raw = val.value if hasattr(val, "value") else str(val)
            return normalize_question_type(raw).value

        def normalize_difficulty_value(val: Optional[str], default: str = "medium") -> str:
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
                q_type = normalize_question_type_value(question_data.get("type"), "multiple-choice")
                q_difficulty = normalize_difficulty_value(question_data.get("difficulty"), "medium")
                q_blooms = question_data.get("blooms_level")
                if hasattr(q_blooms, "value"):
                    q_blooms = q_blooms.value
                if not q_blooms:
                    q_blooms = "UNDERSTAND"

                # Handle source_citations - may be SourceCitation objects or dicts
                raw_citations = question_data.get("source_citations", [])
                citations = []
                for c in raw_citations:
                    if hasattr(c, 'model_dump'):
                        citations.append(c.model_dump())
                    elif isinstance(c, dict):
                        citations.append(c)

                logger.info(
                    "Saving question to database",
                    session_id=session.session_id,
                    question_id=question_data.get("question_id"),
                    type=q_type,
                    difficulty=q_difficulty
                )

                stored_q = StoredQuestion(
                    question_id=question_data.get("question_id", f"q{saved_questions_count + 1}"),
                    type=q_type,
                    difficulty=q_difficulty,
                    blooms_level=q_blooms,
                    question_text=question_data.get("question_text", ""),
                    options=question_data.get("options"),
                    correct_answer=question_data.get("correct_answer", ""),
                    explanation=question_data.get("explanation", ""),
                    source_citations=citations,
                    tags=question_data.get("tags", []),
                    quality_score=question_data.get("quality_score", 0.85)
                )
                result = await session_service.add_question(
                    session.session_id,
                    current_user.clerk_id,
                    stored_q
                )
                if result:
                    saved_questions_count += 1
                    logger.info(
                        "Question saved to database successfully",
                        session_id=session.session_id,
                        question_id=stored_q.question_id,
                        total_saved=saved_questions_count
                    )
                else:
                    logger.warning(
                        "Question save returned False",
                        session_id=session.session_id,
                        question_id=stored_q.question_id
                    )
                return result
            except Exception as e:
                logger.error(
                    "Failed to save question",
                    error=str(e),
                    error_type=type(e).__name__,
                    question_id=question_data.get("question_id")
                )
                import traceback
                logger.error("Traceback", traceback=traceback.format_exc())
                return False

        # Create SSE handler with session ID and save callback
        sse_handler = SSEHandler(
            session_id=session.session_id,
            on_question_complete=save_question_callback
        )

        async def run_generation():
            """Background task to run generation"""
            nonlocal saved_questions_count
            try:
                # Update session status
                await session_service.update_session(
                    session.session_id,
                    current_user.clerk_id,
                    status=SessionStatus.IN_PROGRESS.value
                )

                result = await agent.generate(
                    prompt=request.prompt,
                    config=config,
                    user_id=current_user.clerk_id,
                    tenant_id=current_user.tutor_id,
                    material_ids=request.material_ids,
                    sse_handler=sse_handler
                )

                # Questions are now saved via callback as they're generated
                # Just update the session status
                await session_service.update_session(
                    session.session_id,
                    current_user.clerk_id,
                    status=SessionStatus.COMPLETED.value
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
                    error_message=str(e)
                )
                await sse_handler.send_error(str(e))

        async def stream_events():
            """Stream events while generation runs concurrently"""
            import asyncio
            import json

            # Send session created event first
            session_event = {
                "event_type": "session:created",
                "session_id": session.session_id,
                "timestamp": session.created_at.isoformat() if hasattr(session, 'created_at') else None
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
            }
        )

    except Exception as e:
        logger.error("Failed to start generation", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/edit")
async def edit_question(
    request: EditQuestionRequest,
    session_id: str = Query(..., description="Generation session ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    rag_service = Depends(get_rag_service),
    session_service: GenerationSessionService = Depends(get_session_service),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Edit a single question from a generation session.

    Allows editing:
    - Question text
    - Options (for multiple-choice)
    - Regenerate with different sources
    """
    try:
        # Retrieve session from database
        session = await session_service.get_session(session_id, current_user.clerk_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Find the question to edit
        question_to_edit = None
        question_index = -1
        for i, q in enumerate(session.questions):
            if q.question_id == request.question_id:
                question_to_edit = q
                question_index = i
                break

        if not question_to_edit:
            raise HTTPException(status_code=404, detail="Question not found in session")

        # Initialize AI for editing
        ai_manager = await get_tenant_ai_manager(current_user.tutor_id, database)
        provider = ai_manager.get_provider()
        llm = provider.llm

        # Create edit prompt
        edit_prompt = f"""You are editing an existing question. Here is the original question:

Question Type: {question_to_edit.type}
Question Text: {question_to_edit.question_text}
Options: {question_to_edit.options if question_to_edit.options else 'N/A'}
Correct Answer: {question_to_edit.correct_answer}
Explanation: {question_to_edit.explanation}

The user wants to make the following changes:
{request.edit_instruction}

Please provide the edited question in the same format. Keep the question type the same unless specifically asked to change it.

Respond with a JSON object containing:
- question_text: The edited question text
- options: Array of options (for multiple-choice) or null
- correct_answer: The correct answer
- explanation: Updated explanation
"""

        # Get edited question from LLM
        from langchain_core.messages import HumanMessage
        response = await llm.ainvoke([HumanMessage(content=edit_prompt)])

        # Parse the response
        import json
        import re

        # Try to extract JSON from the response
        response_text = response.content
        json_match = re.search(r'\{[\s\S]*\}', response_text)

        if json_match:
            try:
                edited_data = json.loads(json_match.group())

                # Update the question in the session
                updated_question = StoredQuestion(
                    question_id=question_to_edit.question_id,
                    type=question_to_edit.type,
                    question_text=edited_data.get("question_text", question_to_edit.question_text),
                    options=edited_data.get("options", question_to_edit.options),
                    correct_answer=edited_data.get("correct_answer", question_to_edit.correct_answer),
                    explanation=edited_data.get("explanation", question_to_edit.explanation),
                    difficulty=question_to_edit.difficulty,
                    source_ids=request.new_source_ids or question_to_edit.source_ids,
                    status=question_to_edit.status,
                    metadata={"edited": True, "edit_instruction": request.edit_instruction}
                )

                # Update in database
                result = await session_service.collection.update_one(
                    {
                        "_id": session_id,
                        "user_id": current_user.clerk_id,
                        "questions.question_id": request.question_id
                    },
                    {
                        "$set": {
                            f"questions.{question_index}": updated_question.model_dump()
                        }
                    }
                )

                if result.modified_count > 0:
                    return {
                        "message": "Question edited successfully",
                        "question_id": request.question_id,
                        "edited_question": updated_question.model_dump()
                    }
                else:
                    raise HTTPException(status_code=500, detail="Failed to update question in database")

            except json.JSONDecodeError:
                raise HTTPException(status_code=500, detail="Failed to parse AI response")
        else:
            raise HTTPException(status_code=500, detail="AI did not return valid JSON")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Edit failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
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
    session_service: GenerationSessionService = Depends(get_session_service)
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
        per_page=per_page
    )

    return {
        "items": [s.model_dump() for s in sessions],
        "page": page,
        "per_page": per_page,
        "total": total
    }


@router.get("/pending-questions")
async def get_pending_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
):
    """
    Get all pending questions across all sessions for the current tutor.
    Returns questions that haven't been approved or rejected yet.
    """
    questions, total = await session_service.get_pending_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        page=page,
        per_page=per_page
    )

    return {
        "items": questions,
        "page": page,
        "per_page": per_page,
        "total": total
    }


@router.get("/all-questions")
async def get_all_questions(
    status: Optional[str] = Query(None, description="Filter by status: pending, approved, rejected, edited"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
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
        per_page=per_page
    )

    return {
        "items": questions,
        "page": page,
        "per_page": per_page,
        "total": total
    }


@router.get("/sessions-with-questions")
async def get_sessions_with_questions(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=50, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
):
    """
    Get all generation sessions with their questions and status counts.
    Used for the Review & Approve tab to show all previous generations.
    """
    sessions, total = await session_service.get_sessions_with_questions(
        user_id=current_user.clerk_id,
        tenant_id=current_user.tutor_id,
        page=page,
        per_page=per_page
    )

    return {
        "items": sessions,
        "page": page,
        "per_page": per_page,
        "total": total
    }


@router.post("/sessions/{session_id}/questions/{question_id}/approve")
async def approve_question(
    session_id: str,
    question_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
):
    """Approve a generated question"""
    success = await session_service.update_question_status(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        status=QuestionStatus.APPROVED
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"message": "Question approved", "question_id": question_id}


@router.post("/sessions/{session_id}/questions/{question_id}/reject")
async def reject_question(
    session_id: str,
    question_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
):
    """Reject a generated question"""
    success = await session_service.update_question_status(
        session_id=session_id,
        user_id=current_user.clerk_id,
        question_id=question_id,
        status=QuestionStatus.REJECTED
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"message": "Question rejected", "question_id": question_id}


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
    session_service: GenerationSessionService = Depends(get_session_service)
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
        update_data=update_data
    )

    if not success:
        raise HTTPException(status_code=404, detail="Question not found")

    return {"message": "Question updated", "question_id": question_id}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
):
    """Delete a generation session and all its questions"""
    success = await session_service.delete_session(
        session_id=session_id,
        user_id=current_user.clerk_id
    )

    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"message": "Session deleted", "session_id": session_id}


@router.get("/stats")
async def get_generation_stats(
    current_user: ClerkUserContext = Depends(require_tutor),
    session_service: GenerationSessionService = Depends(get_session_service)
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
        tenant_id=current_user.tutor_id  # tutor_id is used for tenant isolation
    )
    return stats


@router.get("/available-models")
async def get_available_models(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    Get all available AI providers and their models (fetched dynamically from provider APIs).
    Respects tenant-specific AI configuration if available.

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
    from app.ai.services.models_fetcher import fetch_all_provider_models
    from app.core.config import settings
    from app.services.tenant_ai_config_service import TenantAIConfigService

    # Get tenant-specific configuration if available
    tenant_config = None
    enabled_providers = None
    try:
        config_service = TenantAIConfigService(database)
        tenant_config = await config_service.get_config(current_user.clerk_id)
        if tenant_config:
            enabled_providers = tenant_config.enabled_providers
    except Exception as e:
        logger.warning("Failed to load tenant AI config", error=str(e))

    # Fallback static models from centralized config in case API fetching fails
    fallback_models = get_all_active_models_for_dropdown()

    # Fetch models from all providers (with caching and error handling)
    fetched_models = {}
    try:
        fetched_models = await fetch_all_provider_models(limit=3)
        logger.info("Successfully fetched models from providers", count=len(fetched_models))
    except Exception as e:
        logger.warning("Failed to fetch models from providers, using fallback", error=str(e))
        fetched_models = {}

    providers = []

    provider_info = [
        ("groq", "Groq", "Ultra-fast inference with open models", settings.GROQ_API_KEY),
        ("openai", "OpenAI", "GPT models from OpenAI", settings.OPENAI_API_KEY),
        ("gemini", "Google Gemini", "Gemini models from Google", settings.GEMINI_API_KEY),
        ("anthropic", "Anthropic", "Claude models from Anthropic", settings.ANTHROPIC_API_KEY),
    ]

    for provider_id, name, description, api_key in provider_info:
        # Check if provider is enabled for this tenant
        is_enabled = enabled_providers is None or provider_id in enabled_providers
        is_available = bool(api_key) and is_enabled

        # Get models from fetched data, or use fallback if empty
        models = fetched_models.get(provider_id, [])
        if not models and provider_id in fallback_models:
            models = fallback_models[provider_id]
            logger.info(f"Using fallback models for {provider_id}")

        # If tenant has specific model restrictions, filter models
        if tenant_config and tenant_config.provider_configs:
            provider_config = tenant_config.provider_configs.get(provider_id)
            if provider_config and provider_config.enabled_models:
                models = [m for m in models if m["id"] in provider_config.enabled_models]

        providers.append({
            "id": provider_id,
            "name": name,
            "description": description,
            "available": is_available,
            "models": models
        })

    return {"providers": providers}
