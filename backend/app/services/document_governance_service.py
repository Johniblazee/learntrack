"""
Document Governance Service
Handles document lifecycle, cascade deletion, re-sync, and change detection
"""

import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.file import (
    UploadedFile,
    EmbeddingStatus,
    SyncStatus,
    ErrorCategory,
    ProcessingHistoryEntry,
)
from app.core.exceptions import NotFoundError, DatabaseException
from app.core.utils import to_object_id

logger = structlog.get_logger()


class DocumentGovernanceService:
    """Service for document lifecycle management and governance"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.database = database
        self.files_collection = database.files
        self.materials_collection = database.materials
        self._rag_service = None

    def _get_rag_service(self):
        if self._rag_service is None:
            from app.rag.services.rag_service import RAGService

            self._rag_service = RAGService(self.database)
        return self._rag_service

    # ==================== CASCADE DELETION ====================

    async def delete_file_with_embeddings(
        self, file_id: str, tutor_id: str, hard_delete: bool = False
    ) -> Dict[str, Any]:
        """
        Delete a file and cascade delete its embeddings from Qdrant.

        Args:
            file_id: The file ID to delete
            tutor_id: The tutor ID for collection isolation
            hard_delete: If True, permanently delete; else soft delete

        Returns:
            Dict with deletion status and details
        """
        try:
            oid = to_object_id(file_id)
            file = await self.files_collection.find_one({"_id": oid})

            if not file:
                raise NotFoundError("File", file_id)

            # Step 1: Delete embeddings from Qdrant
            await self._get_rag_service().delete_file_embeddings(file_id, tutor_id)
            logger.info("Deleted embeddings for file", file_id=file_id)

            # Step 2: Add to processing history
            history_entry = ProcessingHistoryEntry(
                action="delete",
                status="completed",
                details={
                    "hard_delete": hard_delete,
                    "chunks_deleted": file.get("chunk_count", 0),
                },
            )

            if hard_delete:
                # Permanently delete the file record
                await self.files_collection.delete_one({"_id": oid})
                logger.info("Hard deleted file", file_id=file_id)
            else:
                # Soft delete - mark as deleted
                await self.files_collection.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "status": "deleted",
                            "embedding_status": EmbeddingStatus.PENDING.value,
                            "chunk_count": 0,
                            "qdrant_collection_id": None,
                            "updated_at": datetime.now(timezone.utc),
                        },
                        "$push": {"processing_history": history_entry.model_dump()},
                    },
                )
                logger.info("Soft deleted file", file_id=file_id)

            return {
                "file_id": file_id,
                "deleted": True,
                "hard_delete": hard_delete,
                "embeddings_deleted": True,
            }

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to delete file with embeddings", file_id=file_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete file: {str(e)}")

    async def delete_material_with_files(
        self, material_id: str, tutor_id: str, hard_delete: bool = False
    ) -> Dict[str, Any]:
        """
        Delete a material and cascade delete associated files and embeddings.
        """
        try:
            oid = to_object_id(material_id)
            material = await self.materials_collection.find_one({"_id": oid})

            if not material:
                raise NotFoundError("Material", material_id)

            # Find all files linked to this material
            file_ids = material.get("file_ids", [])
            deleted_files = []

            for file_id in file_ids:
                try:
                    result = await self.delete_file_with_embeddings(
                        file_id, tutor_id, hard_delete
                    )
                    deleted_files.append(result)
                except Exception as e:
                    logger.warning(
                        "Failed to delete file", file_id=file_id, error=str(e)
                    )

            # Delete or archive the material
            if hard_delete:
                await self.materials_collection.delete_one({"_id": oid})
            else:
                await self.materials_collection.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "status": "archived",
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )

            return {
                "material_id": material_id,
                "deleted": True,
                "hard_delete": hard_delete,
                "deleted_files": deleted_files,
            }

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to delete material with files",
                material_id=material_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to delete material: {str(e)}")

    # ==================== RE-SYNC & CHANGE DETECTION ====================

    async def check_document_sync_status(
        self, file_id: str, new_content_hash: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Check if a document needs re-embedding by comparing content hashes.

        Args:
            file_id: The file ID to check
            new_content_hash: Optional new hash to compare against stored hash

        Returns:
            Dict with sync status information
        """
        try:
            oid = to_object_id(file_id)
            file = await self.files_collection.find_one({"_id": oid})

            if not file:
                raise NotFoundError("File", file_id)

            stored_hash = file.get("content_hash")
            embedding_status = file.get("embedding_status")
            last_embedded_at = file.get("last_embedded_at")

            # Determine sync status
            if not stored_hash or not last_embedded_at:
                sync_status = SyncStatus.NEVER_SYNCED
                needs_resync = True
            elif new_content_hash and new_content_hash != stored_hash:
                sync_status = SyncStatus.OUT_OF_SYNC
                needs_resync = True
            elif embedding_status == EmbeddingStatus.FAILED.value:
                sync_status = SyncStatus.OUT_OF_SYNC
                needs_resync = True
            else:
                sync_status = SyncStatus.SYNCED
                needs_resync = False

            return {
                "file_id": file_id,
                "sync_status": sync_status.value,
                "needs_resync": needs_resync,
                "stored_hash": stored_hash,
                "new_hash": new_content_hash,
                "last_embedded_at": last_embedded_at.isoformat()
                if last_embedded_at
                else None,
                "embedding_status": embedding_status,
            }

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to check sync status", file_id=file_id, error=str(e))
            raise DatabaseException(f"Failed to check sync status: {str(e)}")

    async def resync_document(
        self,
        file_id: str,
        tutor_id: str,
        file_path: Optional[str] = None,
        file_url: Optional[str] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Re-sync a document by re-processing and re-embedding.

        Args:
            file_id: The file ID to resync
            tutor_id: The tutor ID for collection isolation
            file_path: Path to the file (required if force=True or file changed)
            file_url: URL to the file
            force: Force re-sync even if not needed

        Returns:
            Dict with resync results
        """
        try:
            oid = to_object_id(file_id)
            file = await self.files_collection.find_one({"_id": oid})

            if not file:
                raise NotFoundError("File", file_id)

            # Check if resync is needed
            if not force:
                sync_check = await self.check_document_sync_status(file_id)
                if not sync_check["needs_resync"]:
                    return {
                        "file_id": file_id,
                        "resynced": False,
                        "reason": "Document is already in sync",
                    }

            # Add history entry for resync start
            history_entry = ProcessingHistoryEntry(
                action="re-embed",
                status="started",
                details={
                    "force": force,
                    "previous_version": file.get("embedding_version", 1),
                },
            )

            await self.files_collection.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "embedding_status": EmbeddingStatus.PROCESSING.value,
                        "updated_at": datetime.now(timezone.utc),
                    },
                    "$push": {"processing_history": history_entry.model_dump()},
                    "$inc": {"processing_attempts": 1},
                },
            )

            # Delete existing embeddings
            await self._get_rag_service().delete_file_embeddings(file_id, tutor_id)

            # Get file URL from database if not provided
            if not file_url:
                file_url = str(file.get("uploadthing_url", ""))

            # Re-process document
            result = await self._get_rag_service().process_document(
                file_path=file_path or "",
                file_id=file_id,
                tutor_id=tutor_id,
                file_url=file_url,
            )

            # Update with completion
            completion_entry = ProcessingHistoryEntry(
                action="re-embed",
                status="completed",
                details={
                    "chunks": result.get("chunks", 0),
                    "processor_used": result.get("processor_used"),
                    "new_version": file.get("embedding_version", 1) + 1,
                },
            )

            await self.files_collection.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "sync_status": SyncStatus.SYNCED.value,
                        "last_synced_at": datetime.now(timezone.utc),
                        "processing_attempts": 0,  # Reset on success
                    },
                    "$inc": {"embedding_version": 1},
                    "$push": {"processing_history": completion_entry.model_dump()},
                },
            )

            return {
                "file_id": file_id,
                "resynced": True,
                "chunks": result.get("chunks", 0),
                "processor_used": result.get("processor_used"),
                "new_version": file.get("embedding_version", 1) + 1,
            }

        except NotFoundError:
            raise
        except Exception as e:
            # Log failure in history
            try:
                error_category = self._categorize_error(str(e))
                failure_entry = ProcessingHistoryEntry(
                    action="re-embed",
                    status="failed",
                    error_message=str(e),
                    details={"error_category": error_category.value},
                )
                await self.files_collection.update_one(
                    {"_id": to_object_id(file_id)},
                    {
                        "$set": {
                            "embedding_status": EmbeddingStatus.FAILED.value,
                            "last_error_category": error_category.value,
                            "embedding_error": str(e),
                        },
                        "$push": {"processing_history": failure_entry.model_dump()},
                    },
                )
            except Exception:
                pass

            logger.error("Failed to resync document", file_id=file_id, error=str(e))
            raise DatabaseException(f"Failed to resync document: {str(e)}")

    def _categorize_error(self, error_message: str) -> ErrorCategory:
        """Categorize an error message into an ErrorCategory"""
        error_lower = error_message.lower()

        if "format" in error_lower or "parse" in error_lower or "decode" in error_lower:
            return ErrorCategory.FORMAT_ERROR
        elif (
            "rate limit" in error_lower
            or "quota" in error_lower
            or "429" in error_lower
        ):
            return ErrorCategory.API_LIMIT
        elif (
            "network" in error_lower
            or "connection" in error_lower
            or "timeout" in error_lower
        ):
            return ErrorCategory.NETWORK_ERROR
        elif "timeout" in error_lower:
            return ErrorCategory.TIMEOUT
        else:
            return ErrorCategory.UNKNOWN

    # ==================== BATCH OPERATIONS ====================

    async def batch_delete_files(
        self, file_ids: List[str], tutor_id: str, hard_delete: bool = False
    ) -> Dict[str, Any]:
        """Delete multiple files and their embeddings in batch."""
        results = {"success": [], "failed": []}

        for file_id in file_ids:
            try:
                await self.delete_file_with_embeddings(file_id, tutor_id, hard_delete)
                results["success"].append(file_id)
            except Exception as e:
                results["failed"].append({"file_id": file_id, "error": str(e)})

        return {
            "total": len(file_ids),
            "deleted": len(results["success"]),
            "failed": len(results["failed"]),
            "details": results,
        }

    async def batch_resync_files(
        self, file_ids: List[str], tutor_id: str, force: bool = False
    ) -> Dict[str, Any]:
        """Re-sync multiple files in batch."""
        results = {"success": [], "failed": [], "skipped": []}

        for file_id in file_ids:
            try:
                result = await self.resync_document(file_id, tutor_id, force=force)
                if result.get("resynced"):
                    results["success"].append(result)
                else:
                    results["skipped"].append(result)
            except Exception as e:
                results["failed"].append({"file_id": file_id, "error": str(e)})

        return {
            "total": len(file_ids),
            "resynced": len(results["success"]),
            "skipped": len(results["skipped"]),
            "failed": len(results["failed"]),
            "details": results,
        }

    async def get_files_needing_resync(self, tutor_id: str) -> List[Dict[str, Any]]:
        """Get all files that need re-syncing for a tutor."""
        try:
            cursor = self.files_collection.find(
                {
                    "tutor_id": tutor_id,
                    "$or": [
                        {"sync_status": SyncStatus.OUT_OF_SYNC.value},
                        {"sync_status": SyncStatus.NEVER_SYNCED.value},
                        {"embedding_status": EmbeddingStatus.FAILED.value},
                        {"embedding_status": EmbeddingStatus.PENDING.value},
                    ],
                    "status": {"$ne": "deleted"},
                }
            )

            files = []
            async for file in cursor:
                files.append(
                    {
                        "file_id": str(file["_id"]),
                        "filename": file.get("filename"),
                        "sync_status": file.get("sync_status"),
                        "embedding_status": file.get("embedding_status"),
                        "last_error": file.get("embedding_error"),
                    }
                )

            return files
        except Exception as e:
            logger.error("Failed to get files needing resync", error=str(e))
            return []

    async def cleanup_orphan_embeddings(self, tutor_id: str) -> Dict[str, Any]:
        """
        Find and clean up orphan embeddings (embeddings without matching files).
        """
        try:
            collection_name = f"tutor_{tutor_id.replace('-', '_')}"

            # Get all file IDs in the Qdrant collection
            # This is a simplified approach - in production you'd paginate
            rag_service = self._get_rag_service()
            if not rag_service.qdrant_client:
                return {"cleaned": 0, "message": "Qdrant not available"}

            # Get all file IDs from database
            cursor = self.files_collection.find(
                {"tutor_id": tutor_id, "status": {"$ne": "deleted"}}, {"_id": 1}
            )
            valid_file_ids = set()
            async for file in cursor:
                valid_file_ids.add(str(file["_id"]))

            logger.info(f"Found {len(valid_file_ids)} valid files for tutor {tutor_id}")

            # Note: Full orphan cleanup requires Qdrant scroll/pagination
            # This is a placeholder for the concept
            return {
                "tutor_id": tutor_id,
                "valid_files": len(valid_file_ids),
                "message": "Orphan cleanup check completed",
            }

        except Exception as e:
            logger.error("Failed to cleanup orphan embeddings", error=str(e))
            return {"cleaned": 0, "error": str(e)}
