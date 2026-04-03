"""
Student service for database operations
"""

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.student import (
    StudentGroup,
    StudentGroupCreate,
    StudentGroupUpdate,
)
from app.core.exceptions import NotFoundError, DatabaseException, ValidationError
from app.core.utils import to_object_id

logger = structlog.get_logger()


class StudentService:
    """Student service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.students = database.students
        self.groups = database.student_groups

    async def _ensure_unique_group_name(
        self,
        *,
        tutor_id: str,
        name: str,
        exclude_group_id: Optional[str] = None,
    ) -> None:
        existing_groups = await self.groups.find(
            {"tutor_id": tutor_id},
            {"_id": 1, "name": 1},
        ).to_list(length=None)
        target_name = name.strip().lower()

        for group in existing_groups:
            group_id = str(group.get("_id") or "")
            if exclude_group_id and group_id == exclude_group_id:
                continue
            existing_name = str(group.get("name") or "").strip().lower()
            if existing_name == target_name:
                raise ValidationError(f"Group '{name.strip()}' already exists")

    async def _normalize_student_ids(
        self, student_ids: Optional[List[str]], tutor_id: str
    ) -> List[str]:
        if not student_ids:
            return []

        normalized_ids = list(
            dict.fromkeys(
                str(student_id).strip()
                for student_id in student_ids
                if str(student_id).strip()
            )
        )
        if not normalized_ids:
            return []

        object_ids = [
            to_object_id(student_id)
            for student_id in normalized_ids
            if ObjectId.is_valid(student_id)
        ]
        clerk_ids = [
            student_id
            for student_id in normalized_ids
            if not ObjectId.is_valid(student_id)
        ]

        query_filters = []
        if object_ids:
            query_filters.append({"_id": {"$in": object_ids}})
        if clerk_ids:
            query_filters.append({"clerk_id": {"$in": clerk_ids}})

        matching_students = await self.students.find(
            {
                "tutor_id": tutor_id,
                "is_active": {"$ne": False},
                "$or": query_filters,
            },
            {"_id": 1, "clerk_id": 1},
        ).to_list(length=None)

        canonical_by_identifier: Dict[str, str] = {}
        for student in matching_students:
            student_db_id = str(student.get("_id") or "")
            if not student_db_id:
                continue
            canonical_by_identifier[student_db_id] = student_db_id
            clerk_id = str(student.get("clerk_id") or "").strip()
            if clerk_id:
                canonical_by_identifier[clerk_id] = student_db_id

        invalid_ids = [
            student_id
            for student_id in normalized_ids
            if student_id not in canonical_by_identifier
        ]
        if invalid_ids:
            raise ValidationError(
                f"Invalid student selection: {', '.join(invalid_ids)}"
            )

        return list(
            dict.fromkeys(
                canonical_by_identifier[student_id] for student_id in normalized_ids
            )
        )

    async def _normalize_subjects(
        self, subjects: Optional[List[str]], tutor_id: str
    ) -> List[str]:
        if not subjects:
            return []

        normalized_subjects = list(
            dict.fromkeys(
                str(subject).strip() for subject in subjects if str(subject).strip()
            )
        )
        if not normalized_subjects:
            return []

        subject_docs = await self.db.subjects.find(
            {"tutor_id": tutor_id, "is_active": True},
            {"_id": 1, "name": 1},
        ).to_list(length=None)

        canonical_by_identifier: Dict[str, str] = {}
        for subject in subject_docs:
            subject_name = str(subject.get("name") or "").strip()
            subject_id = str(subject.get("_id") or "").strip()
            if subject_name:
                canonical_by_identifier[subject_name.lower()] = subject_name
            if subject_id and subject_name:
                canonical_by_identifier[subject_id] = subject_name

        invalid_subjects = [
            subject
            for subject in normalized_subjects
            if subject.lower() not in canonical_by_identifier
            and subject not in canonical_by_identifier
        ]
        if invalid_subjects:
            raise ValidationError(
                f"Invalid subject selection: {', '.join(invalid_subjects)}"
            )

        return list(
            dict.fromkeys(
                canonical_by_identifier.get(
                    subject, canonical_by_identifier.get(subject.lower(), subject)
                )
                for subject in normalized_subjects
            )
        )

    # Groups - All methods require tutor_id for tenant isolation
    async def list_groups(self, tutor_id: str, limit: int = 200) -> List[StudentGroup]:
        """List groups for a specific tutor (tenant isolated)"""
        try:
            safe_limit = max(1, min(limit, 500))
            cursor = (
                self.groups.find({"tutor_id": tutor_id})
                .limit(safe_limit)
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
            doc = data.model_dump()
            doc["name"] = str(doc.get("name") or "").strip()
            await self._ensure_unique_group_name(tutor_id=tutor_id, name=doc["name"])
            doc["studentIds"] = await self._normalize_student_ids(
                doc.get("studentIds"), tutor_id
            )
            doc["subjects"] = await self._normalize_subjects(
                doc.get("subjects"), tutor_id
            )
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
        except ValidationError:
            raise
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
            existing_group = await self.get_group(group_id, tutor_id)
            if existing_group is None:
                return None

            update_data = update.model_dump(exclude_unset=True)
            if "name" in update_data:
                update_data["name"] = str(update_data["name"] or "").strip()
                await self._ensure_unique_group_name(
                    tutor_id=tutor_id,
                    name=update_data["name"],
                    exclude_group_id=group_id,
                )
            if "studentIds" in update_data:
                update_data["studentIds"] = await self._normalize_student_ids(
                    update_data.get("studentIds"), tutor_id
                )
            if "subjects" in update_data:
                update_data["subjects"] = await self._normalize_subjects(
                    update_data.get("subjects"), tutor_id
                )
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
        except ValidationError:
            raise
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
            assignment_count = await self.db.assignments.count_documents(
                {"tutor_id": tutor_id, "group_ids": group_id}
            )
            if assignment_count > 0:
                raise ValidationError(
                    "Cannot delete a group that is assigned to existing assignments"
                )

            oid = to_object_id(group_id)
            # Filter by tutor_id for tenant isolation
            result = await self.groups.delete_one({"_id": oid, "tutor_id": tutor_id})
            if result.deleted_count > 0:
                logger.info(
                    "Student group deleted", group_id=group_id, tutor_id=tutor_id
                )
                return True
            return False
        except ValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to delete student group",
                error=str(e),
                group_id=group_id,
                tutor_id=tutor_id,
            )
            raise DatabaseException(f"Failed to delete student group: {str(e)}")

    async def bulk_delete_groups(
        self, group_ids: List[str], tutor_id: str
    ) -> Dict[str, Any]:
        """Delete multiple groups with partial-success reporting."""
        try:
            normalized_ids = list(
                dict.fromkeys(
                    str(group_id).strip()
                    for group_id in group_ids
                    if str(group_id).strip()
                )
            )
            if not normalized_ids:
                raise ValidationError("Select at least one group")

            group_docs = await self.groups.find(
                {
                    "_id": {
                        "$in": [to_object_id(group_id) for group_id in normalized_ids]
                    },
                    "tutor_id": tutor_id,
                },
                {"_id": 1},
            ).to_list(length=None)

            found_ids = {
                str(group_doc.get("_id"))
                for group_doc in group_docs
                if group_doc.get("_id") is not None
            }

            owned_ids = [
                group_id for group_id in normalized_ids if group_id in found_ids
            ]
            skipped_ids = [
                group_id for group_id in normalized_ids if group_id not in found_ids
            ]
            blocked_ids: List[str] = []
            deletable_ids: List[str] = []

            for group_id in owned_ids:
                assignment_count = await self.db.assignments.count_documents(
                    {"tutor_id": tutor_id, "group_ids": group_id}
                )
                if assignment_count > 0:
                    blocked_ids.append(group_id)
                else:
                    deletable_ids.append(group_id)

            deleted_ids: List[str] = []
            if deletable_ids:
                result = await self.groups.delete_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(group_id) for group_id in deletable_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                    }
                )
                if result.deleted_count:
                    deleted_ids = deletable_ids

            return {
                "requested_count": len(normalized_ids),
                "deleted_count": len(deleted_ids),
                "deleted_group_ids": deleted_ids,
                "blocked_count": len(blocked_ids),
                "blocked_group_ids": blocked_ids,
                "skipped_count": len(skipped_ids),
                "skipped_group_ids": skipped_ids,
            }
        except ValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to bulk delete student groups",
                error=str(e),
                tutor_id=tutor_id,
            )
            raise DatabaseException(f"Failed to bulk delete student groups: {str(e)}")
