"""
Material service for database operations
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.material import Material, MaterialCreate, MaterialUpdate, MaterialStatus
from app.core.exceptions import NotFoundError, DatabaseException
from app.core.utils import to_object_id

logger = structlog.get_logger()


class MaterialService:
    """Service for managing reference materials"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.database = database
        self.collection = database.materials

    async def create_material(
        self, material_data: MaterialCreate, tutor_id: str
    ) -> Material:
        """Create a new material"""
        try:
            material_dict = material_data.dict(exclude_none=True)
            material_dict["tutor_id"] = tutor_id
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

        except Exception as e:
            logger.error("Failed to create material", error=str(e))
            raise DatabaseException(f"Failed to create material: {str(e)}")

    async def get_material_by_id(self, material_id: str) -> Material:
        """Get material by ID"""
        try:
            oid = to_object_id(material_id)
            material = await self.collection.find_one({"_id": oid})

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
    ) -> Dict[str, Any]:
        """Get materials for a tutor with optional filters and pagination"""
        try:
            query = {"tutor_id": tutor_id}

            if subject_id:
                query["subject_id"] = subject_id

            if material_type:
                query["material_type"] = material_type

            if status:
                query["status"] = status
            else:
                # Default to active materials
                query["status"] = MaterialStatus.ACTIVE

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate skip
            skip = (page - 1) * per_page

            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(per_page)
            )
            materials = []

            async for material in cursor:
                materials.append(Material(**material))

            logger.info(
                "Retrieved materials for tutor", tutor_id=tutor_id, count=len(materials)
            )
            return {
                "items": materials,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page
                if per_page > 0
                else 0,
            }

        except Exception as e:
            logger.error(
                "Failed to get materials for tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get materials: {str(e)}")

    async def update_material(
        self, material_id: str, update_data: MaterialUpdate
    ) -> Material:
        """Update a material"""
        try:
            update_dict = update_data.dict(exclude_unset=True)
            update_dict["updated_at"] = datetime.now(timezone.utc)

            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$set": update_dict}
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info("Material updated", material_id=material_id)
            return await self.get_material_by_id(material_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to update material", material_id=material_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update material: {str(e)}")

    async def delete_material(self, material_id: str) -> bool:
        """Delete a material (soft delete)"""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid},
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

    async def link_to_question(self, material_id: str, question_id: str) -> Material:
        """Link material to a question"""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$addToSet": {"linked_questions": question_id},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info(
                "Material linked to question",
                material_id=material_id,
                question_id=question_id,
            )
            return await self.get_material_by_id(material_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to link material to question", error=str(e))
            raise DatabaseException(f"Failed to link material: {str(e)}")

    async def link_to_assignment(
        self, material_id: str, assignment_id: str
    ) -> Material:
        """Link material to an assignment"""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$addToSet": {"linked_assignments": assignment_id},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Material", material_id)

            logger.info(
                "Material linked to assignment",
                material_id=material_id,
                assignment_id=assignment_id,
            )
            return await self.get_material_by_id(material_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to link material to assignment", error=str(e))
            raise DatabaseException(f"Failed to link material: {str(e)}")

    async def increment_view_count(self, material_id: str) -> bool:
        """Increment material view count"""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$inc": {"view_count": 1}}
            )
            return result.matched_count > 0
        except Exception as e:
            logger.error(
                "Failed to increment view count", material_id=material_id, error=str(e)
            )
            return False

    async def increment_download_count(self, material_id: str) -> bool:
        """Increment material download count"""
        try:
            oid = to_object_id(material_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$inc": {"download_count": 1}}
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
        """Get materials accessible to students"""
        try:
            query = {
                "tutor_id": tutor_id,
                "status": MaterialStatus.ACTIVE,
                "shared_with_students": True,
            }

            if subject_id:
                query["subject_id"] = subject_id

            cursor = self.collection.find(query).sort("created_at", -1)
            materials = []

            async for material in cursor:
                materials.append(Material(**material))

            logger.info(
                "Retrieved materials for student",
                tutor_id=tutor_id,
                count=len(materials),
            )
            return materials

        except Exception as e:
            logger.error("Failed to get materials for student", error=str(e))
            raise DatabaseException(f"Failed to get materials: {str(e)}")
