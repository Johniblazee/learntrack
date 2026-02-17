"""
Reference Material management endpoints
"""

from typing import List, Optional
from pathlib import Path as FilePath
from uuid import uuid4
import mimetypes

from fastapi import (
    APIRouter,
    Depends,
    Path,
    Query,
    HTTPException,
    UploadFile,
    File,
)
from fastapi.responses import FileResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_tutor,
    require_authenticated_user,
    ClerkUserContext,
)
from app.models.material import Material, MaterialCreate, MaterialUpdate
from app.services.material_service import MaterialService
from app.utils.pagination import PaginatedResponse, paginate

logger = structlog.get_logger()
router = APIRouter()

BACKEND_ROOT = FilePath(__file__).resolve().parents[4]
MATERIAL_UPLOAD_DIR = BACKEND_ROOT / "uploads" / "materials"
MATERIAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


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


@router.post("/", response_model=Material)
async def create_material(
    material_data: MaterialCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Create a new reference material (tutor only)"""
    try:
        material_service = MaterialService(database)
        material = await material_service.create_material(
            material_data, current_user.clerk_id
        )
        return material
    except Exception as e:
        logger.error("Failed to create material", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create material")


@router.get("/", response_model=PaginatedResponse[Material])
async def get_materials(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    material_type: Optional[str] = Query(None, description="Filter by material type"),
    status: Optional[str] = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get paginated materials for current tutor"""
    try:
        material_service = MaterialService(database)
        result = await material_service.get_materials_for_tutor(
            tutor_id=current_user.clerk_id,
            subject_id=subject_id,
            material_type=material_type,
            status=status,
            page=page,
            per_page=per_page,
        )
        return paginate(
            items=result["items"], page=page, per_page=per_page, total=result["total"]
        )
    except Exception as e:
        logger.error("Failed to get materials", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get materials")


@router.get("/student", response_model=List[Material])
async def get_materials_for_student(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get materials accessible to students"""
    try:
        # Get student's tutor_id
        if not current_user.tutor_id:
            raise HTTPException(
                status_code=400, detail="Student not assigned to a tutor"
            )

        material_service = MaterialService(database)
        materials = await material_service.get_materials_for_student(
            tutor_id=current_user.tutor_id, subject_id=subject_id
        )
        return materials
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get materials for student", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get materials")


@router.post("/upload")
async def upload_material_file(
    file: UploadFile = File(...),
    current_user: ClerkUserContext = Depends(require_tutor),
):
    """Upload a material file and return a URL that can be saved in material records."""
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
    output_path = MATERIAL_UPLOAD_DIR / safe_name

    try:
        output_path.write_bytes(content)
    except Exception as e:
        logger.error("Failed to persist uploaded material file", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to store uploaded file")

    return {
        "file_url": f"/api/v1/materials/files/{safe_name}",
        "file_size": len(content),
        "material_type": _material_type_from_file(file.filename, file.content_type),
        "filename": file.filename,
        "uploaded_by": current_user.clerk_id,
    }


@router.get("/files/{file_name}")
async def get_uploaded_material_file(
    file_name: str = Path(..., description="Stored material file name"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
):
    """Serve uploaded material files."""
    del current_user

    sanitized_name = FilePath(file_name).name
    if sanitized_name != file_name:
        raise HTTPException(status_code=400, detail="Invalid file name")

    file_path = MATERIAL_UPLOAD_DIR / sanitized_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(path=file_path, media_type=media_type, filename=file_path.name)


@router.get("/{material_id}", response_model=Material)
async def get_material(
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get a specific material"""
    try:
        material_service = MaterialService(database)
        material = await material_service.get_material_by_id(material_id)

        # Increment view count
        await material_service.increment_view_count(material_id)

        return material
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{material_id}", response_model=Material)
async def update_material(
    update_data: MaterialUpdate,
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Update a material (tutor only)"""
    try:
        material_service = MaterialService(database)
        material = await material_service.update_material(material_id, update_data)
        return material
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{material_id}")
async def delete_material(
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Delete a material (tutor only)"""
    try:
        material_service = MaterialService(database)
        await material_service.delete_material(material_id)
        return {"message": "Material deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete material", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{material_id}/link-question/{question_id}", response_model=Material)
async def link_material_to_question(
    material_id: str = Path(..., description="Material ID"),
    question_id: str = Path(..., description="Question ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Link material to a question (tutor only)"""
    try:
        material_service = MaterialService(database)
        material = await material_service.link_to_question(material_id, question_id)
        return material
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to link material to question", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{material_id}/link-assignment/{assignment_id}", response_model=Material)
async def link_material_to_assignment(
    material_id: str = Path(..., description="Material ID"),
    assignment_id: str = Path(..., description="Assignment ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Link material to an assignment (tutor only)"""
    try:
        material_service = MaterialService(database)
        material = await material_service.link_to_assignment(material_id, assignment_id)
        return material
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to link material to assignment", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{material_id}/download")
async def track_download(
    material_id: str = Path(..., description="Material ID"),
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Track material download"""
    try:
        material_service = MaterialService(database)
        await material_service.increment_download_count(material_id)
        return {"message": "Download tracked"}
    except Exception as e:
        logger.error("Failed to track download", material_id=material_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
