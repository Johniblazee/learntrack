"""
Subject service for database operations
"""

from typing import List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.subject import Subject, SubjectCreate, SubjectUpdate, SubjectWithStats
from app.core.exceptions import (
    AuthorizationError,
    DatabaseException,
    NotFoundError,
    ValidationError,
)
from app.core.utils import to_object_id

logger = structlog.get_logger()


class SubjectService:
    """Subject service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.subjects

    async def create_subject(
        self, subject_data: SubjectCreate, tutor_id: str
    ) -> Subject:
        """Create a new subject"""
        try:
            # Check if subject already exists for this tutor
            existing = await self.collection.find_one(
                {"tutor_id": tutor_id, "name": subject_data.name, "is_active": True}
            )

            if existing:
                raise ValidationError(f"Subject '{subject_data.name}' already exists")

            subject_dict = subject_data.dict(exclude_none=True)
            subject_dict["tutor_id"] = tutor_id
            subject_dict["topics"] = subject_dict.get("topics", [])
            subject_dict["created_at"] = datetime.now(timezone.utc)
            subject_dict["updated_at"] = datetime.now(timezone.utc)
            subject_dict["question_count"] = 0
            subject_dict["is_active"] = True

            result = await self.collection.insert_one(subject_dict)
            subject_dict["_id"] = result.inserted_id

            logger.info(
                "Subject created", subject_id=str(result.inserted_id), tutor_id=tutor_id
            )
            return Subject(**subject_dict)

        except (ValidationError, DatabaseException):
            raise
        except Exception as e:
            logger.error("Failed to create subject", error=str(e))
            raise DatabaseException(f"Failed to create subject: {str(e)}")

    async def get_subject_by_id(
        self, subject_id: str, tutor_id: Optional[str] = None
    ) -> Optional[Subject]:
        """Get subject by ID with optional tutor_id filtering for tenant isolation"""
        try:
            oid = to_object_id(subject_id)
            query = {"_id": oid, "is_active": True}

            # Add tutor_id filter if provided for tenant isolation
            if tutor_id:
                query["tutor_id"] = tutor_id

            subject = await self.collection.find_one(query)
            if not subject:
                if tutor_id:
                    # Subject exists but belongs to different tutor - return None for 404
                    return None
                raise NotFoundError("Subject", subject_id)
            return Subject(**subject)
        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to get subject", subject_id=subject_id, error=str(e))
            raise DatabaseException(f"Failed to get subject: {str(e)}")

    async def get_subjects_by_tutor(self, tutor_id: str) -> List[Subject]:
        """Get all subjects for a tutor"""
        try:
            cursor = self.collection.find(
                {"tutor_id": tutor_id, "is_active": True}
            ).sort("name", 1)

            subjects = []
            async for subject in cursor:
                subjects.append(Subject(**subject))

            return subjects

        except Exception as e:
            logger.error(
                "Failed to get subjects by tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get subjects: {str(e)}")

    async def get_subject_with_stats(
        self, subject_id: str, tutor_id: Optional[str] = None
    ) -> Optional[SubjectWithStats]:
        """Get subject with statistics (with optional tenant isolation)"""
        try:
            subject = await self.get_subject_by_id(subject_id, tutor_id=tutor_id)
            if not subject:
                return None

            # Build query with tenant isolation
            stats_query = {"subject_id": subject_id}
            if tutor_id:
                stats_query["tutor_id"] = tutor_id

            # Get question count (scoped to tutor)
            question_query = {**stats_query, "status": "active"}
            question_count = await self.db.questions.count_documents(question_query)

            # Get active assignments count (scoped to tutor)
            assignment_query = {
                **stats_query,
                "status": {"$in": ["scheduled", "active"]},
            }
            assignment_count = await self.db.assignments.count_documents(
                assignment_query
            )

            # Get total students (from assignments, scoped to tutor)
            pipeline = [
                {"$match": stats_query},
                {"$unwind": "$student_ids"},
                {"$group": {"_id": "$student_ids"}},
                {"$count": "total"},
            ]

            student_count_result = await self.db.assignments.aggregate(
                pipeline
            ).to_list(1)
            student_count = (
                student_count_result[0]["total"] if student_count_result else 0
            )

            subject_dict = subject.dict()
            subject_dict.update(
                {
                    "total_questions": question_count,
                    "active_assignments": assignment_count,
                    "total_students": student_count,
                }
            )

            return SubjectWithStats(**subject_dict)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get subject with stats", subject_id=subject_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get subject statistics: {str(e)}")

    async def update_subject(
        self, subject_id: str, subject_update: SubjectUpdate, tutor_id: str
    ) -> Subject:
        """Update subject"""
        try:
            # Verify ownership
            subject = await self.get_subject_by_id(subject_id)
            if subject is None:
                raise NotFoundError("Subject", subject_id)

            if subject.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to update this subject")

            update_data = subject_update.dict(exclude_unset=True)
            if not update_data:
                return subject

            update_data["updated_at"] = datetime.now(timezone.utc)

            oid = to_object_id(subject_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$set": update_data}
            )

            if result.matched_count == 0:
                raise NotFoundError("Subject", subject_id)

            logger.info("Subject updated", subject_id=subject_id)
            updated_subject = await self.get_subject_by_id(subject_id)
            if updated_subject is None:
                raise NotFoundError("Subject", subject_id)
            return updated_subject

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to update subject", subject_id=subject_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update subject: {str(e)}")

    async def delete_subject(self, subject_id: str, tutor_id: str) -> bool:
        """Delete subject (soft delete)"""
        try:
            # Verify ownership
            subject = await self.get_subject_by_id(subject_id)
            if subject is None:
                raise NotFoundError("Subject", subject_id)

            if subject.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to delete this subject")

            # Check if subject has questions or assignments
            question_count = await self.db.questions.count_documents(
                {"subject_id": subject_id}
            )
            assignment_count = await self.db.assignments.count_documents(
                {"subject_id": subject_id}
            )

            if question_count > 0 or assignment_count > 0:
                raise ValidationError(
                    "Cannot delete subject with existing questions or assignments"
                )

            oid = to_object_id(subject_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "is_active": False,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Subject", subject_id)

            logger.info("Subject deleted", subject_id=subject_id)
            return True

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to delete subject", subject_id=subject_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete subject: {str(e)}")

    async def add_topic_to_subject(
        self, subject_id: str, topic: str, tutor_id: str
    ) -> Subject:
        """Add topic to subject"""
        try:
            # Verify ownership
            subject = await self.get_subject_by_id(subject_id)
            if subject is None:
                raise NotFoundError("Subject", subject_id)

            if subject.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to modify this subject")

            if topic in subject.topics:
                raise ValidationError(f"Topic '{topic}' already exists in this subject")

            oid = to_object_id(subject_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$addToSet": {"topics": topic},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Subject", subject_id)

            logger.info("Topic added to subject", subject_id=subject_id, topic=topic)
            updated_subject = await self.get_subject_by_id(subject_id)
            if updated_subject is None:
                raise NotFoundError("Subject", subject_id)
            return updated_subject

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to add topic", subject_id=subject_id, topic=topic, error=str(e)
            )
            raise DatabaseException(f"Failed to add topic: {str(e)}")

    async def remove_topic_from_subject(
        self, subject_id: str, topic: str, tutor_id: str
    ) -> Subject:
        """Remove topic from subject"""
        try:
            # Verify ownership
            subject = await self.get_subject_by_id(subject_id)
            if subject is None:
                raise NotFoundError("Subject", subject_id)

            if subject.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to modify this subject")

            # Check if topic has questions
            question_count = await self.db.questions.count_documents(
                {"subject_id": subject_id, "topic": topic}
            )

            if question_count > 0:
                raise ValidationError(
                    f"Cannot remove topic '{topic}' with existing questions"
                )

            oid = to_object_id(subject_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$pull": {"topics": topic},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Subject", subject_id)

            logger.info(
                "Topic removed from subject", subject_id=subject_id, topic=topic
            )
            updated_subject = await self.get_subject_by_id(subject_id)
            if updated_subject is None:
                raise NotFoundError("Subject", subject_id)
            return updated_subject

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to remove topic",
                subject_id=subject_id,
                topic=topic,
                error=str(e),
            )
            raise DatabaseException(f"Failed to remove topic: {str(e)}")
