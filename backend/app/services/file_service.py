"""
File processing service for UploadThing integration
"""

import asyncio
import httpx
from typing import List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.file import (
    UploadedFile,
    FileMetadataRequest,
    FileProcessingResult,
    FileStatus,
    FileType,
    UploadThingFileCreate,
    UploadThingFileUpdate,
)
from app.models.question import QuestionDifficulty
from app.ai.services.ai_manager import AIManager
from app.services.question_service import QuestionService
from app.rag.processors.document_processor import DocumentProcessor, ProcessingOptions
from app.ai.services.cost_tracker import CostTrackingService
from app.core.exceptions import (
    FileProcessingError,
    ValidationError,
    NotFoundError,
    DatabaseException,
)
from app.core.config import settings
from app.core.utils import to_object_id

logger = structlog.get_logger()


class FileService:
    """Service for handling UploadThing file processing"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.files
        self.http_client = httpx.AsyncClient()
        self.document_processor = DocumentProcessor()
        self.cost_service = CostTrackingService(database)

    async def register_file_metadata(
        self,
        request: FileMetadataRequest,
        uploaded_by: str,
        tutor_id: str,  # Required for tenant isolation
    ) -> UploadedFile:
        """Register file metadata after UploadThing upload (with tenant isolation)"""
        try:
            # Validate file type
            if request.content_type not in settings.ALLOWED_FILE_TYPES:
                raise ValidationError(f"File type {request.content_type} not allowed")

            # Validate file size
            if request.size > settings.MAX_FILE_SIZE:
                raise ValidationError(
                    f"File size exceeds maximum of {settings.MAX_FILE_SIZE} bytes"
                )

            # Create file record
            file_data = UploadThingFileCreate(
                uploadthing_key=request.uploadthing_key,
                uploadthing_url=request.uploadthing_url,
                filename=request.filename,
                content_type=request.content_type,
                size=request.size,
                uploaded_by=uploaded_by,
                subject_id=request.subject_id,
                topic=request.topic,
            )

            # Insert into database with tutor_id for tenant isolation
            file_dict = file_data.dict()
            file_dict["tutor_id"] = tutor_id  # Add tutor_id for tenant isolation
            file_dict["tenant_path"] = (
                f"tenants/{tutor_id}/files/{request.filename}"  # Tenant-prefixed path
            )
            file_dict["created_at"] = datetime.now(timezone.utc)
            file_dict["updated_at"] = datetime.now(timezone.utc)
            file_dict["status"] = FileStatus.UPLOADED

            result = await self.collection.insert_one(file_dict)
            file_dict["_id"] = result.inserted_id

            uploaded_file = UploadedFile(**file_dict)

            logger.info(
                "File metadata registered",
                file_id=str(result.inserted_id),
                filename=request.filename,
                uploadthing_key=request.uploadthing_key,
                tutor_id=tutor_id,
            )
            return uploaded_file

        except Exception as e:
            if isinstance(e, (ValidationError, FileProcessingError)):
                raise
            logger.error(
                "File metadata registration failed",
                error=str(e),
                filename=request.filename,
                tutor_id=tutor_id,
            )
            raise FileProcessingError(f"File metadata registration failed: {str(e)}")

    async def get_file(
        self, file_id: str, user_id: str, tutor_id: Optional[str] = None
    ) -> Optional[UploadedFile]:
        """Get file by ID with user authorization and optional tenant isolation"""
        try:
            oid = to_object_id(file_id)
            query = {"_id": oid}

            # Add tutor_id filter for tenant isolation if provided
            if tutor_id:
                query["tutor_id"] = tutor_id

            file = await self.collection.find_one(query)

            if not file:
                return None

            # Check if user has access to this file (must be uploader OR same tenant)
            file_tutor_id = file.get("tutor_id")
            file_uploader = file.get("uploaded_by")

            # Allow access if: user is the uploader OR user is in the same tenant
            if file_uploader != user_id and file_tutor_id != tutor_id:
                return None

            return UploadedFile(**file)

        except Exception as e:
            logger.error("Failed to get file", file_id=file_id, error=str(e))
            return None

    async def list_user_files(
        self, user_id: str, tutor_id: Optional[str] = None
    ) -> List[UploadedFile]:
        """List files for a user with optional tenant isolation"""
        try:
            query = {"uploaded_by": user_id, "status": {"$ne": "deleted"}}

            # Add tutor_id filter for tenant isolation if provided
            if tutor_id:
                query["tutor_id"] = tutor_id

            cursor = self.collection.find(query).sort("created_at", -1)
            files = []
            async for file in cursor:
                files.append(UploadedFile(**file))
            return files
        except Exception as e:
            logger.error(
                "Failed to list user files",
                user_id=user_id,
                tutor_id=tutor_id,
                error=str(e),
            )
            return []

    async def list_tutor_files(self, tutor_id: str) -> List[UploadedFile]:
        """List all files for a tutor (tenant-scoped)"""
        try:
            query = {"tutor_id": tutor_id, "status": {"$ne": "deleted"}}
            cursor = self.collection.find(query).sort("created_at", -1)
            files = []
            async for file in cursor:
                files.append(UploadedFile(**file))
            return files
        except Exception as e:
            logger.error("Failed to list tutor files", tutor_id=tutor_id, error=str(e))
            return []

    async def delete_file(
        self, file_id: str, user_id: str, tutor_id: Optional[str] = None
    ) -> bool:
        """Delete file with user authorization and tenant isolation"""
        try:
            file = await self.get_file(file_id, user_id, tutor_id)
            if not file:
                return False

            # Build query with tenant isolation
            query = {"_id": to_object_id(file_id), "uploaded_by": user_id}
            if tutor_id:
                query["tutor_id"] = tutor_id

            # Soft delete - mark as deleted
            result = await self.collection.update_one(
                query,
                {
                    "$set": {
                        "status": "deleted",
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count > 0:
                logger.info(
                    "File deleted", file_id=file_id, user_id=user_id, tutor_id=tutor_id
                )
                return True
            return False

        except Exception as e:
            logger.error("Failed to delete file", file_id=file_id, error=str(e))
            return False

    async def process_file_for_questions(
        self,
        file_id: str,
        user_id: str,
        question_count: int = 10,
        difficulty_level: str = "medium",
        ai_provider: str = "openai",
        question_service: Optional[QuestionService] = None,
    ) -> FileProcessingResult:
        """Process file to generate questions with enhanced document processing"""
        try:
            # Get file
            file = await self.get_file(file_id, user_id)
            if not file:
                raise FileProcessingError("File not found or access denied", file_id)

            # Update file status to processing
            await self._update_file_status(
                file_id,
                {
                    "status": FileStatus.PROCESSING,
                    "processing_started_at": datetime.now(timezone.utc),
                    "ai_provider_used": ai_provider,
                },
            )

            start_time = datetime.now(timezone.utc)

            # Download file from UploadThing for processing
            response = await self.http_client.get(str(file.uploadthing_url))
            response.raise_for_status()
            file_content = response.content

            # Process document with enhanced semantic chunking
            processing_options = ProcessingOptions(
                use_semantic_chunking=True,
                preserve_structure=True,
                chunk_size=1000,
                chunk_overlap=200,
            )

            # Process document using DocumentProcessor
            documents = await self.document_processor.load_from_bytes(
                file_bytes=file_content,
                filename=file.filename,
                export_type=processing_options.export_type,
            )

            # Extract text content from documents
            text_content = "\n\n".join(doc.page_content for doc in documents)

            # Get AI settings and create manager
            from app.services.settings_service import SettingsService

            settings_service = SettingsService(self.db)
            current_settings = await settings_service.get_settings()
            ai_settings = {
                "providers": current_settings.ai.providers,
                "default_provider": current_settings.ai.default_provider,
            }
            ai_manager = AIManager(ai_settings)

            # Generate questions using AI
            # Convert difficulty_level string to enum
            difficulty = QuestionDifficulty(difficulty_level.lower())

            questions = await ai_manager.generate_questions(
                text_content=text_content,
                subject=file.subject_id,
                topic=file.topic,
                question_count=question_count,
                difficulty=difficulty,
                preferred_provider=ai_provider,
            )

            # Save questions to database if question_service provided
            saved_count = 0
            if question_service and questions:
                for question in questions:
                    try:
                        await question_service.create_question(question, user_id)
                        saved_count += 1
                    except Exception as e:
                        logger.warning("Failed to save question", error=str(e))

            processing_time = (datetime.now(timezone.utc) - start_time).total_seconds()

            # Update file status to processed
            await self._update_file_status(
                file_id,
                {
                    "status": FileStatus.PROCESSED,
                    "processing_completed_at": datetime.now(timezone.utc),
                    "extracted_text": text_content[:1000],  # Store first 1000 chars
                    "generated_questions_count": len(questions),
                    "processing_time": processing_time,
                },
            )

            logger.info(
                "File processed successfully",
                file_id=file_id,
                questions_generated=len(questions),
                questions_saved=saved_count,
                processing_time=processing_time,
            )

            return FileProcessingResult(
                file_id=file_id,
                status=FileStatus.PROCESSED,
                questions_generated=len(questions),
                processing_time=processing_time,
            )

        except Exception as e:
            # Update file status to error
            await self._update_file_status(
                file_id, {"status": FileStatus.ERROR, "error_message": str(e)}
            )

            logger.error("File processing failed", file_id=file_id, error=str(e))

            return FileProcessingResult(
                file_id=file_id, status=FileStatus.ERROR, error_message=str(e)
            )

    async def _download_and_extract_text(
        self, file: UploadedFile, ai_manager: Optional[AIManager] = None
    ) -> str:
        """Download file from UploadThing and extract text content"""
        try:
            # Download file content from UploadThing
            response = await self.http_client.get(str(file.uploadthing_url))
            response.raise_for_status()

            file_content = response.content

            if file.content_type == FileType.TXT:
                # Plain text file
                return file_content.decode("utf-8")

            elif file.content_type in [
                FileType.PDF,
                FileType.DOCX,
                FileType.DOC,
                FileType.PPTX,
                FileType.PPT,
            ]:
                # For binary files, use DocumentProcessor to extract text
                # This properly handles different file formats
                from app.rag.processors.document_processor import ProcessingOptions

                processing_options = ProcessingOptions(
                    use_semantic_chunking=False,  # Don't chunk for preview
                    preserve_structure=True,
                    chunk_size=4000,
                    chunk_overlap=0,
                )

                documents = await self.document_processor.load_from_bytes(
                    file_bytes=file_content,
                    filename=file.filename,
                    export_type=processing_options.export_type,
                )

                # Join all document content for preview (first 4000 chars)
                full_text = "\n\n".join(doc.page_content for doc in documents)
                content_preview = full_text[:4000]

                if ai_manager:
                    extracted_text = await ai_manager.extract_text_from_content(
                        content_preview, file.content_type
                    )
                else:
                    # Fallback to global instance if no manager provided
                    from app.ai.services.ai_manager import (
                        get_default_ai_manager,
                    )

                    global_ai_manager = get_default_ai_manager()

                    extracted_text = await global_ai_manager.extract_text_from_content(
                        content_preview, file.content_type
                    )

                return extracted_text

            else:
                raise FileProcessingError(f"Unsupported file type: {file.content_type}")

        except Exception as e:
            logger.error("Text extraction failed", file_id=str(file.id), error=str(e))
            raise FileProcessingError(f"Text extraction failed: {str(e)}", str(file.id))

    async def _update_file_status(self, file_id: str, updates: dict) -> bool:
        """Update file status in database"""
        try:
            updates["updated_at"] = datetime.now(timezone.utc)
            oid = to_object_id(file_id)
            result = await self.collection.update_one({"_id": oid}, {"$set": updates})
            return result.matched_count > 0
        except Exception as e:
            logger.error("Failed to update file status", file_id=file_id, error=str(e))
            return False

    async def get_processing_status(
        self, file_id: str, user_id: str
    ) -> FileProcessingResult:
        """Get file processing status"""
        file = await self.get_file(file_id, user_id)
        if not file:
            raise FileProcessingError("File not found or access denied", file_id)

        return FileProcessingResult(
            file_id=file_id,
            status=file.status,
            questions_generated=file.generated_questions_count or 0,
            processing_time=file.processing_time,
            error_message=file.error_message,
        )

    async def get_storage_stats(self, tutor_id: Optional[str] = None) -> dict:
        """Get storage statistics (tenant-scoped if tutor_id provided)"""
        try:
            # Build query with tenant isolation
            query = {"status": {"$ne": "deleted"}}
            if tutor_id:
                query["tutor_id"] = tutor_id

            total_files = await self.collection.count_documents(query)

            # Get total size with tenant filter
            pipeline = [
                {"$match": query},
                {"$group": {"_id": None, "total_size": {"$sum": "$size"}}},
            ]

            result = await self.collection.aggregate(pipeline).to_list(1)
            total_size = result[0]["total_size"] if result else 0

            return {
                "total_files": total_files,
                "total_size_bytes": total_size,
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "tutor_id": tutor_id,  # Include tutor_id in response for clarity
            }
        except Exception as e:
            logger.error("Failed to get storage stats", error=str(e), tutor_id=tutor_id)
            return {
                "total_files": 0,
                "total_size_bytes": 0,
                "total_size_mb": 0,
                "tutor_id": tutor_id,
            }

    async def close(self):
        """Close HTTP client"""
        await self.http_client.aclose()
