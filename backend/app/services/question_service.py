"""
Question service for database operations
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import inspect
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.question import (
    Question,
    QuestionCreate,
    QuestionUpdate,
    QuestionForStudent,
    QuestionDifficulty,
    QuestionStatus,
    QuestionType,
)
from app.core.exceptions import (
    NotFoundError,
    DatabaseException,
    AuthorizationError,
    ValidationError,
)
from app.core.utils import to_object_id

logger = structlog.get_logger()


def _convert_doc_to_question(doc: dict) -> Question:
    """Convert MongoDB document to Question model, handling ObjectId conversion"""
    normalized = dict(doc or {})

    if normalized.get("_id") is not None:
        normalized["_id"] = str(normalized["_id"])

    status = normalized.get("status")
    if isinstance(status, QuestionStatus):
        normalized["status"] = status.value
    elif str(status).lower() == "approved":
        normalized["status"] = QuestionStatus.ACTIVE.value

    normalized.setdefault("question_type", QuestionType.MULTIPLE_CHOICE.value)
    normalized.setdefault("subject_id", "")
    normalized.setdefault("topic", "general")
    normalized.setdefault("difficulty", QuestionDifficulty.MEDIUM.value)
    normalized.setdefault("points", 1)
    normalized.setdefault("tutor_id", "")
    normalized.setdefault("options", [])
    normalized.setdefault("tags", [])
    normalized.setdefault("status", QuestionStatus.ACTIVE.value)

    return Question(**normalized)


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


class QuestionService:
    """Question service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection: Any = getattr(database, "questions", database)

    async def get_question(self, question_id: str) -> Question:
        """Backward-compatible alias for get_question_by_id."""
        return await self.get_question_by_id(question_id)

    async def create_question(
        self,
        question_data: QuestionCreate,
        tutor_id: str,
        ai_generated: bool = False,
        generation_id: Optional[str] = None,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> Question:
        """Create a new question"""
        try:
            question_dict = question_data.model_dump()
            now = datetime.now(timezone.utc)
            question_dict["tutor_id"] = tutor_id
            question_dict["created_at"] = now
            question_dict["updated_at"] = now
            question_dict["times_used"] = 0
            question_dict["ai_generated"] = ai_generated

            # AI-generated questions start as "pending" for approval
            if ai_generated:
                question_dict["status"] = QuestionStatus.PENDING.value
                question_dict["generation_id"] = generation_id
            else:
                question_dict["status"] = QuestionStatus.ACTIVE.value

            if extra_fields:
                question_dict.update(extra_fields)

            result = await self.collection.insert_one(question_dict)
            question_dict["_id"] = str(result.inserted_id)

            logger.info(
                "Question created",
                question_id=str(result.inserted_id),
                tutor_id=tutor_id,
                ai_generated=ai_generated,
            )
            return Question(**question_dict)

        except Exception as e:
            logger.error("Failed to create question", error=str(e))
            raise DatabaseException(f"Failed to create question: {str(e)}")

    async def get_question_by_id(
        self, question_id: str, tutor_id: Optional[str] = None
    ) -> Question:
        """Get question by ID with optional ownership validation"""
        try:
            oid = to_object_id(question_id)
            query: Dict[str, Any] = {
                "_id": oid,
                "status": {"$ne": QuestionStatus.DELETED.value},
            }

            # Add tutor_id filter if provided for ownership validation
            if tutor_id:
                query["tutor_id"] = tutor_id

            question = await self.collection.find_one(query)
            if not question:
                if tutor_id:
                    raise AuthorizationError("Not authorized to access this question")
                raise NotFoundError("Question", question_id)
            return _convert_doc_to_question(question)
        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to get question", question_id=question_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get question: {str(e)}")

    async def get_question_for_student(
        self, question_id: str, student_id: str
    ) -> QuestionForStudent:
        """Get question for student (without correct answers)

        Note: Student access is validated through assignment membership, not direct ownership.
        The student_id is logged for audit purposes.
        """
        question = await self.get_question_by_id(question_id)

        logger.debug(
            "Student accessing question", question_id=question_id, student_id=student_id
        )

        # Remove correct answer information
        student_question = QuestionForStudent(
            id=str(question.id),
            question_text=question.question_text,
            question_type=question.question_type,
            topic=question.topic,
            difficulty=question.difficulty,
            points=question.points,
            options=[{"text": opt.text} for opt in question.options]
            if question.options
            else [],
        )

        return student_question

    async def get_questions_for_tutor(
        self,
        tutor_id: str,
        subject_id: Optional[str] = None,
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        question_type: Optional[str] = None,
        search: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        per_page: int = 20,
    ) -> Dict[str, Any]:
        """Get questions for tutor with optional filters and pagination"""
        try:
            query: Dict[str, Any] = {"tutor_id": tutor_id}

            # Default to active status if not specified
            if status:
                query["status"] = status
            else:
                query["status"] = {"$ne": QuestionStatus.DELETED.value}

            if subject_id:
                query["subject_id"] = subject_id
            if topic:
                query["topic"] = topic
            if difficulty:
                query["difficulty"] = difficulty
            if question_type:
                query["question_type"] = question_type
            if search:
                query["$text"] = {"$search": search}

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate skip
            skip = (page - 1) * per_page

            # Get paginated results
            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(per_page)
            )

            questions = []
            async for question in cursor:
                questions.append(_convert_doc_to_question(question))

            return {
                "items": questions,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page
                if per_page > 0
                else 0,
            }

        except Exception as e:
            logger.error(
                "Failed to get questions for tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get questions: {str(e)}")

    async def get_generation_history(
        self, tutor_id: str, page: int = 1, per_page: int = 20
    ) -> Dict[str, Any]:
        """Get AI-generated questions history for tutor (both pending and approved)"""
        try:
            # Query for AI-generated questions only
            query: Dict[str, Any] = {
                "tutor_id": tutor_id,
                "ai_generated": True,
                "status": {"$ne": QuestionStatus.DELETED.value},
            }

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate skip
            skip = (page - 1) * per_page

            # Get paginated results sorted by creation date (newest first)
            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(per_page)
            )

            questions = []
            async for question in cursor:
                questions.append(_convert_doc_to_question(question))

            return {
                "items": questions,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page
                if per_page > 0
                else 0,
            }

        except Exception as e:
            logger.error(
                "Failed to get generation history", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get generation history: {str(e)}")

    async def get_questions_count_for_tutor(
        self,
        tutor_id: str,
        subject_id: Optional[str] = None,
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        status: Optional[str] = None,
    ) -> int:
        """Get count of questions for tutor with optional filters"""
        try:
            query: Dict[str, Any] = {"tutor_id": tutor_id}

            if status:
                query["status"] = status
            else:
                query["status"] = {"$ne": QuestionStatus.DELETED.value}

            if subject_id:
                query["subject_id"] = subject_id
            if topic:
                query["topic"] = topic
            if difficulty:
                query["difficulty"] = difficulty

            return await self.collection.count_documents(query)

        except Exception as e:
            logger.error(
                "Failed to count questions for tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to count questions: {str(e)}")

    async def get_questions_by_subject(
        self,
        subject_id: str,
        tutor_id: str,
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        limit: int = 50,
    ) -> List[Question]:
        """Get questions by subject with optional filters (tutor-scoped)"""
        try:
            query: Dict[str, Any] = {
                "subject_id": subject_id,
                "tutor_id": tutor_id,
                "status": QuestionStatus.ACTIVE.value,
            }

            if topic:
                query["topic"] = topic
            if difficulty:
                query["difficulty"] = difficulty

            cursor = await _maybe_await(self.collection.find(query))

            if hasattr(cursor, "limit"):
                await _maybe_await(cursor.limit(limit))
            if hasattr(cursor, "sort"):
                await _maybe_await(cursor.sort("created_at", -1))

            if hasattr(cursor, "to_list"):
                question_docs = await _maybe_await(cursor.to_list(length=limit))
            else:
                question_docs = []

            questions = [
                _convert_doc_to_question(question) for question in question_docs
            ]

            return questions

        except Exception as e:
            logger.error(
                "Failed to get questions by subject",
                subject_id=subject_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get questions: {str(e)}")

    async def update_question(
        self, question_id: str, question_update: QuestionUpdate, tutor_id: str
    ) -> Question:
        """Update question"""
        try:
            # Verify ownership
            question = await self.get_question_by_id(question_id)
            if question.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to update this question")

            update_data = question_update.model_dump(exclude_unset=True)
            if not update_data:
                return question

            update_data["updated_at"] = datetime.now(timezone.utc)

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$set": update_data}
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info("Question updated", question_id=question_id)
            return await self.get_question_by_id(question_id)

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to update question", question_id=question_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update question: {str(e)}")

    async def delete_question(self, question_id: str, tutor_id: str) -> bool:
        """Delete question (soft delete)"""
        try:
            # Verify ownership
            question = await self.get_question_by_id(question_id)
            if question.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to delete this question")

            # Check if question is used in any active assignments
            assignment_count = await self.db.assignments.count_documents(
                {
                    "questions.question_id": question_id,
                    "status": {"$nin": ["archived", "completed"]},
                }
            )

            if assignment_count > 0:
                raise ValidationError(
                    "Cannot delete question that is used in active assignments"
                )

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": QuestionStatus.DELETED.value,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info("Question deleted", question_id=question_id)
            return True

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to delete question", question_id=question_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete question: {str(e)}")

    async def bulk_delete_questions(
        self, question_ids: List[str], tutor_id: str
    ) -> Dict[str, Any]:
        """Soft delete multiple questions owned by a tutor."""
        try:
            normalized_ids = list(
                dict.fromkeys(
                    str(question_id).strip()
                    for question_id in question_ids
                    if str(question_id).strip()
                )
            )
            if not normalized_ids:
                raise ValidationError("Select at least one question")

            candidate_oids = [
                to_object_id(question_id) for question_id in normalized_ids
            ]
            requested_by_id = {
                str(candidate_oid): question_id
                for question_id, candidate_oid in zip(normalized_ids, candidate_oids)
            }

            owned_docs = await self.collection.find(
                {
                    "_id": {"$in": candidate_oids},
                    "tutor_id": tutor_id,
                    "status": {"$ne": QuestionStatus.DELETED.value},
                },
                {"_id": 1},
            ).to_list(length=None)

            owned_id_set = {
                requested_by_id[str(doc.get("_id"))]
                for doc in owned_docs
                if doc.get("_id") is not None
            }
            owned_ids = [
                question_id
                for question_id in normalized_ids
                if question_id in owned_id_set
            ]
            skipped_ids = [
                question_id
                for question_id in normalized_ids
                if question_id not in owned_id_set
            ]

            blocked_ids: List[str] = []
            deletable_ids: List[str] = []

            for question_id in owned_ids:
                assignment_count = await self.db.assignments.count_documents(
                    {
                        "questions.question_id": question_id,
                        "status": {"$nin": ["archived", "completed"]},
                    }
                )
                if assignment_count > 0:
                    blocked_ids.append(question_id)
                else:
                    deletable_ids.append(question_id)

            deleted_ids: List[str] = []
            if deletable_ids:
                delete_oids = [
                    to_object_id(question_id) for question_id in deletable_ids
                ]
                result = await self.collection.update_many(
                    {"_id": {"$in": delete_oids}, "tutor_id": tutor_id},
                    {
                        "$set": {
                            "status": QuestionStatus.DELETED.value,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                if result.modified_count:
                    deleted_ids = deletable_ids

            logger.info(
                "Bulk deleted questions",
                tutor_id=tutor_id,
                requested_count=len(normalized_ids),
                deleted_count=len(deleted_ids),
                blocked_count=len(blocked_ids),
                skipped_count=len(skipped_ids),
            )

            return {
                "requested_count": len(normalized_ids),
                "deleted_count": len(deleted_ids),
                "deleted_question_ids": deleted_ids,
                "blocked_count": len(blocked_ids),
                "blocked_question_ids": blocked_ids,
                "skipped_count": len(skipped_ids),
                "skipped_question_ids": skipped_ids,
            }

        except ValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to bulk delete questions", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to bulk delete questions: {str(e)}")

    async def increment_usage_count(self, question_id: str) -> bool:
        """Increment question usage count"""
        try:
            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$inc": {"times_used": 1}}
            )
            return result.matched_count > 0
        except Exception as e:
            logger.error(
                "Failed to increment usage count", question_id=question_id, error=str(e)
            )
            return False

    async def approve_question(self, question_id: str, approver_id: str) -> Question:
        """Approve a pending question (with ownership validation)"""
        try:
            # Validate ownership - approver must own the question
            question = await self.get_question_by_id(question_id, tutor_id=approver_id)

            if question.status != QuestionStatus.PENDING:
                raise ValidationError("Only pending questions can be approved")

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": approver_id},
                {
                    "$set": {
                        "status": QuestionStatus.ACTIVE.value,
                        "approved_by": approver_id,
                        "approved_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info(
                "Question approved", question_id=question_id, approver_id=approver_id
            )
            question.status = QuestionStatus.APPROVED
            question.approved_by = approver_id
            question.approved_at = datetime.now(timezone.utc)
            question.updated_at = datetime.now(timezone.utc)
            return question

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to approve question", question_id=question_id, error=str(e)
            )
            raise DatabaseException(f"Failed to approve question: {str(e)}")

    async def reject_question(
        self, question_id: str, rejector_id: str, reason: Optional[str] = None
    ) -> Question:
        """Reject a pending question (with ownership validation)"""
        try:
            # Validate ownership - rejector must own the question
            question = await self.get_question_by_id(question_id, tutor_id=rejector_id)

            if question.status != QuestionStatus.PENDING:
                raise ValidationError("Only pending questions can be rejected")

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": rejector_id},
                {
                    "$set": {
                        "status": QuestionStatus.REJECTED.value,
                        "rejected_by": rejector_id,
                        "rejected_at": datetime.now(timezone.utc),
                        "rejection_reason": reason,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info(
                "Question rejected", question_id=question_id, rejector_id=rejector_id
            )
            question.status = QuestionStatus.REJECTED
            question.rejected_by = rejector_id
            question.rejected_at = datetime.now(timezone.utc)
            question.rejection_reason = reason
            question.updated_at = datetime.now(timezone.utc)
            return question

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to reject question", question_id=question_id, error=str(e)
            )
            raise DatabaseException(f"Failed to reject question: {str(e)}")

    async def request_revision(
        self, question_id: str, tutor_id: str, notes: str
    ) -> Question:
        """Request revision for a pending question (with ownership validation)"""
        try:
            # Validate ownership
            question = await self.get_question_by_id(question_id, tutor_id=tutor_id)

            if question.status != QuestionStatus.PENDING:
                raise ValidationError(
                    "Only pending questions can have revision requested"
                )

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$set": {
                        "revision_notes": notes,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info(
                "Revision requested for question",
                question_id=question_id,
                tutor_id=tutor_id,
            )
            return await self.get_question_by_id(question_id)

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to request revision", question_id=question_id, error=str(e)
            )
            raise DatabaseException(f"Failed to request revision: {str(e)}")

    async def bulk_approve_questions(
        self, question_ids: List[str], approver_id: str
    ) -> Dict[str, int]:
        """Approve multiple questions at once (with ownership validation)"""
        try:
            oids = [to_object_id(qid) for qid in question_ids]
            # Only approve questions owned by the approver
            result = await self.collection.update_many(
                {
                    "_id": {"$in": oids},
                    "tutor_id": approver_id,
                    "status": QuestionStatus.PENDING.value,
                },
                {
                    "$set": {
                        "status": QuestionStatus.ACTIVE.value,
                        "approved_by": approver_id,
                        "approved_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            logger.info(
                "Bulk approved questions",
                count=result.modified_count,
                approver_id=approver_id,
            )
            return {"approved_count": int(result.modified_count)}

        except Exception as e:
            logger.error("Failed to bulk approve questions", error=str(e))
            raise DatabaseException(f"Failed to bulk approve questions: {str(e)}")

    async def update_average_score(self, question_id: str, new_score: float) -> bool:
        """Update question average score using atomic aggregation pipeline update.

        Uses an aggregation pipeline in update_one to atomically compute:
            new_average = (old_average * attempt_count + new_score) / (attempt_count + 1)
        This avoids the read-modify-write race condition.
        """
        try:
            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid},
                [
                    {
                        "$set": {
                            "attempt_count": {
                                "$add": [{"$ifNull": ["$attempt_count", 0]}, 1]
                            },
                            "average_score": {
                                "$cond": {
                                    "if": {
                                        "$gt": [
                                            {"$ifNull": ["$attempt_count", 0]},
                                            0,
                                        ]
                                    },
                                    "then": {
                                        "$divide": [
                                            {
                                                "$add": [
                                                    {
                                                        "$multiply": [
                                                            {
                                                                "$ifNull": [
                                                                    "$average_score",
                                                                    0,
                                                                ]
                                                            },
                                                            {
                                                                "$ifNull": [
                                                                    "$attempt_count",
                                                                    0,
                                                                ]
                                                            },
                                                        ]
                                                    },
                                                    new_score,
                                                ]
                                            },
                                            {
                                                "$add": [
                                                    {
                                                        "$ifNull": [
                                                            "$attempt_count",
                                                            0,
                                                        ]
                                                    },
                                                    1,
                                                ]
                                            },
                                        ]
                                    },
                                    "else": new_score,
                                }
                            },
                        }
                    }
                ],
            )

            logger.debug(
                "Updated average score atomically",
                question_id=question_id,
                new_score=new_score,
            )

            return result.matched_count > 0

        except Exception as e:
            logger.error(
                "Failed to update average score", question_id=question_id, error=str(e)
            )
            return False

    async def get_text_content_from_file(
        self, file_id: str, tutor_id: str
    ) -> Optional[str]:
        """Get processed text content from a file, ensuring tutor ownership."""
        try:
            file_doc = await self.db.files.find_one(
                {"_id": to_object_id(file_id), "tutor_id": tutor_id}
            )
            if file_doc and file_doc.get("processed_content"):
                return file_doc["processed_content"]
            return None
        except Exception as e:
            logger.error(
                "Failed to get text content from file", file_id=file_id, error=str(e)
            )
            raise DatabaseException(f"Failed to retrieve file content: {str(e)}")
