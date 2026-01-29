"""
Question service for database operations
"""
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.question import Question, QuestionCreate, QuestionUpdate, QuestionForStudent, QuestionStatus
from app.core.exceptions import NotFoundError, DatabaseException, AuthorizationError, ValidationError
from app.core.utils import to_object_id, escape_regex

logger = structlog.get_logger()


def _convert_doc_to_question(doc: dict) -> Question:
    """Convert MongoDB document to Question model, handling ObjectId conversion"""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return Question(**doc)


class QuestionService:
    """Question service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.questions
    
    async def create_question(
        self,
        question_data: QuestionCreate,
        tutor_id: str,
        ai_generated: bool = False,
        generation_id: Optional[str] = None,
        extra_fields: Optional[Dict[str, Any]] = None
    ) -> Question:
        """Create a new question"""
        try:
            question_dict = question_data.dict()
            if extra_fields:
                question_dict.update(extra_fields)
            question_dict["tutor_id"] = tutor_id
            question_dict["created_at"] = datetime.now(timezone.utc)
            question_dict["updated_at"] = datetime.now(timezone.utc)
            question_dict["times_used"] = 0
            question_dict["ai_generated"] = ai_generated

            # AI-generated questions start as "pending" for approval
            if ai_generated:
                question_dict["status"] = QuestionStatus.PENDING
                question_dict["generation_id"] = generation_id
            else:
                question_dict["status"] = QuestionStatus.ACTIVE

            result = await self.collection.insert_one(question_dict)
            question_dict["_id"] = str(result.inserted_id)

            logger.info("Question created", question_id=str(result.inserted_id), tutor_id=tutor_id, ai_generated=ai_generated)
            return Question(**question_dict)

        except Exception as e:
            logger.error("Failed to create question", error=str(e))
            raise DatabaseException(f"Failed to create question: {str(e)}")
    
    async def get_question_by_id(self, question_id: str, tutor_id: Optional[str] = None) -> Question:
        """Get question by ID with optional ownership validation"""
        try:
            oid = to_object_id(question_id)
            query = {"_id": oid, "status": {"$ne": QuestionStatus.DELETED}}

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
            logger.error("Failed to get question", question_id=question_id, error=str(e))
            raise DatabaseException(f"Failed to get question: {str(e)}")
    
    async def get_question_for_student(self, question_id: str, student_id: str) -> QuestionForStudent:
        """Get question for student (without correct answers)

        Note: Student access is validated through assignment membership, not direct ownership.
        The student_id is logged for audit purposes.
        """
        question = await self.get_question_by_id(question_id)

        logger.debug("Student accessing question", question_id=question_id, student_id=student_id)

        # Remove correct answer information
        student_question = QuestionForStudent(
            id=str(question.id),
            question_text=question.question_text,
            question_type=question.question_type,
            topic=question.topic,
            difficulty=question.difficulty,
            points=question.points,
            options=[{"text": opt.text} for opt in question.options] if question.options else []
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
        per_page: int = 20
    ) -> Dict[str, Any]:
        """Get questions for tutor with optional filters and pagination"""
        try:
            query = {"tutor_id": tutor_id}

            # Default to active status if not specified
            if status:
                query["status"] = status
            else:
                query["status"] = {"$ne": QuestionStatus.DELETED}

            if subject_id:
                query["subject_id"] = subject_id
            if topic:
                query["topic"] = topic
            if difficulty:
                query["difficulty"] = difficulty
            if question_type:
                query["question_type"] = question_type
            if search:
                query["question_text"] = {"$regex": escape_regex(search), "$options": "i"}

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate skip
            skip = (page - 1) * per_page

            # Get paginated results
            cursor = self.collection.find(query).sort("created_at", -1).skip(skip).limit(per_page)

            questions = []
            async for question in cursor:
                questions.append(_convert_doc_to_question(question))

            return {
                "items": questions,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page if per_page > 0 else 0
            }

        except Exception as e:
            logger.error("Failed to get questions for tutor", tutor_id=tutor_id, error=str(e))
            raise DatabaseException(f"Failed to get questions: {str(e)}")

    async def get_generation_history(
        self,
        tutor_id: str,
        page: int = 1,
        per_page: int = 20
    ) -> Dict[str, Any]:
        """Get AI-generated questions history for tutor (both pending and approved)"""
        try:
            # Query for AI-generated questions only
            query = {
                "tutor_id": tutor_id,
                "ai_generated": True,
                "status": {"$ne": QuestionStatus.DELETED}
            }

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate skip
            skip = (page - 1) * per_page

            # Get paginated results sorted by creation date (newest first)
            cursor = self.collection.find(query).sort("created_at", -1).skip(skip).limit(per_page)

            questions = []
            async for question in cursor:
                questions.append(_convert_doc_to_question(question))

            return {
                "items": questions,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page if per_page > 0 else 0
            }

        except Exception as e:
            logger.error("Failed to get generation history", tutor_id=tutor_id, error=str(e))
            raise DatabaseException(f"Failed to get generation history: {str(e)}")

    async def get_questions_count_for_tutor(
        self,
        tutor_id: str,
        subject_id: Optional[str] = None,
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        status: Optional[str] = None
    ) -> int:
        """Get count of questions for tutor with optional filters"""
        try:
            query = {"tutor_id": tutor_id}

            if status:
                query["status"] = status
            else:
                query["status"] = {"$ne": QuestionStatus.DELETED}

            if subject_id:
                query["subject_id"] = subject_id
            if topic:
                query["topic"] = topic
            if difficulty:
                query["difficulty"] = difficulty

            return await self.collection.count_documents(query)

        except Exception as e:
            logger.error("Failed to count questions for tutor", tutor_id=tutor_id, error=str(e))
            raise DatabaseException(f"Failed to count questions: {str(e)}")

    async def get_questions_by_subject(
        self,
        subject_id: str,
        tutor_id: str,
        topic: Optional[str] = None,
        difficulty: Optional[str] = None,
        limit: int = 50
    ) -> List[Question]:
        """Get questions by subject with optional filters (tutor-scoped)"""
        try:
            query = {"subject_id": subject_id, "tutor_id": tutor_id, "status": QuestionStatus.ACTIVE}

            if topic:
                query["topic"] = topic
            if difficulty:
                query["difficulty"] = difficulty

            cursor = self.collection.find(query).limit(limit).sort("created_at", -1)

            questions = []
            async for question in cursor:
                questions.append(_convert_doc_to_question(question))

            return questions

        except Exception as e:
            logger.error("Failed to get questions by subject", subject_id=subject_id, error=str(e))
            raise DatabaseException(f"Failed to get questions: {str(e)}")
    
    async def update_question(self, question_id: str, question_update: QuestionUpdate, tutor_id: str) -> Question:
        """Update question"""
        try:
            # Verify ownership
            question = await self.get_question_by_id(question_id)
            if question.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to update this question")
            
            update_data = question_update.dict(exclude_unset=True)
            if not update_data:
                return question
            
            update_data["updated_at"] = datetime.now(timezone.utc)
            
            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {"$set": update_data}
            )
            
            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)
            
            logger.info("Question updated", question_id=question_id)
            return await self.get_question_by_id(question_id)
            
        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error("Failed to update question", question_id=question_id, error=str(e))
            raise DatabaseException(f"Failed to update question: {str(e)}")
    
    async def delete_question(self, question_id: str, tutor_id: str) -> bool:
        """Delete question (soft delete)"""
        try:
            # Verify ownership
            question = await self.get_question_by_id(question_id)
            if question.tutor_id != tutor_id:
                raise AuthorizationError("Not authorized to delete this question")
            
            # Check if question is used in any assignments
            assignment_count = await self.db.assignments.count_documents({
                "questions.question_id": question_id
            })
            
            if assignment_count > 0:
                raise ValidationError("Cannot delete question that is used in assignments")
            
            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {"$set": {"status": QuestionStatus.DELETED, "updated_at": datetime.now(timezone.utc)}}
            )
            
            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)
            
            logger.info("Question deleted", question_id=question_id)
            return True
            
        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error("Failed to delete question", question_id=question_id, error=str(e))
            raise DatabaseException(f"Failed to delete question: {str(e)}")
    
    async def increment_usage_count(self, question_id: str) -> bool:
        """Increment question usage count"""
        try:
            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {"$inc": {"times_used": 1}}
            )
            return result.matched_count > 0
        except Exception as e:
            logger.error("Failed to increment usage count", question_id=question_id, error=str(e))
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
                        "status": QuestionStatus.ACTIVE,
                        "approved_by": approver_id,
                        "approved_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info("Question approved", question_id=question_id, approver_id=approver_id)
            return await self.get_question_by_id(question_id)

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error("Failed to approve question", question_id=question_id, error=str(e))
            raise DatabaseException(f"Failed to approve question: {str(e)}")

    async def reject_question(self, question_id: str, rejector_id: str, reason: Optional[str] = None) -> Question:
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
                        "status": QuestionStatus.REJECTED,
                        "rejected_by": rejector_id,
                        "rejected_at": datetime.now(timezone.utc),
                        "rejection_reason": reason,
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info("Question rejected", question_id=question_id, rejector_id=rejector_id)
            return await self.get_question_by_id(question_id)

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error("Failed to reject question", question_id=question_id, error=str(e))
            raise DatabaseException(f"Failed to reject question: {str(e)}")

    async def request_revision(self, question_id: str, tutor_id: str, notes: str) -> Question:
        """Request revision for a pending question (with ownership validation)"""
        try:
            # Validate ownership
            question = await self.get_question_by_id(question_id, tutor_id=tutor_id)

            if question.status != QuestionStatus.PENDING:
                raise ValidationError("Only pending questions can have revision requested")

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$set": {
                        "revision_notes": notes,
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )

            if result.matched_count == 0:
                raise NotFoundError("Question", question_id)

            logger.info("Revision requested for question", question_id=question_id, tutor_id=tutor_id)
            return await self.get_question_by_id(question_id)

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error("Failed to request revision", question_id=question_id, error=str(e))
            raise DatabaseException(f"Failed to request revision: {str(e)}")

    async def bulk_approve_questions(self, question_ids: List[str], approver_id: str) -> int:
        """Approve multiple questions at once (with ownership validation)"""
        try:
            oids = [to_object_id(qid) for qid in question_ids]
            # Only approve questions owned by the approver
            result = await self.collection.update_many(
                {
                    "_id": {"$in": oids},
                    "tutor_id": approver_id,
                    "status": QuestionStatus.PENDING
                },
                {
                    "$set": {
                        "status": QuestionStatus.ACTIVE,
                        "approved_by": approver_id,
                        "approved_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )

            logger.info("Bulk approved questions", count=result.modified_count, approver_id=approver_id)
            return result.modified_count

        except Exception as e:
            logger.error("Failed to bulk approve questions", error=str(e))
            raise DatabaseException(f"Failed to bulk approve questions: {str(e)}")

    async def update_average_score(self, question_id: str, new_score: float) -> bool:
        """Update question average score using running average calculation.

        Uses the formula: new_average = (old_average * attempt_count + new_score) / (attempt_count + 1)
        This provides accurate historical average tracking.
        """
        try:
            # Get current question to calculate new average
            question = await self.get_question_by_id(question_id)

            current_attempt_count = getattr(question, 'attempt_count', 0) or 0
            current_average = question.average_score or 0.0

            # Calculate running average
            new_attempt_count = current_attempt_count + 1
            if current_attempt_count == 0:
                new_average = new_score
            else:
                # Running average formula: (old_avg * count + new_value) / (count + 1)
                total_score = current_average * current_attempt_count + new_score
                new_average = total_score / new_attempt_count

            oid = to_object_id(question_id)
            result = await self.collection.update_one(
                {"_id": oid},
                {"$set": {
                    "average_score": new_average,
                    "attempt_count": new_attempt_count
                }}
            )

            logger.debug(
                "Updated average score",
                question_id=question_id,
                new_score=new_score,
                new_average=new_average,
                attempt_count=new_attempt_count
            )

            return result.matched_count > 0

        except Exception as e:
            logger.error("Failed to update average score", question_id=question_id, error=str(e))
            return False

    async def get_text_content_from_file(self, file_id: str, tutor_id: str) -> Optional[str]:
        """Get processed text content from a file, ensuring tutor ownership."""
        try:
            file_doc = await self.db.files.find_one({
                "_id": to_object_id(file_id),
                "tutor_id": tutor_id
            })
            if file_doc and file_doc.get("processed_content"):
                return file_doc["processed_content"]
            return None
        except Exception as e:
            logger.error("Failed to get text content from file", file_id=file_id, error=str(e))
            raise DatabaseException(f"Failed to retrieve file content: {str(e)}")
