"""
Material service for database operations.
"""

from datetime import datetime, timezone
import re
from typing import Any, Dict, List, Optional, Tuple

from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.exceptions import DatabaseException, NotFoundError, ValidationError
from app.core.utils import to_object_id
from app.models.material import (
    Material,
    MaterialCreate,
    MaterialFolder,
    MaterialFolderCreate,
    MaterialFolderUpdate,
    MaterialStatus,
    MaterialUpdate,
)

logger = structlog.get_logger()


class MaterialService:
    """Service for managing reference materials and material folders."""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.database = database
        self.collection = database.materials
        self.folders_collection = database.material_folders

    @staticmethod
    def _normalize_folder_id(folder_id: Optional[str]) -> Optional[str]:
        if folder_id is None:
            return None
        normalized = str(folder_id).strip()
        if not normalized or normalized.lower() in {"root", "none", "null"}:
            return None
        return normalized

    @staticmethod
    def _build_folder_path(parent_path: str, folder_name: str) -> str:
        if parent_path == "/":
            return f"/{folder_name}"
        return f"{parent_path.rstrip('/')}/{folder_name}"

    @staticmethod
    def _path_prefix_regex(path: str) -> str:
        escaped = re.escape(path.rstrip("/"))
        return rf"^{escaped}(?:/|$)"

    async def ensure_folder_compatibility(self, tutor_id: str) -> None:
        """Backfill folder metadata for legacy flat materials."""
        await self.collection.update_many(
            {
                "tutor_id": tutor_id,
                "$or": [
                    {"folder_path": {"$exists": False}},
                    {"folder_path": None},
                    {"folder_path": ""},
                ],
            },
            {
                "$set": {
                    "folder_id": None,
                    "folder_path": "/",
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def _get_folder_doc(
        self, folder_id: str, tutor_id: str, allow_inactive: bool = False
    ) -> Dict[str, Any]:
        query: Dict[str, Any] = {"_id": to_object_id(folder_id), "tutor_id": tutor_id}
        if not allow_inactive:
            query["is_active"] = True

        folder = await self.folders_collection.find_one(query)
        if not folder:
            raise NotFoundError("MaterialFolder", folder_id)
        return folder

    async def _resolve_folder_metadata(
        self, folder_id: Optional[str], tutor_id: str
    ) -> Tuple[Optional[str], str]:
        normalized = self._normalize_folder_id(folder_id)
        if not normalized:
            return None, "/"

        folder = await self._get_folder_doc(normalized, tutor_id)
        return str(folder["_id"]), folder.get("path", "/")

    async def create_folder(
        self, folder_data: MaterialFolderCreate, tutor_id: str
    ) -> MaterialFolder:
        """Create a new folder for organizing materials."""
        try:
            name = folder_data.name.strip()
            if not name:
                raise ValidationError("Folder name is required")
            if "/" in name:
                raise ValidationError("Folder name cannot include '/'")

            parent_id = self._normalize_folder_id(folder_data.parent_id)
            parent_path = "/"
            if parent_id:
                parent_folder = await self._get_folder_doc(parent_id, tutor_id)
                parent_path = parent_folder.get("path", "/")

            existing = await self.folders_collection.find_one(
                {
                    "tutor_id": tutor_id,
                    "is_active": True,
                    "parent_id": parent_id,
                    "name": {"$regex": rf"^{re.escape(name)}$", "$options": "i"},
                }
            )
            if existing:
                raise ValidationError(
                    f"A folder named '{name}' already exists in this location"
                )

            now = datetime.now(timezone.utc)
            folder_doc = {
                "name": name,
                "parent_id": parent_id,
                "path": self._build_folder_path(parent_path, name),
                "tutor_id": tutor_id,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }

            result = await self.folders_collection.insert_one(folder_doc)
            folder_doc["_id"] = result.inserted_id

            logger.info("Material folder created", folder_id=str(result.inserted_id))
            return MaterialFolder(**folder_doc)

        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to create material folder", error=str(e))
            raise DatabaseException(f"Failed to create material folder: {str(e)}")

    async def list_folders(
        self,
        tutor_id: str,
        parent_id: Optional[str] = None,
        include_all: bool = False,
    ) -> List[MaterialFolder]:
        """List folders, optionally scoped to a parent."""
        try:
            await self.ensure_folder_compatibility(tutor_id)

            query: Dict[str, Any] = {"tutor_id": tutor_id, "is_active": True}
            if not include_all:
                query["parent_id"] = self._normalize_folder_id(parent_id)

            cursor = self.folders_collection.find(query).sort(
                [("path", 1), ("name", 1)]
            )
            folders: List[MaterialFolder] = []
            async for folder in cursor:
                folders.append(MaterialFolder(**folder))
            return folders
        except Exception as e:
            logger.error("Failed to list material folders", error=str(e))
            raise DatabaseException(f"Failed to list folders: {str(e)}")

    async def update_folder(
        self, folder_id: str, update_data: MaterialFolderUpdate, tutor_id: str
    ) -> MaterialFolder:
        """Rename and/or move a folder."""
        try:
            folder = await self._get_folder_doc(folder_id, tutor_id)

            target_name = (
                update_data.name.strip()
                if update_data.name is not None
                else folder.get("name", "")
            )
            if not target_name:
                raise ValidationError("Folder name is required")
            if "/" in target_name:
                raise ValidationError("Folder name cannot include '/'")

            target_parent_id = (
                self._normalize_folder_id(update_data.parent_id)
                if update_data.parent_id is not None
                else folder.get("parent_id")
            )
            if target_parent_id == folder_id:
                raise ValidationError("Folder cannot be its own parent")

            target_parent_path = "/"
            if target_parent_id:
                target_parent = await self._get_folder_doc(target_parent_id, tutor_id)
                target_parent_path = target_parent.get("path", "/")
                current_path = folder.get("path", "/")
                if target_parent_path == current_path or target_parent_path.startswith(
                    f"{current_path}/"
                ):
                    raise ValidationError(
                        "Folder cannot be moved into itself or one of its descendants"
                    )

            existing = await self.folders_collection.find_one(
                {
                    "_id": {"$ne": folder["_id"]},
                    "tutor_id": tutor_id,
                    "is_active": True,
                    "parent_id": target_parent_id,
                    "name": {
                        "$regex": rf"^{re.escape(target_name)}$",
                        "$options": "i",
                    },
                }
            )
            if existing:
                raise ValidationError(
                    f"A folder named '{target_name}' already exists in this location"
                )

            old_path = folder.get("path", "/")
            new_path = self._build_folder_path(target_parent_path, target_name)
            now = datetime.now(timezone.utc)

            await self.folders_collection.update_one(
                {"_id": folder["_id"], "tutor_id": tutor_id},
                {
                    "$set": {
                        "name": target_name,
                        "parent_id": target_parent_id,
                        "path": new_path,
                        "updated_at": now,
                    }
                },
            )

            if old_path != new_path:
                descendant_regex = self._path_prefix_regex(f"{old_path}/")
                descendants = self.folders_collection.find(
                    {
                        "tutor_id": tutor_id,
                        "is_active": True,
                        "path": {"$regex": descendant_regex},
                    }
                )
                async for descendant in descendants:
                    descendant_path = descendant.get("path", "")
                    updated_path = descendant_path.replace(old_path, new_path, 1)
                    await self.folders_collection.update_one(
                        {"_id": descendant["_id"]},
                        {"$set": {"path": updated_path, "updated_at": now}},
                    )

                materials = self.collection.find(
                    {
                        "tutor_id": tutor_id,
                        "folder_path": {"$regex": self._path_prefix_regex(old_path)},
                    }
                )
                async for material_doc in materials:
                    current_path = material_doc.get("folder_path") or "/"
                    updated_path = current_path.replace(old_path, new_path, 1)
                    await self.collection.update_one(
                        {"_id": material_doc["_id"]},
                        {"$set": {"folder_path": updated_path, "updated_at": now}},
                    )

            refreshed = await self._get_folder_doc(folder_id, tutor_id)
            return MaterialFolder(**refreshed)

        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to update material folder", error=str(e))
            raise DatabaseException(f"Failed to update material folder: {str(e)}")

    async def delete_folder(self, folder_id: str, tutor_id: str) -> bool:
        """
        Delete a folder.

        Materials in the deleted folder are moved to the parent folder (or root).
        Deletion is blocked while active child folders still exist.
        """
        try:
            folder = await self._get_folder_doc(folder_id, tutor_id)

            children_count = await self.folders_collection.count_documents(
                {
                    "tutor_id": tutor_id,
                    "is_active": True,
                    "parent_id": str(folder["_id"]),
                }
            )
            if children_count > 0:
                raise ValidationError(
                    "Delete or move child folders before deleting this folder"
                )

            parent_id = folder.get("parent_id")
            parent_path = "/"
            if parent_id:
                parent_folder = await self._get_folder_doc(parent_id, tutor_id)
                parent_path = parent_folder.get("path", "/")

            await self.collection.update_many(
                {"tutor_id": tutor_id, "folder_id": str(folder["_id"])},
                {
                    "$set": {
                        "folder_id": parent_id,
                        "folder_path": parent_path,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            result = await self.folders_collection.update_one(
                {"_id": folder["_id"], "tutor_id": tutor_id},
                {
                    "$set": {
                        "is_active": False,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
            return result.modified_count > 0
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to delete material folder", error=str(e))
            raise DatabaseException(f"Failed to delete material folder: {str(e)}")

    async def create_material(
        self, material_data: MaterialCreate, tutor_id: str
    ) -> Material:
        """Create a new material."""
        try:
            material_dict = material_data.model_dump(exclude_none=True)
            normalized_folder_id, folder_path = await self._resolve_folder_metadata(
                material_dict.get("folder_id"), tutor_id
            )

            material_dict["tutor_id"] = tutor_id
            material_dict["folder_id"] = normalized_folder_id
            material_dict["folder_path"] = folder_path
            material_dict["created_at"] = datetime.now(timezone.utc)
            material_dict["updated_at"] = datetime.now(timezone.utc)
            material_dict["status"] = MaterialStatus.ACTIVE
            material_dict["view_count"] = 0
            material_dict["download_count"] = 0
            material_dict["linked_questions"] = []
            material_dict["linked_assignments"] = []
            material_dict["shared_with_students"] = material_dict.get(
                "shared_with_students", True
            )

            result = await self.collection.insert_one(material_dict)
            material_dict["_id"] = result.inserted_id

            logger.info(
                "Material created",
                material_id=str(result.inserted_id),
                tutor_id=tutor_id,
            )
            return Material(**material_dict)

        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to create material", error=str(e))
            raise DatabaseException(f"Failed to create material: {str(e)}")

    async def get_material_by_id(
        self, material_id: str, tutor_id: Optional[str] = None
    ) -> Material:
        """Get material by ID."""
        try:
            oid = to_object_id(material_id)
            query: Dict[str, Any] = {"_id": oid}
            if tutor_id:
                query["tutor_id"] = tutor_id

            material = await self.collection.find_one(query)
            if not material:
                raise NotFoundError("Material", material_id)

            return Material(**material)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get material: {str(e)}")

    async def get_materials_for_tutor(
        self,
        tutor_id: str,
        subject_id: Optional[str] = None,
        material_type: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        per_page: int = 20,
        folder_id: Optional[str] = None,
        include_subfolders: bool = False,
    ) -> Dict[str, Any]:
        """Get materials for a tutor with optional filters and pagination."""
        try:
            await self.ensure_folder_compatibility(tutor_id)

            query: Dict[str, Any] = {"tutor_id": tutor_id}
            if subject_id:
                query["subject_id"] = subject_id
            if material_type:
                query["material_type"] = material_type
            query["status"] = status or MaterialStatus.ACTIVE

            normalized_folder_id = self._normalize_folder_id(folder_id)
            if normalized_folder_id:
                folder = await self._get_folder_doc(normalized_folder_id, tutor_id)
                if include_subfolders:
                    query["folder_path"] = {
                        "$regex": self._path_prefix_regex(folder.get("path", "/"))
                    }
                else:
                    query["folder_id"] = normalized_folder_id
            else:
                query["$or"] = [{"folder_id": None}, {"folder_id": {"$exists": False}}]

            total = await self.collection.count_documents(query)
            skip = (page - 1) * per_page

            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(per_page)
            )

            materials: List[Material] = []
            async for material in cursor:
                materials.append(Material(**material))

            return {
                "items": materials,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page
                if per_page > 0
                else 0,
            }

        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error(
                "Failed to get materials for tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get materials: {str(e)}")

    async def update_material(
        self, material_id: str, update_data: MaterialUpdate, tutor_id: str
    ) -> Material:
        """Update a material."""
        try:
            update_dict = update_data.model_dump(exclude_unset=True)

            if "folder_id" in update_dict:
                folder_id, folder_path = await self._resolve_folder_metadata(
                    update_dict.get("folder_id"), tutor_id
                )
                update_dict["folder_id"] = folder_id
                update_dict["folder_path"] = folder_path

            update_dict["updated_at"] = datetime.now(timezone.utc)

            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id}, {"$set": update_dict}
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info("Material updated", material_id=material_id)
            return await self.get_material_by_id(material_id, tutor_id=tutor_id)

        except (NotFoundError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to update material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update material: {str(e)}")

    async def move_material(
        self, material_id: str, tutor_id: str, folder_id: Optional[str]
    ) -> Material:
        """Move material to another folder (or root when folder_id is None)."""
        return await self.update_material(
            material_id,
            MaterialUpdate(folder_id=folder_id),
            tutor_id=tutor_id,
        )

    async def delete_material(self, material_id: str, tutor_id: str) -> bool:
        """Delete a material (soft delete)."""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$set": {
                        "status": MaterialStatus.ARCHIVED,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info("Material deleted", material_id=material_id)
            return True

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to delete material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete material: {str(e)}")

    async def link_to_question(
        self, material_id: str, question_id: str, tutor_id: Optional[str] = None
    ) -> Material:
        """Link material to a question."""
        try:
            oid = to_object_id(material_id)
            query: Dict[str, Any] = {"_id": oid}
            if tutor_id:
                query["tutor_id"] = tutor_id

            result = await self.collection.update_one(
                query,
                {
                    "$addToSet": {"linked_questions": question_id},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            return await self.get_material_by_id(material_id, tutor_id=tutor_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to link material to question", error=str(e))
            raise DatabaseException(f"Failed to link material: {str(e)}")

    async def link_to_assignment(
        self, material_id: str, assignment_id: str, tutor_id: Optional[str] = None
    ) -> Material:
        """Link material to an assignment."""
        try:
            oid = to_object_id(material_id)
            query: Dict[str, Any] = {"_id": oid}
            if tutor_id:
                query["tutor_id"] = tutor_id

            result = await self.collection.update_one(
                query,
                {
                    "$addToSet": {"linked_assignments": assignment_id},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            return await self.get_material_by_id(material_id, tutor_id=tutor_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to link material to assignment", error=str(e))
            raise DatabaseException(f"Failed to link material: {str(e)}")

    async def increment_view_count(self, material_id: str) -> bool:
        """Increment material view count."""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$inc": {"view_count": 1},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )
            return result.matched_count > 0
        except Exception as e:
            logger.error(
                "Failed to increment view count", material_id=material_id, error=str(e)
            )
            return False

    async def increment_download_count(self, material_id: str) -> bool:
        """Increment material download count."""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$inc": {"download_count": 1},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )
            return result.matched_count > 0
        except Exception as e:
            logger.error(
                "Failed to increment download count",
                material_id=material_id,
                error=str(e),
            )
            return False

    async def get_materials_for_student(
        self, tutor_id: str, subject_id: Optional[str] = None
    ) -> List[Material]:
        """Get materials accessible to students."""
        try:
            await self.ensure_folder_compatibility(tutor_id)

            query: Dict[str, Any] = {
                "tutor_id": tutor_id,
                "status": MaterialStatus.ACTIVE,
                "shared_with_students": True,
            }
            if subject_id:
                query["subject_id"] = subject_id

            cursor = self.collection.find(query).sort("created_at", -1)
            materials: List[Material] = []
            async for material in cursor:
                materials.append(Material(**material))
            return materials

        except Exception as e:
            logger.error("Failed to get materials for student", error=str(e))
            raise DatabaseException(f"Failed to get materials: {str(e)}")
