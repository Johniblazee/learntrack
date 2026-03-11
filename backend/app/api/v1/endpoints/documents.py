"""
Document Management Dashboard API Endpoints
Provides stats, list, detail, and batch operations for document management
"""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_database
from app.core.enhanced_auth import require_authenticated_user, ClerkUserContext
from app.models.file import EmbeddingStatus, SyncStatus
from app.core.utils import to_object_id, escape_regex

router = APIRouter()


def _create_governance_service(db: AsyncIOMotorDatabase):
    from app.services.document_governance_service import DocumentGovernanceService

    return DocumentGovernanceService(db)


# ==================== Request/Response Models ====================


class DocumentStats(BaseModel):
    """Document dashboard statistics"""

    total_documents: int = 0
    total_chunks: int = 0
    total_tokens: int = 0
    by_status: dict = {}
    by_format: dict = {}
    by_processor: dict = {}
    storage_used_mb: float = 0.0
    last_ingestion: Optional[datetime] = None
    pending_count: int = 0
    failed_count: int = 0


class DocumentListItem(BaseModel):
    """Document list item"""

    id: str
    filename: str
    content_type: str
    size: int
    embedding_status: str
    sync_status: str
    chunk_count: int
    token_estimate: Optional[int] = None
    processor_used: Optional[str] = None
    created_at: datetime
    last_embedded_at: Optional[datetime] = None


class DocumentListResponse(BaseModel):
    """Paginated document list response"""

    items: List[DocumentListItem]
    total: int
    page: int
    per_page: int
    total_pages: int


class DocumentDetail(BaseModel):
    """Full document detail"""

    id: str
    filename: str
    content_type: str
    size: int
    uploadthing_url: str
    embedding_status: str
    sync_status: str
    chunk_count: int
    character_count: Optional[int] = None
    token_estimate: Optional[int] = None
    content_hash: Optional[str] = None
    page_count: Optional[int] = None
    processor_used: Optional[str] = None
    processing_time: Optional[float] = None
    embedding_version: int = 1
    processing_attempts: int = 0
    last_error: Optional[str] = None
    processing_history: List[dict] = []
    created_at: datetime
    last_embedded_at: Optional[datetime] = None
    last_synced_at: Optional[datetime] = None


class BatchDeleteRequest(BaseModel):
    """Batch delete request"""

    file_ids: List[str]
    hard_delete: bool = False


class BatchResyncRequest(BaseModel):
    """Batch resync request"""

    file_ids: List[str]
    force: bool = False


class BatchStatusRequest(BaseModel):
    """Batch status request"""

    file_ids: List[str]


# ==================== Dashboard Stats Endpoint ====================


@router.get("/dashboard/stats", response_model=DocumentStats)
async def get_dashboard_stats(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get aggregated document statistics for the dashboard.
    Returns counts by status, format, processor, and storage usage.
    """
    tutor_id = current_user.tutor_id or current_user.clerk_id
    files_collection = db.files

    # Build base query for tutor's non-deleted files
    base_query = {"tutor_id": tutor_id, "status": {"$ne": "deleted"}}

    # Get total documents
    total_documents = await files_collection.count_documents(base_query)

    # Aggregation pipeline for stats
    pipeline = [
        {"$match": base_query},
        {
            "$group": {
                "_id": None,
                "total_chunks": {"$sum": "$chunk_count"},
                "total_tokens": {"$sum": {"$ifNull": ["$token_estimate", 0]}},
                "total_size": {"$sum": "$size"},
                "last_ingestion": {"$max": "$last_embedded_at"},
            }
        },
    ]

    agg_result = await files_collection.aggregate(pipeline).to_list(1)
    agg_data = agg_result[0] if agg_result else {}

    # Count by embedding status
    status_pipeline = [
        {"$match": base_query},
        {"$group": {"_id": "$embedding_status", "count": {"$sum": 1}}},
    ]
    status_result = await files_collection.aggregate(status_pipeline).to_list(10)
    by_status = {item["_id"] or "unknown": item["count"] for item in status_result}

    # Count by content type (format)
    format_pipeline = [
        {"$match": base_query},
        {"$group": {"_id": "$content_type", "count": {"$sum": 1}}},
    ]
    format_result = await files_collection.aggregate(format_pipeline).to_list(20)
    by_format = {item["_id"] or "unknown": item["count"] for item in format_result}

    # Count by processor
    processor_pipeline = [
        {"$match": {**base_query, "processor_used": {"$ne": None}}},
        {"$group": {"_id": "$processor_used", "count": {"$sum": 1}}},
    ]
    processor_result = await files_collection.aggregate(processor_pipeline).to_list(10)

    by_processor = {
        item["_id"] or "unknown": item["count"] for item in processor_result
    }

    return DocumentStats(
        total_documents=total_documents,
        total_chunks=int(agg_data.get("total_chunks", 0) or 0),
        total_tokens=int(agg_data.get("total_tokens", 0) or 0),
        by_status=by_status,
        by_format=by_format,
        by_processor=by_processor,
        storage_used_mb=round((agg_data.get("total_size", 0) or 0) / (1024 * 1024), 2),
        last_ingestion=agg_data.get("last_ingestion"),
        pending_count=int(by_status.get(EmbeddingStatus.PENDING.value, 0)),
        failed_count=int(by_status.get(EmbeddingStatus.FAILED.value, 0)),
    )


# ==================== Document List Endpoint ====================


@router.get("/dashboard/list", response_model=DocumentListResponse)
async def get_document_list(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    status: Optional[str] = Query(None, description="Filter by embedding status"),
    format: Optional[str] = Query(None, description="Filter by content type"),
    sync_status: Optional[str] = Query(None, description="Filter by sync status"),
    search: Optional[str] = Query(None, description="Search by filename"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order (asc/desc)"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """
    Get paginated list of documents with filters and sorting.
    """
    tutor_id = current_user.tutor_id
    files_collection = db.files

    # Build query
    query = {"tutor_id": tutor_id, "status": {"$ne": "deleted"}}

    if status:
        query["embedding_status"] = status
    if format:
        query["content_type"] = format
    if sync_status:
        query["sync_status"] = sync_status
    if search:
        query["filename"] = {"$regex": escape_regex(search), "$options": "i"}

    # Get total count
    total = await files_collection.count_documents(query)

    # Sort direction
    sort_dir = -1 if sort_order == "desc" else 1

    # Get paginated results
    skip = (page - 1) * per_page
    cursor = (
        files_collection.find(query).sort(sort_by, sort_dir).skip(skip).limit(per_page)
    )

    items = []
    async for doc in cursor:
        items.append(
            DocumentListItem(
                id=str(doc["_id"]),
                filename=doc.get("filename", ""),
                content_type=doc.get("content_type", ""),
                size=doc.get("size", 0),
                embedding_status=doc.get(
                    "embedding_status", EmbeddingStatus.PENDING.value
                ),
                sync_status=doc.get("sync_status", SyncStatus.NEVER_SYNCED.value),
                chunk_count=doc.get("chunk_count", 0),
                token_estimate=doc.get("token_estimate"),
                processor_used=doc.get("processor_used"),
                created_at=doc.get("created_at", doc.get("uploaded_at")),
                last_embedded_at=doc.get("last_embedded_at"),
            )
        )

    return DocumentListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        total_pages=(total + per_page - 1) // per_page if per_page > 0 else 0,
    )


# ==================== Document Detail Endpoint ====================


@router.get("/dashboard/{document_id}", response_model=DocumentDetail)
async def get_document_detail(
    document_id: str,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get full document details including processing history.
    """
    tutor_id = current_user.tutor_id
    files_collection = db.files

    try:
        oid = to_object_id(document_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid document ID")

    doc = await files_collection.find_one({"_id": oid, "tutor_id": tutor_id})

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return DocumentDetail(
        id=str(doc["_id"]),
        filename=doc.get("filename", ""),
        content_type=doc.get("content_type", ""),
        size=doc.get("size", 0),
        uploadthing_url=str(doc.get("uploadthing_url", "")),
        embedding_status=doc.get("embedding_status", EmbeddingStatus.PENDING.value),
        sync_status=doc.get("sync_status", SyncStatus.NEVER_SYNCED.value),
        chunk_count=doc.get("chunk_count", 0),
        character_count=doc.get("character_count"),
        token_estimate=doc.get("token_estimate"),
        content_hash=doc.get("content_hash"),
        page_count=doc.get("page_count"),
        processor_used=doc.get("processor_used"),
        processing_time=doc.get("processing_time"),
        embedding_version=doc.get("embedding_version", 1),
        processing_attempts=doc.get("processing_attempts", 0),
        last_error=doc.get("embedding_error"),
        processing_history=doc.get("processing_history", []),
        created_at=doc.get("created_at", doc.get("uploaded_at")),
        last_embedded_at=doc.get("last_embedded_at"),
        last_synced_at=doc.get("last_synced_at"),
    )


# ==================== Batch Operations Endpoints ====================


@router.post("/batch/delete")
async def batch_delete_documents(
    request: BatchDeleteRequest,
    background_tasks: BackgroundTasks,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Delete multiple documents and their embeddings in batch.
    """
    tutor_id = current_user.tutor_id
    governance_service = _create_governance_service(db)

    result = await governance_service.batch_delete_files(
        file_ids=request.file_ids, tutor_id=tutor_id, hard_delete=request.hard_delete
    )

    return result


@router.post("/batch/resync")
async def batch_resync_documents(
    request: BatchResyncRequest,
    background_tasks: BackgroundTasks,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Re-sync multiple documents in batch (re-process and re-embed).
    """
    tutor_id = current_user.tutor_id
    governance_service = _create_governance_service(db)

    result = await governance_service.batch_resync_files(
        file_ids=request.file_ids, tutor_id=tutor_id, force=request.force
    )

    return result


@router.post("/batch/status")
async def batch_get_status(
    request: BatchStatusRequest,
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get status of multiple documents.
    """
    tutor_id = current_user.tutor_id
    files_collection = db.files

    statuses = []
    for file_id in request.file_ids:
        try:
            oid = to_object_id(file_id)
            doc = await files_collection.find_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "_id": 1,
                    "filename": 1,
                    "embedding_status": 1,
                    "sync_status": 1,
                    "chunk_count": 1,
                    "embedding_error": 1,
                },
            )
            if doc:
                statuses.append(
                    {
                        "file_id": str(doc["_id"]),
                        "filename": doc.get("filename"),
                        "embedding_status": doc.get("embedding_status"),
                        "sync_status": doc.get("sync_status"),
                        "chunk_count": doc.get("chunk_count", 0),
                        "error": doc.get("embedding_error"),
                    }
                )
        except:
            pass

    return {"statuses": statuses, "count": len(statuses)}


@router.post("/{document_id}/resync")
async def resync_single_document(
    document_id: str,
    force: bool = Query(False, description="Force resync even if not needed"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Re-sync a single document.
    """
    tutor_id = current_user.tutor_id
    governance_service = _create_governance_service(db)

    result = await governance_service.resync_document(
        file_id=document_id, tutor_id=tutor_id, force=force
    )

    return result


@router.get("/needs-resync")
async def get_documents_needing_resync(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get list of documents that need re-syncing.
    """
    tutor_id = current_user.tutor_id
    governance_service = _create_governance_service(db)

    files = await governance_service.get_files_needing_resync(tutor_id)

    return {"files": files, "count": len(files)}
