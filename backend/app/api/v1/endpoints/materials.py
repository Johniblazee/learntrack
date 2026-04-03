"""
Reference material management endpoints.
"""

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path as FilePath
from typing import Any, List, Optional
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, UploadFile
from fastapi.responses import RedirectResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core.database import get_database
from app.core.enhanced_auth import (
    ClerkUserContext,
    require_authenticated_user,
    require_student,
    require_tutor,
)
from app.core.exceptions import NotFoundError, ValidationError
from app.models.material import (
    Material,
    MaterialCreate,
    MaterialFolder,
    MaterialFolderCreate,
    MaterialFolderUpdate,
    MaterialStatus,
    MaterialUpdate,
)
from app.models.file import EmbeddingStatus, FileStatus, SyncStatus
from app.services.material_service import MaterialService
from app.services.r2_storage_service import (
    generate_presigned_url,
    upload_file as r2_upload,
)
from app.utils.pagination import PaginatedResponse, paginate

logger = structlog.get_logger()
router = APIRouter()


class MoveMaterialRequest(BaseModel):
    folder_id: Optional[str] = None


class BulkMaterialActionRequest(BaseModel):
    material_ids: List[str]


class BulkMoveMaterialRequest(BulkMaterialActionRequest):
    folder_id: Optional[str] = None


class BulkShareMaterialRequest(BulkMaterialActionRequest):
    shared_with_students: bool


def _material_type_from_file(file_name: str, content_type: Optional[str]) -> str:
    extension = FilePath(file_name).suffix.lower()

    if content_type and content_type.startswith("image/"):
        return "image"
    if content_type and content_type.startswith("video/"):
        return "video"

    if extension == ".pdf":
        return "pdf"
    if extension in {".doc", ".docx"}:
        return "doc"
    if extension in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
        return "image"
    if extension in {".mp4", ".mov", ".avi", ".webm", ".mkv"}:
        return "video"

    return "other"


def _tenant_tutor_id(current_user: ClerkUserContext) -> str:
    return current_user.tutor_id or current_user.clerk_id


async def _authorize_uploaded_file_access(
    *,
    file_name: str,
    current_user: ClerkUserContext,
    database: AsyncIOMotorDatabase,
) -> dict:
    file_doc = await database.files.find_one({"storage_key": file_name})
    if file_doc:
        file_tutor_id = str(file_doc.get("tutor_id") or "").strip()

        if current_user.role.value == "tutor":
            if file_tutor_id != current_user.clerk_id:
                raise HTTPException(status_code=403, detail="Access forbidden")
            return file_doc

        tenant_tutor_id = _tenant_tutor_id(current_user)
        if file_tutor_id != tenant_tutor_id:
            raise HTTPException(status_code=404, detail="File not found")

        material = await database.materials.find_one(
            {
                "file_id": str(file_doc.get("_id")),
                "tutor_id": tenant_tutor_id,
                "status": MaterialStatus.ACTIVE.value,
                "shared_with_students": True,
            }
        )
        if not material:
            raise HTTPException(status_code=403, detail="Access forbidden")

        return file_doc

    material_query: dict[str, Any] = {
        "file_url": {"$regex": f"/{re.escape(file_name)}$"}
    }
    if current_user.role.value == "tutor":
        material_query["tutor_id"] = current_user.clerk_id
    else:
        material_query.update(
            {
                "tutor_id": _tenant_tutor_id(current_user),
                "status": MaterialStatus.ACTIVE.value,
                "shared_with_students": True,
            }
        )

    material = await database.materials.find_one(material_query)
    if not material:
        raise HTTPException(status_code=404, detail="File not found")

    return {}


@router.post("/", response_model=Material)
async def create_material(
    material_data: MaterialCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Create a new reference material (tutor only)."""
    try:
        material_service = MaterialService(database)
        return await material_service.create_material(
            material_data, current_user.clerk_id
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to create material", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create material")


@router.get("/", response_model=PaginatedResponse[Material])
async def get_materials(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    material_type: Optional[str] = Query(None, description="Filter by material type"),
    status: Optional[str] = Query(None, description="Filter by status"),
    folder_id: Optional[str] = Query(None, description="Filter by folder ID"),
    include_subfolders: bool = Query(
        False,
        description="When folder_id is provided, include materials from subfolders",
    ),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get paginated materials for current tutor."""
    try:
        material_service = MaterialService(database)
        result = await material_service.get_materials_for_tutor(
            tutor_id=current_user.clerk_id,
            subject_id=subject_id,
            material_type=material_type,
            status=status,
            page=page,
            per_page=per_page,
            folder_id=folder_id,
            include_subfolders=include_subfolders,
        )
        return paginate(
            items=result["items"], page=page, per_page=per_page, total=result["total"]
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to get materials", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get materials")


@router.get("/folders", response_model=List[MaterialFolder])
async def list_material_folders(
    parent_id: Optional[str] = Query(None, description="Parent folder ID"),
    include_all: bool = Query(
        False,
        description="Include full folder tree instead of only one folder level",
    ),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """List material folders for current tutor."""
    try:
        material_service = MaterialService(database)
        return await material_service.list_folders(
            tutor_id=current_user.clerk_id,
            parent_id=parent_id,
            include_all=include_all,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to list material folders", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to list folders")


@router.post("/folders", response_model=MaterialFolder, status_code=201)
async def create_material_folder(
    folder_data: MaterialFolderCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Create a material folder for current tutor."""
    try:
        material_service = MaterialService(database)
        return await material_service.create_folder(folder_data, current_user.clerk_id)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to create material folder", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create folder")


@router.put("/folders/{folder_id}", response_model=MaterialFolder)
async def update_material_folder(
    folder_id: str,
    update_data: MaterialFolderUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Rename and/or move an existing material folder."""
    try:
        material_service = MaterialService(database)
        return await material_service.update_folder(
            folder_id=folder_id,
            update_data=update_data,
            tutor_id=current_user.clerk_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to update material folder", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update folder")


@router.delete("/folders/{folder_id}")
async def delete_material_folder(
    folder_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete a material folder and move descendants/materials to parent/root."""
    try:
        material_service = MaterialService(database)
        deleted = await material_service.delete_folder(
            folder_id=folder_id,
            tutor_id=current_user.clerk_id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Folder not found")
        return {"message": "Folder deleted successfully"}
    except HTTPException:
        raise
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to delete material folder", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to delete folder")


@router.get("/student", response_model=List[Material])
async def get_materials_for_student(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get materials accessible to students."""
    try:
        if not current_user.tutor_id:
            raise HTTPException(
                status_code=400,
                detail="Student not assigned to a tutor",
            )

        material_service = MaterialService(database)
        return await material_service.get_materials_for_student(
            tutor_id=current_user.tutor_id,
            subject_id=subject_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get materials for student", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get materials")


@router.post("/upload")
async def upload_material_file(
    file: UploadFile = File(...),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Upload a material file to R2 cloud storage."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    max_size_bytes = 25 * 1024 * 1024
    if len(content) > max_size_bytes:
        raise HTTPException(status_code=413, detail="File exceeds 25MB size limit")

    extension = FilePath(file.filename).suffix.lower()
    safe_name = f"{uuid4().hex}{extension}"
    tenant_path = f"{current_user.clerk_id}/{safe_name}"
    content_type = file.content_type or "application/octet-stream"

    # Upload to Cloudflare R2
    try:
        await r2_upload(content, tenant_path, content_type)
    except Exception as e:
        logger.error("Failed to upload file to R2", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to store uploaded file")

    source_path = f"/api/v1/materials/files/{safe_name}"
    uploaded_at = datetime.now(timezone.utc)
    file_doc = {
        "storage_key": safe_name,
        "file_url": source_path,
        "source_url": source_path,
        "storage_path": None,
        "r2_key": tenant_path,
        "filename": file.filename,
        "content_type": content_type,
        "size": len(content),
        "uploaded_by": current_user.clerk_id,
        "uploaded_at": uploaded_at,
        "tutor_id": current_user.clerk_id,
        "tenant_path": tenant_path,
        "status": FileStatus.PROCESSING.value,
        "processing_started_at": uploaded_at,
        "embedding_status": EmbeddingStatus.PENDING.value,
        "sync_status": SyncStatus.SYNCED.value,
        "processing_attempts": 1,
        "content_hash": hashlib.sha256(content).hexdigest(),
        "character_count": None,
        "token_estimate": None,
        "processor_used": None,
        "extracted_text": None,
    }
    insert_result = await database.files.insert_one(file_doc)
    file_id = str(insert_result.inserted_id)

    processing_updates = {
        "status": FileStatus.ERROR.value,
        "processing_completed_at": datetime.now(timezone.utc),
        "error_message": "Document text extraction did not run",
    }

    # Extract text from in-memory bytes using temp file
    try:
        from app.rag.processors.document_processor import get_document_processor

        processor = get_document_processor()
        documents = await processor.load_from_bytes(content, file.filename)
        extracted_text = "\n\n".join(doc.page_content for doc in documents).strip()
        completed_at = datetime.now(timezone.utc)
        processing_updates = {
            "status": FileStatus.PROCESSED.value,
            "processing_completed_at": completed_at,
            "error_message": None,
            "extracted_text": extracted_text,
            "character_count": len(extracted_text),
            "token_estimate": max(
                len(extracted_text.split()), len(extracted_text) // 4
            ),
            "processor_used": "langchain-docling",
            "last_synced_at": completed_at,
        }
    except Exception as processing_error:
        logger.warning(
            "Failed to extract uploaded material text",
            file_id=file_id,
            filename=file.filename,
            error=str(processing_error),
        )
        processing_updates = {
            **processing_updates,
            "error_message": str(processing_error),
        }

    await database.files.update_one(
        {"_id": insert_result.inserted_id},
        {"$set": processing_updates},
    )

    return {
        "file_id": file_id,
        "file_url": source_path,
        "file_size": len(content),
        "material_type": _material_type_from_file(file.filename, file.content_type),
        "filename": file.filename,
        "uploaded_by": current_user.clerk_id,
        "processing_status": processing_updates["status"],
        "processing_error": processing_updates.get("error_message"),
    }


@router.post("/bulk-move", response_model=dict)
async def bulk_move_materials(
    move_data: BulkMoveMaterialRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Move multiple materials to another folder or back to root."""
    try:
        material_service = MaterialService(database)
        return await material_service.bulk_move_materials(
            material_ids=move_data.material_ids,
            tutor_id=current_user.clerk_id,
            folder_id=move_data.folder_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk move materials", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to bulk move materials")


@router.post("/bulk-share", response_model=dict)
async def bulk_share_materials(
    share_data: BulkShareMaterialRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update student visibility for multiple materials."""
    try:
        material_service = MaterialService(database)
        return await material_service.bulk_update_material_sharing(
            material_ids=share_data.material_ids,
            tutor_id=current_user.clerk_id,
            shared_with_students=share_data.shared_with_students,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk update material sharing", error=str(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to bulk update material sharing",
        )


@router.post("/bulk-delete", response_model=dict)
async def bulk_delete_materials(
    delete_data: BulkMaterialActionRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Archive multiple materials at once."""
    try:
        material_service = MaterialService(database)
        return await material_service.bulk_archive_materials(
            material_ids=delete_data.material_ids,
            tutor_id=current_user.clerk_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk delete materials", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to bulk delete materials")


@router.get("/files/{file_name}")
async def get_uploaded_material_file(
    file_name: str = Path(..., description="Stored material file name"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Serve uploaded material files via R2 presigned URL redirect."""
    sanitized_name = FilePath(file_name).name
    if sanitized_name != file_name:
        raise HTTPException(status_code=400, detail="Invalid file name")

    file_doc = await _authorize_uploaded_file_access(
        file_name=sanitized_name,
        current_user=current_user,
        database=database,
    )

    # Generate presigned URL from R2
    r2_key = file_doc.get("r2_key") or file_doc.get("tenant_path")
    if not r2_key:
        raise HTTPException(status_code=404, detail="File not found in storage")

    presigned_url = generate_presigned_url(r2_key)
    if not presigned_url:
        raise HTTPException(status_code=503, detail="Storage service unavailable")

    return RedirectResponse(url=presigned_url, status_code=302)


@router.put("/{material_id}/move", response_model=Material)
async def move_material(
    move_data: MoveMaterialRequest,
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Move a material to another folder or back to root."""
    try:
        material_service = MaterialService(database)
        return await material_service.move_material(
            material_id=material_id,
            tutor_id=current_user.clerk_id,
            folder_id=move_data.folder_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to move material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to move material")


@router.get("/{material_id}", response_model=Material)
async def get_material(
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get a specific material."""
    try:
        tenant_tutor_id = current_user.tutor_id or current_user.clerk_id
        material_service = MaterialService(database)
        material = await material_service.get_material_by_id(
            material_id=material_id,
            tutor_id=tenant_tutor_id,
        )

        if current_user.role.value != "tutor" and not material.shared_with_students:
            raise HTTPException(status_code=403, detail="Material is private")
        if (
            current_user.role.value != "tutor"
            and material.status != MaterialStatus.ACTIVE
        ):
            raise HTTPException(status_code=404, detail="Material not available")

        await material_service.increment_view_count(material_id)
        return material
    except HTTPException:
        raise
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to get material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get material")


@router.put("/{material_id}", response_model=Material)
async def update_material(
    update_data: MaterialUpdate,
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update a material (tutor only)."""
    try:
        material_service = MaterialService(database)
        return await material_service.update_material(
            material_id=material_id,
            update_data=update_data,
            tutor_id=current_user.clerk_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to update material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update material")


@router.delete("/{material_id}")
async def delete_material(
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete (archive) a material (tutor only)."""
    try:
        material_service = MaterialService(database)
        await material_service.delete_material(
            material_id=material_id,
            tutor_id=current_user.clerk_id,
        )
        return {"message": "Material deleted successfully"}
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to delete material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to delete material")


@router.post("/{material_id}/link-question/{question_id}", response_model=Material)
async def link_material_to_question(
    material_id: str = Path(..., description="Material ID"),
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Link material to a question (tutor only)."""
    try:
        material_service = MaterialService(database)
        return await material_service.link_to_question(
            material_id=material_id,
            question_id=question_id,
            tutor_id=current_user.clerk_id,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to link material to question", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to link material")


@router.post("/{material_id}/link-assignment/{assignment_id}", response_model=Material)
async def link_material_to_assignment(
    material_id: str = Path(..., description="Material ID"),
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Link material to an assignment (tutor only)."""
    try:
        material_service = MaterialService(database)
        return await material_service.link_to_assignment(
            material_id=material_id,
            assignment_id=assignment_id,
            tutor_id=current_user.clerk_id,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to link material to assignment", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to link material")


@router.post("/{material_id}/download")
async def track_download(
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Track material download."""
    try:
        material_service = MaterialService(database)
        material = await material_service.get_material_by_id(
            material_id=material_id,
            tutor_id=_tenant_tutor_id(current_user),
        )
        if current_user.role.value != "tutor" and not material.shared_with_students:
            raise HTTPException(status_code=403, detail="Material is private")
        if (
            current_user.role.value != "tutor"
            and material.status != MaterialStatus.ACTIVE
        ):
            raise HTTPException(status_code=404, detail="Material not available")

        await material_service.increment_download_count(material_id)
        return {"message": "Download tracked"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to track download", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to track download")
