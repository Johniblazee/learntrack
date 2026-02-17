"""
Student service for database operations
"""

from typing import Any, List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.student import (
    Student,
    StudentCreate,
    StudentUpdate,
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

    # Students
    async def list_students(self, limit: int = 200, current_user=None) -> List[Student]:
        try:
            # Build filter based on user role
            filter_query = {}
            if current_user:
                if current_user.role.value == "tutor":
                    # Tutors can only see their own students
                    filter_query["tutor_id"] = current_user.clerk_id
                elif current_user.role.value == "parent":
                    # Parents can only see students they are assigned to
                    filter_query["parent_ids"] = {"$in": [current_user.clerk_id]}
                elif current_user.role.value == "student":
                    # Students can only see themselves
                    filter_query["_id"] = current_user.clerk_id

            cursor = (
                self.students.find(filter_query).limit(limit).sort("created_at", -1)
            )
            results: List[Student] = []
            async for doc in cursor:
                results.append(Student(**doc))
            return results
        except Exception as e:
            logger.error("Failed to list students", error=str(e))
            raise DatabaseException(f"Failed to list students: {str(e)}")

    async def create_student(self, data: StudentCreate, current_user=None) -> Student:
        try:
            doc = data.dict()

            # Automatically set tutor_id from authenticated user context
            if current_user:
                doc["tutor_id"] = current_user.clerk_id

            doc["created_at"] = datetime.now(timezone.utc)
            doc["updated_at"] = datetime.now(timezone.utc)
            result = await self.students.insert_one(doc)
            doc["_id"] = result.inserted_id
            return Student(**doc)
        except Exception as e:
            logger.error("Failed to create student", error=str(e))
            raise DatabaseException(f"Failed to create student: {str(e)}")

    async def get_student(self, student_id: str, current_user=None) -> Student:
        try:
            oid = to_object_id(student_id)

            # Build filter based on user role
            filter_query = {"_id": oid}
            if current_user:
                if current_user.role.value == "tutor":
                    # Tutors can only see their own students
                    filter_query["tutor_id"] = current_user.clerk_id
                elif current_user.role.value == "parent":
                    # Parents can only see students they are assigned to
                    filter_query["parent_ids"] = {"$in": [current_user.clerk_id]}
                elif current_user.role.value == "student":
                    # Students can only see themselves (if student_id matches their clerk_id)
                    filter_query["_id"] = current_user.clerk_id

            doc = await self.students.find_one(filter_query)
            if not doc:
                raise NotFoundError("Student", student_id)
            return Student(**doc)
        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to get student", error=str(e))
            raise DatabaseException(f"Failed to get student: {str(e)}")

    async def update_student(
        self, student_id: str, update: StudentUpdate, current_user=None
    ) -> Student:
        try:
            update_data = update.dict(exclude_unset=True)
            update_data["updated_at"] = datetime.now(timezone.utc)
            oid = to_object_id(student_id)

            # Build filter based on user role
            filter_query = {"_id": oid}
            if current_user:
                if current_user.role.value == "tutor":
                    # Tutors can only update their own students
                    filter_query["tutor_id"] = current_user.clerk_id
                elif current_user.role.value == "parent":
                    # Parents cannot update students
                    raise PermissionError("Parents cannot update student information")
                elif current_user.role.value == "student":
                    # Students cannot update other students
                    raise PermissionError(
                        "Students cannot update other student information"
                    )

            result = await self.students.update_one(filter_query, {"$set": update_data})
            if result.matched_count == 0:
                raise NotFoundError("Student", student_id)
            return await self.get_student(student_id, current_user)
        except NotFoundError:
            raise
        except PermissionError:
            raise
        except Exception as e:
            logger.error("Failed to update student", error=str(e))
            raise DatabaseException(f"Failed to update student: {str(e)}")

    async def delete_student(self, student_id: str, current_user=None) -> bool:
        """Delete a student by ID and return True if successful"""
        try:
            # Validate student_id format
            if not student_id:
                logger.error("Empty student_id provided for deletion")
                raise ValueError("Student ID cannot be empty")

            # Convert to ObjectId if valid, otherwise use as string
            oid = to_object_id(student_id)

            # Build filter based on user role
            filter_query = {"_id": oid}
            if current_user:
                if current_user.role.value == "tutor":
                    # Tutors can only delete their own students
                    filter_query["tutor_id"] = current_user.clerk_id
                elif current_user.role.value in ["parent", "student"]:
                    # Parents and students cannot delete students
                    raise PermissionError("Insufficient permissions to delete student")

            # Check if student exists before deletion
            existing_student = await self.students.find_one(filter_query)
            if not existing_student:
                logger.warning("Student not found for deletion", student_id=student_id)
                return False

            # Perform the deletion
            result = await self.students.delete_one(filter_query)

            if result.deleted_count > 0:
                logger.info(
                    "Student deleted successfully",
                    student_id=student_id,
                    deleted_count=result.deleted_count,
                )
                return True
            else:
                logger.warning("No student was deleted", student_id=student_id)
                return False

        except ValueError as e:
            logger.error(
                "Invalid student_id for deletion", student_id=student_id, error=str(e)
            )
            raise DatabaseException(f"Invalid student ID: {str(e)}")
        except Exception as e:
            logger.error(
                "Failed to delete student", student_id=student_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete student: {str(e)}")

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
