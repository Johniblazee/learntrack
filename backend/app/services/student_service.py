"""
Student service for database operations
"""

from typing import Any, List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.student import (
    StudentGroup,
    StudentGroupCreate,
    StudentGroupUpdate,
)
from app.core.exceptions import NotFoundError, DatabaseException
from app.core.utils import to_object_id

logger = structlog.get_logger()


class StudentService:
    """Student service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.students = database.students
        self.groups = database.student_groups

    # Groups - All methods require tutor_id for tenant isolation
    async def list_groups(self, tutor_id: str, limit: int = 200) -> List[StudentGroup]:
        """List groups for a specific tutor (tenant isolated)"""
        try:
            cursor = (
                self.groups.find({"tutor_id": tutor_id})
                .limit(limit)
                .sort("created_at", -1)
            )
            results: List[StudentGroup] = []
            async for doc in cursor:
                results.append(StudentGroup(**doc))
            return results
        except Exception as e:
            logger.error(
                "Failed to list student groups", error=str(e), tutor_id=tutor_id
            )
            raise DatabaseException(f"Failed to list student groups: {str(e)}")

    async def get_groups_for_student(
        self, student_id: str, tutor_id: str, limit: int = 50
    ) -> List[StudentGroup]:
        """Get all groups that contain a specific student (optimized query with tenant isolation)."""
        try:
            # Support both Clerk ID and Mongo ObjectId based group membership data.
            candidate_identifiers: List[Any] = []
            seen_identifiers: set[str] = set()

            def add_identifier(value: Any) -> None:
                normalized = str(value or "").strip()
                if not normalized:
                    return

                string_key = f"str:{normalized}"
                if string_key not in seen_identifiers:
                    candidate_identifiers.append(normalized)
                    seen_identifiers.add(string_key)

                try:
                    object_id = ObjectId(normalized)
                    object_key = f"oid:{str(object_id)}"
                    if object_key not in seen_identifiers:
                        candidate_identifiers.append(object_id)
                        seen_identifiers.add(object_key)
                except Exception:
                    pass

            add_identifier(student_id)

            student_doc = await self.students.find_one(
                {"clerk_id": student_id},
                {"_id": 1, "clerk_id": 1},
            )

            if not student_doc:
                try:
                    student_doc = await self.students.find_one(
                        {"_id": to_object_id(student_id)},
                        {"_id": 1, "clerk_id": 1},
                    )
                except Exception:
                    student_doc = None

            if student_doc:
                add_identifier(student_doc.get("_id"))
                add_identifier(student_doc.get("clerk_id"))

            if not candidate_identifiers:
                return []

            cursor = (
                self.groups.find(
                    {
                        "tutor_id": tutor_id,
                        "studentIds": {"$in": candidate_identifiers},
                    }
                )
                .limit(limit)
                .sort("created_at", -1)
            )

            results: List[StudentGroup] = []
            async for doc in cursor:
                results.append(StudentGroup(**doc))

            logger.info(
                "Retrieved groups for student",
                student_id=student_id,
                tutor_id=tutor_id,
                count=len(results),
            )
            return results
        except Exception as e:
            logger.error(
                "Failed to get groups for student",
                error=str(e),
                student_id=student_id,
                tutor_id=tutor_id,
            )
            raise DatabaseException(f"Failed to get groups for student: {str(e)}")

    async def create_group(
        self, data: StudentGroupCreate, tutor_id: str
    ) -> StudentGroup:
        """Create a new group (with tenant isolation)"""
        try:
            doc = data.dict()
            doc["tutor_id"] = tutor_id  # Set tutor_id for tenant isolation
            doc["created_at"] = datetime.now(timezone.utc)
            doc["updated_at"] = datetime.now(timezone.utc)
            result = await self.groups.insert_one(doc)
            doc["_id"] = result.inserted_id
            logger.info(
                "Student group created",
                group_id=str(result.inserted_id),
                tutor_id=tutor_id,
            )
            return StudentGroup(**doc)
        except Exception as e:
            logger.error(
                "Failed to create student group", error=str(e), tutor_id=tutor_id
            )
            raise DatabaseException(f"Failed to create student group: {str(e)}")

    async def get_group(self, group_id: str, tutor_id: str) -> Optional[StudentGroup]:
        """Get a group by ID (only if owned by tutor)"""
        try:
            oid = to_object_id(group_id)
            # Filter by tutor_id for tenant isolation
            doc = await self.groups.find_one({"_id": oid, "tutor_id": tutor_id})
            if not doc:
                return None
            return StudentGroup(**doc)
        except Exception as e:
            logger.error(
                "Failed to get student group",
                error=str(e),
                group_id=group_id,
                tutor_id=tutor_id,
            )
            raise DatabaseException(f"Failed to get student group: {str(e)}")

    async def update_group(
        self, group_id: str, update: StudentGroupUpdate, tutor_id: str
    ) -> Optional[StudentGroup]:
        """Update a group (only if owned by tutor)"""
        try:
            update_data = update.dict(exclude_unset=True)
            update_data["updated_at"] = datetime.now(timezone.utc)
            oid = to_object_id(group_id)
            # Filter by tutor_id for tenant isolation
            result = await self.groups.update_one(
                {"_id": oid, "tutor_id": tutor_id}, {"$set": update_data}
            )
            if result.matched_count == 0:
                return None
            logger.info("Student group updated", group_id=group_id, tutor_id=tutor_id)
            return await self.get_group(group_id, tutor_id)
        except Exception as e:
            logger.error(
                "Failed to update student group",
                error=str(e),
                group_id=group_id,
                tutor_id=tutor_id,
            )
            raise DatabaseException(f"Failed to update student group: {str(e)}")

    async def delete_group(self, group_id: str, tutor_id: str) -> bool:
        """Delete a group (only if owned by tutor)"""
        try:
            oid = to_object_id(group_id)
            # Filter by tutor_id for tenant isolation
            result = await self.groups.delete_one({"_id": oid, "tutor_id": tutor_id})
            if result.deleted_count > 0:
                logger.info(
                    "Student group deleted", group_id=group_id, tutor_id=tutor_id
                )
                return True
            return False
        except Exception as e:
            logger.error(
                "Failed to delete student group",
                error=str(e),
                group_id=group_id,
                tutor_id=tutor_id,
            )
            raise DatabaseException(f"Failed to delete student group: {str(e)}")
