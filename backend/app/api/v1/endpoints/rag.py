"""
RAG (Retrieval-Augmented Generation) endpoints
"""

from typing import List, Dict, Any, Optional
from fastapi import (
    APIRouter,
    Depends,
    Path,
    Query,
    HTTPException,
    BackgroundTasks,
    Request,
)
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
import time
import uuid

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.core.rate_limit import limiter, RATE_LIMITS
from app.models.rag import (
    RAGQuestionGenerationRequest,
    RAGGenerationResponse,
    QuestionRegenerationRequest,
    DocumentLibraryItem,
    DocumentProcessingStatus,
)
from app.models.file import EmbeddingStatus, FileStatus
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.rag.services.rag_service import RAGService
from app.services.web_search_service import WebSearchService
from app.ai.services.ai_manager import get_ai_manager_for_tenant, AIManager
from app.services.tenant_ai_config_service import TenantAIConfigService
from app.services.question_service import QuestionService
from app.core.utils import to_object_id
from app.utils.enums import (
    normalize_question_type,
    normalize_difficulty,
    normalize_provider,
)

logger = structlog.get_logger()
router = APIRouter()


def _build_basic_rag_context(
    documents: List[Any],
) -> tuple[str, List[Dict[str, Any]]]:
    rag_context_parts: List[str] = []
    source_chunks: List[Dict[str, Any]] = []

    for index, doc in enumerate(documents):
        metadata = getattr(doc, "metadata", {}) or {}
        content = str(getattr(doc, "page_content", "") or "").strip()
        if not content:
            continue

        rag_context_parts.append(content)
        source_chunks.append(
            {
                "file_id": metadata.get("file_id") or metadata.get("filename") or "",
                "file_name": metadata.get("filename")
                or metadata.get("source")
                or "Unknown",
                "chunk_index": metadata.get("chunk_index", index),
                "page_number": metadata.get("page") or metadata.get("page_number"),
                "score": metadata.get("similarity_score")
                or metadata.get("score")
                or 0.0,
                "metadata": metadata,
            }
        )

    return "\n\n".join(rag_context_parts), source_chunks


@router.post("/generate", response_model=RAGGenerationResponse)
@limiter.limit(RATE_LIMITS["ai_generation"])
async def generate_questions_with_rag(
    request: Request,
    body: RAGQuestionGenerationRequest,
    background_tasks: BackgroundTasks,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Generate questions using RAG with optional web search"""
    try:
        start_time = time.monotonic()
        rag_service = RAGService(database)
        web_search_service = WebSearchService(database)
        question_service = QuestionService(database)
        config_service = TenantAIConfigService(database)

        tenant_config = await config_service.get_or_create_default(
            current_user.tutor_id
        )
        if not tenant_config.enable_rag:
            raise HTTPException(
                status_code=403, detail="RAG is disabled for this tenant"
            )

        use_web_search = (
            body.use_web_search
            if body.use_web_search is not None
            else body.enable_web_search
        )
        if use_web_search and not tenant_config.enable_web_search:
            raise HTTPException(
                status_code=403, detail="Web search is disabled for this tenant"
            )

        # Normalize provider name (handles legacy 'google' -> 'gemini' mapping)
        ai_provider = (
            normalize_provider(body.ai_provider)
            if body.ai_provider
            else tenant_config.default_provider
        )
        model_name = body.model_name or tenant_config.default_model

        if ai_provider not in tenant_config.enabled_providers:
            raise HTTPException(
                status_code=400,
                detail=f"Provider {ai_provider} is not enabled for this tenant",
            )

        provider_config = (
            tenant_config.provider_configs.get(ai_provider)
            if tenant_config.provider_configs
            else None
        )
        if (
            provider_config
            and provider_config.enabled_models
            and model_name not in provider_config.enabled_models
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Model {model_name} is not enabled for provider {ai_provider}",
            )

        # Resolve RAG context using AgenticRAGAgent when available,
        # otherwise fall back to direct vector retrieval.
        rag_context = ""
        source_chunks = []
        if body.document_ids:
            rag_query = body.web_search_query or f"{body.subject} {body.topic}"
            try:
                from app.agents.rag.graph import AgenticRAGAgent
                from app.agents.rag.state import RAGConfig

                manager = await get_ai_manager_for_tenant(current_user.tutor_id)
                rag_llm_provider = None
                try:
                    rag_llm_provider = manager.get_provider(ai_provider)
                except Exception:
                    rag_llm_provider = None

                if not rag_llm_provider or not hasattr(rag_llm_provider, "llm"):
                    rag_llm_provider = next(
                        (
                            provider
                            for provider in manager.providers.values()
                            if hasattr(provider, "llm")
                        ),
                        None,
                    )

                if rag_llm_provider and hasattr(rag_llm_provider, "llm"):
                    rag_agent = AgenticRAGAgent(
                        llm=rag_llm_provider.llm, rag_service=rag_service
                    )
                    rag_config = RAGConfig(
                        top_k=body.context_chunks,
                        generate_answer=False,
                        document_ids=body.document_ids,
                    )
                    rag_session = await rag_agent.query(
                        query=rag_query,
                        user_id=current_user.clerk_id,
                        tenant_id=current_user.tutor_id,
                        config=rag_config,
                        document_ids=body.document_ids,
                        generate_answer=False,
                    )

                    for doc in rag_session.sources:
                        rag_context += doc.content + "\n\n"
                        source_chunks.append(
                            {
                                "file_id": doc.source_file_id,
                                "file_name": doc.source_file,
                                "chunk_index": doc.chunk_index,
                                "page_number": doc.page_number,
                                "score": doc.relevance_score,
                                "metadata": doc.metadata,
                            }
                        )
                else:
                    raise RuntimeError("No LangChain-compatible provider available")
            except Exception as rag_import_error:
                logger.warning(
                    "Falling back to direct RAG retrieval",
                    error=str(rag_import_error),
                )
                documents = await rag_service.retrieve_context(
                    query=rag_query,
                    tutor_id=current_user.tutor_id,
                    document_ids=body.document_ids,
                    top_k=body.context_chunks,
                )
                rag_context, source_chunks = _build_basic_rag_context(documents)

        # Get web search context if enabled
        web_results = []
        if use_web_search:
            web_context = await web_search_service.search_for_context(
                body.topic, body.subject, current_user.clerk_id
            )
            if web_context:
                rag_context += f"\n\nWEB SEARCH RESULTS:\n{web_context}"
                results = await web_search_service.search(
                    body.web_search_query or f"{body.subject} {body.topic}",
                    current_user.clerk_id,
                    max_results=3,
                )
                web_results = [r.model_dump() for r in results]

        # Generate questions with RAG context
        manager = await get_ai_manager_for_tenant(current_user.tutor_id)
        if model_name:
            try:
                manager.set_provider_model(ai_provider, model_name)
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

        difficulty_value = body.difficulty or (
            body.difficulty_levels[0] if body.difficulty_levels else "medium"
        )
        difficulty = normalize_difficulty(difficulty_value)
        question_types = body.question_types or ["multiple-choice"]
        normalized_types = [normalize_question_type(qt) for qt in question_types]

        additional_context = body.additional_context or body.text_content or ""
        if body.custom_prompt:
            additional_context = f"{body.custom_prompt}\n\n{additional_context}".strip()

        questions = await manager.generate_questions_with_rag(
            text_content=additional_context,
            rag_context=rag_context,
            subject=body.subject,
            topic=body.topic,
            question_count=body.question_count,
            difficulty=difficulty,
            question_types=normalized_types,
            provider_name=ai_provider,
        )

        generation_id = str(uuid.uuid4())
        stored_questions = []
        for q in questions:
            extra_fields = {
                "rag_context_used": rag_context or None,
                "web_search_used": use_web_search,
                "source_chunks": source_chunks,
                "web_search_results": web_results,
                "generation_model": model_name or "default",
                "rag_generation_id": generation_id,
                "source_documents": body.document_ids or [],
            }
            stored = await question_service.create_question(
                q,
                current_user.clerk_id,
                ai_generated=True,
                generation_id=generation_id,
                extra_fields=extra_fields,
            )
            stored_questions.append(stored)

        processing_time = time.monotonic() - start_time
        return RAGGenerationResponse(
            generation_id=generation_id,
            questions=[q.model_dump() for q in stored_questions],
            ai_provider=ai_provider,
            model_used=model_name or "default",
            source_documents=body.document_ids or [],
            context_chunks_used=len(source_chunks),
            web_search_used=use_web_search,
            web_search_results=web_results,
            total_generated=len(stored_questions),
            processing_time=processing_time,
            status="completed",
        )

    except Exception as e:
        logger.error("RAG question generation failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")


@router.post("/regenerate-question", response_model=QuestionCreate)
@limiter.limit(RATE_LIMITS["ai_regenerate"])
async def regenerate_single_question(
    request: Request,
    body: QuestionRegenerationRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Regenerate a single question with modifications"""
    try:
        manager = get_ai_manager_for_tenant(current_user.tutor_id)
        question_service = QuestionService(database)
        original = await question_service.get_question_by_id(
            body.question_id, current_user.clerk_id
        )
        if not original:
            raise HTTPException(status_code=404, detail="Question not found")

        prompt = (
            body.regeneration_prompt
            or "Regenerate this question with improved clarity and accuracy."
        )
        if body.use_same_context and original.rag_context_used:
            text_content = f"{original.rag_context_used}\n\n{prompt}"
        else:
            text_content = f"""Original Question:
{original.question_text}

Instructions:
{prompt}
"""

        question_types = (
            [original.question_type]
            if body.keep_type
            else [QuestionType.MULTIPLE_CHOICE]
        )
        difficulty = (
            original.difficulty if body.keep_difficulty else QuestionDifficulty.MEDIUM
        )

        questions = await manager.generate_questions(
            text_content=text_content,
            subject=original.subject_id,
            topic=original.topic,
            question_count=1,
            difficulty=difficulty,
            question_types=question_types,
        )

        if not questions:
            raise HTTPException(status_code=500, detail="Failed to regenerate question")

        return questions[0]
    except Exception as e:
        logger.error("Question regeneration failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/models/{provider}", response_model=Dict[str, Any])
async def get_available_models(
    provider: str = Path(..., description="AI provider name"),
    current_user: ClerkUserContext = Depends(require_tutor),
):
    """Get available models for a provider"""
    try:
        manager = AIManager()
        models = manager.get_available_models(provider)
        return {"provider": provider, "models": models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/library", response_model=List[DocumentLibraryItem])
async def get_document_library(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get tutor's document library with embedding status"""
    try:
        files = (
            await database.files.find(
                {"tutor_id": current_user.clerk_id, "status": {"$ne": "deleted"}}
            )
            .sort("uploaded_at", -1)
            .to_list(100)
        )
        library_items = []
        for f in files:
            item = DocumentLibraryItem(
                id=str(f["_id"]),
                filename=f.get("filename", ""),
                content_type=f.get("content_type", ""),
                size=f.get("size", 0),
                uploaded_at=f.get("uploaded_at") or f.get("created_at"),
                status=f.get("status", FileStatus.UPLOADED.value),
                embedding_status=f.get(
                    "embedding_status", EmbeddingStatus.PENDING.value
                ),
                chunk_count=int(f.get("chunk_count", 0) or 0),
                tags=f.get("tags", []),
                category=f.get("category"),
                subject_id=f.get("subject_id"),
                topic=f.get("topic"),
                uploadthing_url=str(
                    f.get("source_url") or f.get("uploadthing_url") or ""
                ),
            )
            library_items.append(item)
        return library_items
    except Exception as e:
        logger.error("Failed to get document library", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process/{file_id}", response_model=DocumentProcessingStatus)
async def process_document_for_rag(
    file_id: str = Path(..., description="File ID to process"),
    background_tasks: BackgroundTasks = None,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Process a document for RAG (create embeddings)"""
    try:
        try:
            file_oid = to_object_id(file_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid file ID")

        # Get file info
        file_doc = await database.files.find_one(
            {"_id": file_oid, "tutor_id": current_user.clerk_id}
        )
        if not file_doc:
            raise HTTPException(status_code=404, detail="File not found")

        rag_service = RAGService(database)
        storage_path = str(file_doc.get("storage_path") or "")
        source_url = file_doc.get("source_url") or file_doc.get("uploadthing_url")
        if not storage_path:
            raise HTTPException(
                status_code=400, detail="File is missing local storage path"
            )

        # Process in background if background_tasks available
        if background_tasks:
            background_tasks.add_task(
                rag_service.process_document,
                storage_path,
                file_doc.get("filename") or file_id,
                current_user.clerk_id,
                file_doc.get("uploaded_by") or current_user.clerk_id,
                file_id=file_id,
                tutor_id=current_user.clerk_id,
                file_url=source_url,
            )
            return DocumentProcessingStatus(
                file_id=file_id,
                status="processing",
                embedding_status=EmbeddingStatus.PROCESSING.value,
                current_step="Document processing started",
            )
        else:
            result = await rag_service.process_document(
                storage_path,
                file_doc.get("filename") or file_id,
                current_user.clerk_id,
                file_doc.get("uploaded_by") or current_user.clerk_id,
                file_id=file_id,
                tutor_id=current_user.clerk_id,
                file_url=source_url,
            )
            return DocumentProcessingStatus(
                file_id=file_id,
                status="completed" if result.get("success") else "failed",
                embedding_status=(
                    EmbeddingStatus.COMPLETED.value
                    if result.get("success")
                    else EmbeddingStatus.FAILED.value
                ),
                chunks_processed=result.get("chunks_count", 0),
                total_chunks=result.get("chunks_count", 0),
                current_step=(
                    "Document processed successfully"
                    if result.get("success")
                    else result.get("error", "Document processing failed")
                ),
                error_message=result.get("error"),
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Document processing failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/embeddings/{file_id}")
async def delete_document_embeddings(
    file_id: str = Path(..., description="File ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete embeddings for a document"""
    try:
        rag_service = RAGService(database)
        await rag_service.delete_file_embeddings(file_id, current_user.clerk_id)

        try:
            file_oid = to_object_id(file_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid file ID")

        # Update file status - include tutor_id in filter for ownership verification
        await database.files.update_one(
            {"_id": file_oid, "tutor_id": current_user.clerk_id},
            {
                "$set": {
                    "embedding_status": EmbeddingStatus.PENDING.value,
                    "chunk_count": 0,
                    "qdrant_collection_id": None,
                }
            },
        )
        return {"message": "Embeddings deleted successfully"}
    except Exception as e:
        logger.error("Failed to delete embeddings", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/migrate-embeddings", response_model=Dict[str, Any])
async def migrate_embeddings_to_active_collection(
    source_collections: Optional[List[str]] = Query(
        default=None,
        description="Optional explicit source collections to migrate from",
    ),
    batch_size: int = Query(
        default=100,
        ge=1,
        le=1000,
        description="Backfill batch size",
    ),
    max_documents: Optional[int] = Query(
        default=None,
        ge=1,
        description="Optional cap for number of migrated documents",
    ),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Backfill embeddings from legacy collections into active model collection."""
    try:
        rag_service = RAGService(database)
        result = await rag_service.backfill_embeddings(
            source_collections=source_collections,
            batch_size=batch_size,
            max_documents=max_documents,
        )
        result["requested_by"] = current_user.clerk_id
        return result
    except Exception as e:
        logger.error("Failed to migrate embeddings", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=Dict[str, Any])
async def get_rag_stats(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get RAG statistics for tutor"""
    try:
        rag_service = RAGService(database)
        web_search_service = WebSearchService(database)

        collection_stats = await rag_service.get_collection_stats(current_user.clerk_id)
        remaining_credits = await web_search_service.get_remaining_credits(
            current_user.clerk_id
        )

        # Count documents by status
        pipeline = [
            {"$match": {"tutor_id": current_user.clerk_id}},
            {"$group": {"_id": "$embedding_status", "count": {"$sum": 1}}},
        ]
        status_counts = await database.files.aggregate(pipeline).to_list(10)

        return {
            "collection_stats": collection_stats,
            "web_search_credits": remaining_credits,
            "documents_by_status": {
                s["_id"]: s["count"] for s in status_counts if s["_id"]
            },
        }
    except Exception as e:
        logger.error("Failed to get RAG stats", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/providers", response_model=List[str])
async def get_available_providers(
    current_user: ClerkUserContext = Depends(require_tutor),
):
    """Get list of available AI providers"""
    try:
        manager = await get_ai_manager_for_tenant(current_user.tutor_id)
        return manager.get_available_providers()
    except Exception as e:
        logger.exception("Failed to get available providers")
        raise HTTPException(status_code=500, detail="Failed to retrieve providers")
