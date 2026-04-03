"""
Material service for database operations.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

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
    """Service for managing reference materials and folders."""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.database = database
        self.collection = database.materials
        self.folder_collection = database.material_folders

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _normalize_folder_name(name: str) -> str:
        return name.strip()

    @staticmethod
    def _normalize_material_ids(material_ids: List[str]) -> List[str]:
        return list(
            dict.fromkeys(
                str(material_id).strip()
                for material_id in material_ids
                if str(material_id).strip()
            )
        )

    def _material_query(
        self, material_id: str, tutor_id: Optional[str]
    ) -> Dict[str, Any]:
        query: Dict[str, Any] = {"_id": to_object_id(material_id)}
        if tutor_id:
            query["tutor_id"] = tutor_id
        return query

    async def _sync_file_metadata(
        self,
        *,
        file_id: Optional[str],
        tutor_id: str,
        material_id: Optional[str] = None,
        subject_id: Optional[str] = None,
        topic: Optional[str] = None,
    ) -> None:
        if not file_id:
            return

        update_payload: Dict[str, Any] = {
            "updated_at": self._now(),
            "tutor_id": tutor_id,
        }
        if material_id:
            update_payload["material_id"] = material_id
        if subject_id is not None:
            update_payload["subject_id"] = subject_id
        if topic is not None:
            update_payload["topic"] = topic

        await self.database.files.update_one(
            {"_id": to_object_id(file_id), "tutor_id": tutor_id},
            {"$set": update_payload},
        )

    async def _get_folder_doc(self, folder_id: str, tutor_id: str) -> Dict[str, Any]:
        folder = await self.folder_collection.find_one(
            {"_id": to_object_id(folder_id), "tutor_id": tutor_id}
        )
        if not folder:
            raise NotFoundError("Folder", folder_id)
        return folder

    async def _ensure_unique_folder_name(
        self,
        tutor_id: str,
        name: str,
        parent_id: Optional[str],
        exclude_folder_id: Optional[str] = None,
    ) -> None:
        query: Dict[str, Any] = {
            "tutor_id": tutor_id,
            "name": name,
            "parent_id": parent_id,
        }
        if exclude_folder_id:
            query["_id"] = {"$ne": to_object_id(exclude_folder_id)}

        existing = await self.folder_collection.find_one(query)
        if existing:
            raise ValidationError(
                f"A folder named '{name}' already exists at this location"
            )

    async def _resolve_owned_material_ids(
        self,
        material_ids: List[str],
        tutor_id: str,
        *,
        allow_archived: bool = False,
    ) -> tuple[List[str], List[str]]:
        normalized_ids = self._normalize_material_ids(material_ids)
        candidate_oids = [to_object_id(material_id) for material_id in normalized_ids]
        requested_by_id = {
            str(candidate_oid): material_id
            for material_id, candidate_oid in zip(normalized_ids, candidate_oids)
        }

        query: Dict[str, Any] = {
            "_id": {"$in": candidate_oids},
            "tutor_id": tutor_id,
        }
        if not allow_archived:
            query["status"] = {"$ne": MaterialStatus.ARCHIVED}

        owned_docs = await self.collection.find(query, {"_id": 1}).to_list(length=None)
        owned_id_set = {
            requested_by_id[str(doc.get("_id"))]
            for doc in owned_docs
            if doc.get("_id") is not None
        }

        owned_ids = [
            material_id for material_id in normalized_ids if material_id in owned_id_set
        ]
        skipped_ids = [
            material_id
            for material_id in normalized_ids
            if material_id not in owned_id_set
        ]
        return owned_ids, skipped_ids

    @staticmethod
    def _bulk_action_summary(
        requested_ids: List[str],
        updated_ids: List[str],
        skipped_ids: List[str],
    ) -> Dict[str, Any]:
        return {
            "requested_count": len(requested_ids),
            "updated_count": len(updated_ids),
            "updated_material_ids": updated_ids,
            "skipped_count": len(skipped_ids),
            "skipped_material_ids": skipped_ids,
        }

    async def _resolve_folder_placement(
        self, tutor_id: str, folder_id: Optional[str]
    ) -> Dict[str, Optional[str]]:
        if not folder_id:
            return {"folder_id": None, "folder_path": None}

        folder = await self._get_folder_doc(folder_id, tutor_id)
        return {
            "folder_id": str(folder["_id"]),
            "folder_path": str(folder.get("path") or folder.get("name") or ""),
        }

    async def _update_descendant_paths(
        self,
        tutor_id: str,
        old_prefix: str,
        new_prefix: str,
    ) -> List[str]:
        if old_prefix == new_prefix:
            return []

        regex = f"^{re.escape(old_prefix)}/"
        descendants = await self.folder_collection.find(
            {"tutor_id": tutor_id, "path": {"$regex": regex}}
        ).to_list(length=None)

        updated_ids: List[str] = []
        now = self._now()
        for folder in descendants:
            old_path = str(folder.get("path") or "")
            suffix = old_path[len(old_prefix) :]
            new_path = f"{new_prefix}{suffix}"
            await self.folder_collection.update_one(
                {"_id": folder["_id"]},
                {
                    "$set": {
                        "path": new_path,
                        "updated_at": now,
                    }
                },
            )
            updated_ids.append(str(folder["_id"]))

        return updated_ids

    async def _sync_material_paths_for_folders(
        self, tutor_id: str, folder_ids: List[str]
    ) -> None:
        if not folder_ids:
            return

        now = self._now()
        for folder_id in folder_ids:
            folder = await self.folder_collection.find_one(
                {"_id": to_object_id(folder_id), "tutor_id": tutor_id}
            )
            if not folder:
                continue

            await self.collection.update_many(
                {"tutor_id": tutor_id, "folder_id": folder_id},
                {
                    "$set": {
                        "folder_path": str(
                            folder.get("path") or folder.get("name") or ""
                        ),
                        "updated_at": now,
                    }
                },
            )

    async def create_material(
        self, material_data: MaterialCreate, tutor_id: str
    ) -> Material:
        """Create a new material for a tutor."""
        try:
            material_dict = material_data.model_dump(exclude_none=True)
            folder_payload = await self._resolve_folder_placement(
                tutor_id=tutor_id,
                folder_id=material_dict.get("folder_id"),
            )

            material_dict["tutor_id"] = tutor_id
            material_dict["folder_id"] = folder_payload["folder_id"]
            material_dict["folder_path"] = folder_payload["folder_path"]
            material_dict["created_at"] = self._now()
            material_dict["updated_at"] = self._now()
            material_dict["status"] = material_dict.get("status", MaterialStatus.ACTIVE)
            material_dict["view_count"] = 0
            material_dict["download_count"] = 0
            material_dict["linked_questions"] = []
            material_dict["linked_assignments"] = []
            material_dict["shared_with_students"] = material_dict.get(
                "shared_with_students", True
            )

            result = await self.collection.insert_one(material_dict)
            material_dict["_id"] = result.inserted_id

            await self._sync_file_metadata(
                file_id=material_dict.get("file_id"),
                tutor_id=tutor_id,
                material_id=str(result.inserted_id),
                subject_id=material_dict.get("subject_id"),
                topic=material_dict.get("topic"),
            )

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
        """Get material by ID, optionally scoped to tutor."""
        try:
            material = await self.collection.find_one(
                self._material_query(material_id=material_id, tutor_id=tutor_id)
            )

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
        """Get materials for a tutor with filtering and pagination."""
        try:
            query: Dict[str, Any] = {"tutor_id": tutor_id}

            if subject_id:
                query["subject_id"] = subject_id

            if material_type:
                query["material_type"] = material_type

            if status:
                query["status"] = status
            else:
                query["status"] = MaterialStatus.ACTIVE

            if folder_id:
                folder = await self._get_folder_doc(folder_id, tutor_id)
                if include_subfolders:
                    folder_prefix = str(folder.get("path") or folder.get("name") or "")
                    folder_docs = await self.folder_collection.find(
                        {
                            "tutor_id": tutor_id,
                            "path": {
                                "$regex": f"^{re.escape(folder_prefix)}(/|$)",
                            },
                        }
                    ).to_list(length=None)
                    folder_ids = [str(item["_id"]) for item in folder_docs]
                    query["folder_id"] = {"$in": folder_ids}
                else:
                    query["folder_id"] = str(folder["_id"])

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
                "total_pages": (total + per_page - 1) // per_page,
            }
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error(
                "Failed to get materials for tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get materials: {str(e)}")

    async def update_material(
        self,
        material_id: str,
        update_data: MaterialUpdate,
        tutor_id: Optional[str] = None,
    ) -> Material:
        """Update a material, optionally scoped by tutor ownership."""
        try:
            existing = await self.get_material_by_id(material_id, tutor_id=tutor_id)
            owner_tutor_id = existing.tutor_id

            update_dict = update_data.model_dump(exclude_unset=True)
            if "folder_id" in update_dict:
                update_dict.update(
                    await self._resolve_folder_placement(
                        tutor_id=owner_tutor_id,
                        folder_id=update_dict.get("folder_id"),
                    )
                )

            if not update_dict:
                return existing

            update_dict["updated_at"] = self._now()

            result = await self.collection.update_one(
                self._material_query(material_id=material_id, tutor_id=tutor_id),
                {"$set": update_dict},
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info("Material updated", material_id=material_id)
            effective_file_id = update_dict.get("file_id")
            if effective_file_id is None:
                effective_file_id = existing.file_id

            await self._sync_file_metadata(
                file_id=effective_file_id,
                tutor_id=owner_tutor_id,
                material_id=material_id,
                subject_id=update_dict.get("subject_id", existing.subject_id),
                topic=update_dict.get("topic", existing.topic),
            )
            return await self.get_material_by_id(material_id, tutor_id=tutor_id)
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error(
                "Failed to update material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update material: {str(e)}")

    async def delete_material(
        self, material_id: str, tutor_id: Optional[str] = None
    ) -> bool:
        """Archive a material, optionally scoped by tutor ownership."""
        try:
            result = await self.collection.update_one(
                self._material_query(material_id=material_id, tutor_id=tutor_id),
                {
                    "$set": {
                        "status": MaterialStatus.ARCHIVED,
                        "updated_at": self._now(),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info("Material archived", material_id=material_id)
            return True
        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to delete material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete material: {str(e)}")

    async def bulk_archive_materials(
        self, material_ids: List[str], tutor_id: str
    ) -> Dict[str, Any]:
        """Archive multiple materials owned by a tutor."""
        try:
            normalized_ids = self._normalize_material_ids(material_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one material")

            owned_ids, skipped_ids = await self._resolve_owned_material_ids(
                normalized_ids,
                tutor_id,
                allow_archived=False,
            )
            updated_ids: List[str] = []

            if owned_ids:
                result = await self.collection.update_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(material_id) for material_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                        "status": {"$ne": MaterialStatus.ARCHIVED},
                    },
                    {
                        "$set": {
                            "status": MaterialStatus.ARCHIVED,
                            "updated_at": self._now(),
                        }
                    },
                )
                if result.modified_count:
                    updated_ids = owned_ids

            logger.info(
                "Bulk archived materials",
                tutor_id=tutor_id,
                requested_count=len(normalized_ids),
                archived_count=len(updated_ids),
                skipped_count=len(skipped_ids),
            )
            return self._bulk_action_summary(normalized_ids, updated_ids, skipped_ids)
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to bulk archive materials", error=str(e))
            raise DatabaseException(f"Failed to bulk archive materials: {str(e)}")

    async def bulk_move_materials(
        self,
        material_ids: List[str],
        tutor_id: str,
        folder_id: Optional[str],
    ) -> Dict[str, Any]:
        """Move multiple materials to another folder or root."""
        try:
            normalized_ids = self._normalize_material_ids(material_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one material")

            folder_payload = await self._resolve_folder_placement(
                tutor_id=tutor_id,
                folder_id=folder_id,
            )
            owned_ids, skipped_ids = await self._resolve_owned_material_ids(
                normalized_ids,
                tutor_id,
                allow_archived=False,
            )
            updated_ids: List[str] = []

            if owned_ids:
                result = await self.collection.update_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(material_id) for material_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                        "status": {"$ne": MaterialStatus.ARCHIVED},
                    },
                    {
                        "$set": {
                            **folder_payload,
                            "updated_at": self._now(),
                        }
                    },
                )
                if result.modified_count:
                    updated_ids = owned_ids

            logger.info(
                "Bulk moved materials",
                tutor_id=tutor_id,
                requested_count=len(normalized_ids),
                moved_count=len(updated_ids),
                skipped_count=len(skipped_ids),
                destination_folder_id=folder_payload.get("folder_id"),
            )
            return self._bulk_action_summary(normalized_ids, updated_ids, skipped_ids)
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to bulk move materials", error=str(e))
            raise DatabaseException(f"Failed to bulk move materials: {str(e)}")

    async def bulk_update_material_sharing(
        self,
        material_ids: List[str],
        tutor_id: str,
        shared_with_students: bool,
    ) -> Dict[str, Any]:
        """Update student visibility for multiple materials."""
        try:
            normalized_ids = self._normalize_material_ids(material_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one material")

            owned_ids, skipped_ids = await self._resolve_owned_material_ids(
                normalized_ids,
                tutor_id,
                allow_archived=False,
            )
            updated_ids: List[str] = []

            if owned_ids:
                result = await self.collection.update_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(material_id) for material_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                        "status": {"$ne": MaterialStatus.ARCHIVED},
                    },
                    {
                        "$set": {
                            "shared_with_students": shared_with_students,
                            "updated_at": self._now(),
                        }
                    },
                )
                if result.modified_count:
                    updated_ids = owned_ids

            logger.info(
                "Bulk updated material sharing",
                tutor_id=tutor_id,
                requested_count=len(normalized_ids),
                updated_count=len(updated_ids),
                skipped_count=len(skipped_ids),
                shared_with_students=shared_with_students,
            )
            return self._bulk_action_summary(normalized_ids, updated_ids, skipped_ids)
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to bulk update material sharing", error=str(e))
            raise DatabaseException(f"Failed to bulk update material sharing: {str(e)}")

    async def link_to_question(
        self, material_id: str, question_id: str, tutor_id: Optional[str] = None
    ) -> Material:
        """Link material to a question."""
        try:
            result = await self.collection.update_one(
                self._material_query(material_id=material_id, tutor_id=tutor_id),
                {
                    "$addToSet": {"linked_questions": question_id},
                    "$set": {"updated_at": self._now()},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info(
                "Material linked to question",
                material_id=material_id,
                question_id=question_id,
            )
            return await self.get_material_by_id(material_id, tutor_id=tutor_id)
        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to link material to question", error=str(e))
            raise DatabaseException(f"Failed to link material: {str(e)}")

    async def link_to_assignment(
        self,
        material_id: str,
        assignment_id: str,
        tutor_id: Optional[str] = None,
    ) -> Material:
        """Link material to an assignment."""
        try:
            result = await self.collection.update_one(
                self._material_query(material_id=material_id, tutor_id=tutor_id),
                {
                    "$addToSet": {"linked_assignments": assignment_id},
                    "$set": {"updated_at": self._now()},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info(
                "Material linked to assignment",
                material_id=material_id,
                assignment_id=assignment_id,
            )
            return await self.get_material_by_id(material_id, tutor_id=tutor_id)
        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to link material to assignment", error=str(e))
            raise DatabaseException(f"Failed to link material: {str(e)}")

    async def move_material(
        self,
        material_id: str,
        tutor_id: str,
        folder_id: Optional[str],
    ) -> Material:
        """Move a material to another folder or to root."""
        try:
            await self.get_material_by_id(material_id=material_id, tutor_id=tutor_id)
            folder_payload = await self._resolve_folder_placement(
                tutor_id=tutor_id,
                folder_id=folder_id,
            )

            result = await self.collection.update_one(
                self._material_query(material_id=material_id, tutor_id=tutor_id),
                {
                    "$set": {
                        **folder_payload,
                        "updated_at": self._now(),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info(
                "Material moved",
                material_id=material_id,
                tutor_id=tutor_id,
                folder_id=folder_payload["folder_id"],
            )
            return await self.get_material_by_id(
                material_id=material_id, tutor_id=tutor_id
            )
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error(
                "Failed to move material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to move material: {str(e)}")

    async def increment_view_count(self, material_id: str) -> bool:
        """Increment material view count."""
        try:
            result = await self.collection.update_one(
                {"_id": to_object_id(material_id)}, {"$inc": {"view_count": 1}}
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
            result = await self.collection.update_one(
                {"_id": to_object_id(material_id)}, {"$inc": {"download_count": 1}}
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
        """Get materials accessible to students for a tutor."""
        try:
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

    async def create_folder(
        self,
        folder_data: MaterialFolderCreate,
        tutor_id: str,
    ) -> MaterialFolder:
        """Create a material folder."""
        try:
            name = self._normalize_folder_name(folder_data.name)
            if not name:
                raise ValidationError("Folder name is required")

            parent_id = folder_data.parent_id
            parent_path: Optional[str] = None

            if parent_id:
                parent = await self._get_folder_doc(parent_id, tutor_id)
                parent_path = str(parent.get("path") or parent.get("name") or "")

            await self._ensure_unique_folder_name(
                tutor_id=tutor_id,
                name=name,
                parent_id=parent_id,
            )

            folder_doc: Dict[str, Any] = {
                "name": name,
                "parent_id": parent_id,
                "tutor_id": tutor_id,
                "path": f"{parent_path}/{name}" if parent_path else name,
                "created_at": self._now(),
                "updated_at": self._now(),
            }

            result = await self.folder_collection.insert_one(folder_doc)
            folder_doc["_id"] = result.inserted_id
            logger.info(
                "Material folder created",
                folder_id=str(result.inserted_id),
                tutor_id=tutor_id,
            )
            return MaterialFolder(**folder_doc)
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to create folder", error=str(e), tutor_id=tutor_id)
            raise DatabaseException(f"Failed to create folder: {str(e)}")

    async def list_folders(
        self,
        tutor_id: str,
        parent_id: Optional[str] = None,
        include_all: bool = False,
    ) -> List[MaterialFolder]:
        """List material folders for a tutor."""
        try:
            query: Dict[str, Any] = {"tutor_id": tutor_id}

            if not include_all:
                if parent_id:
                    await self._get_folder_doc(parent_id, tutor_id)
                    query["parent_id"] = parent_id
                else:
                    query["$or"] = [
                        {"parent_id": None},
                        {"parent_id": {"$exists": False}},
                    ]

            cursor = self.folder_collection.find(query).sort("name", 1)
            folders: List[MaterialFolder] = []
            async for folder in cursor:
                folders.append(MaterialFolder(**folder))

            return folders
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to list folders", error=str(e), tutor_id=tutor_id)
            raise DatabaseException(f"Failed to list folders: {str(e)}")

    async def update_folder(
        self,
        folder_id: str,
        update_data: MaterialFolderUpdate,
        tutor_id: str,
    ) -> MaterialFolder:
        """Rename and/or move a folder."""
        try:
            folder = await self._get_folder_doc(folder_id, tutor_id)
            payload = update_data.model_dump(exclude_unset=True)

            current_name = str(folder.get("name") or "")
            current_parent_id = folder.get("parent_id")
            current_path = str(folder.get("path") or current_name)

            new_name = self._normalize_folder_name(payload.get("name", current_name))
            if not new_name:
                raise ValidationError("Folder name is required")

            parent_explicitly_set = "parent_id" in payload
            new_parent_id = (
                payload.get("parent_id") if parent_explicitly_set else current_parent_id
            )

            if new_parent_id == folder_id:
                raise ValidationError("Folder cannot be its own parent")

            new_parent_path: Optional[str] = None
            if new_parent_id:
                parent = await self._get_folder_doc(new_parent_id, tutor_id)
                parent_path_value = str(parent.get("path") or parent.get("name") or "")

                if parent_path_value == current_path or parent_path_value.startswith(
                    f"{current_path}/"
                ):
                    raise ValidationError(
                        "Folder cannot be moved inside itself or its descendants"
                    )

                new_parent_path = parent_path_value

            await self._ensure_unique_folder_name(
                tutor_id=tutor_id,
                name=new_name,
                parent_id=new_parent_id,
                exclude_folder_id=folder_id,
            )

            new_path = f"{new_parent_path}/{new_name}" if new_parent_path else new_name

            await self.folder_collection.update_one(
                {"_id": folder["_id"]},
                {
                    "$set": {
                        "name": new_name,
                        "parent_id": new_parent_id,
                        "path": new_path,
                        "updated_at": self._now(),
                    }
                },
            )

            updated_ids = await self._update_descendant_paths(
                tutor_id=tutor_id,
                old_prefix=current_path,
                new_prefix=new_path,
            )
            await self._sync_material_paths_for_folders(
                tutor_id=tutor_id,
                folder_ids=[folder_id, *updated_ids],
            )

            updated = await self._get_folder_doc(folder_id, tutor_id)
            logger.info("Folder updated", folder_id=folder_id, tutor_id=tutor_id)
            return MaterialFolder(**updated)
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to update folder", error=str(e), folder_id=folder_id)
            raise DatabaseException(f"Failed to update folder: {str(e)}")

    async def delete_folder(self, folder_id: str, tutor_id: str) -> bool:
        """Delete a folder, moving direct children and contained materials to parent/root."""
        try:
            folder = await self._get_folder_doc(folder_id, tutor_id)
            parent_id = folder.get("parent_id")
            parent_path: Optional[str] = None
            if parent_id:
                parent = await self._get_folder_doc(parent_id, tutor_id)
                parent_path = str(parent.get("path") or parent.get("name") or "")

            moved_folder_ids: List[str] = []

            children = await self.folder_collection.find(
                {"tutor_id": tutor_id, "parent_id": folder_id}
            ).to_list(length=None)

            for child in children:
                old_child_path = str(child.get("path") or child.get("name") or "")
                child_name = str(child.get("name") or "")
                new_child_path = (
                    f"{parent_path}/{child_name}" if parent_path else child_name
                )

                await self.folder_collection.update_one(
                    {"_id": child["_id"]},
                    {
                        "$set": {
                            "parent_id": parent_id,
                            "path": new_child_path,
                            "updated_at": self._now(),
                        }
                    },
                )

                moved_folder_ids.append(str(child["_id"]))
                descendant_updates = await self._update_descendant_paths(
                    tutor_id=tutor_id,
                    old_prefix=old_child_path,
                    new_prefix=new_child_path,
                )
                moved_folder_ids.extend(descendant_updates)

            await self._sync_material_paths_for_folders(tutor_id, moved_folder_ids)

            await self.collection.update_many(
                {"tutor_id": tutor_id, "folder_id": folder_id},
                {
                    "$set": {
                        "folder_id": parent_id,
                        "folder_path": parent_path,
                        "updated_at": self._now(),
                    }
                },
            )

            result = await self.folder_collection.delete_one(
                {"_id": folder["_id"], "tutor_id": tutor_id}
            )
            logger.info("Folder deleted", folder_id=folder_id, tutor_id=tutor_id)
            return result.deleted_count > 0
        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to delete folder", error=str(e), folder_id=folder_id)
            raise DatabaseException(f"Failed to delete folder: {str(e)}")
