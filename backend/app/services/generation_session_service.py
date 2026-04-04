"""
Generation Session Service

Handles CRUD operations for question generation sessions.
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid
import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument
from app.core.exceptions import ValidationError

from app.models.generation_session import (
    GenerationSessionModel,
    SessionStatus,
    StoredQuestion,
    QuestionStatus,
    SessionSummary,
    SessionChatMessage,
)

logger = structlog.get_logger()


class GenerationSessionService:
    """Service for managing generation sessions"""

    COLLECTION = "generation_sessions"

    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.collection = db[self.COLLECTION]

    async def create_session(
        self,
        user_id: str,
        tenant_id: str,
        prompt: str,
        config: Dict[str, Any],
        material_ids: Optional[List[str]] = None,
        initial_chat_messages: Optional[List[SessionChatMessage]] = None,
    ) -> GenerationSessionModel:
        """Create a new generation session"""
        session_id = str(uuid.uuid4())

        session = GenerationSessionModel(
            session_id=session_id,
            user_id=user_id,
            tenant_id=tenant_id,
            original_prompt=prompt,
            config=config,
            material_ids=material_ids or [],
            chat_messages=initial_chat_messages or [],
            total_questions=config.get("question_count", 5),
            status=SessionStatus.PENDING,
        )

        doc = session.model_dump(by_alias=True, exclude={"id"})
        doc["_id"] = session_id

        await self.collection.insert_one(doc)
        logger.info("Created generation session", session_id=session_id)

        return session

    async def get_session(
        self, session_id: str, user_id: str
    ) -> Optional[GenerationSessionModel]:
        """Get a session by ID"""
        doc = await self.collection.find_one({"_id": session_id, "user_id": user_id})

        if not doc:
            return None

        return GenerationSessionModel(**doc)

    async def _persist_session(self, session: GenerationSessionModel) -> bool:
        """Persist a fully materialized session document."""
        payload = session.model_dump(by_alias=True, exclude_none=True)
        payload["_id"] = session.id or session.session_id

        result = await self.collection.replace_one(
            {"_id": session.session_id, "user_id": session.user_id},
            payload,
        )
        return result.matched_count > 0

    @staticmethod
    def _find_question_index(
        session: GenerationSessionModel, question_id: str
    ) -> Optional[int]:
        for index, question in enumerate(session.questions):
            if question.question_id == question_id:
                return index
        return None

    @staticmethod
    def _assert_transition_allowed(
        current_status: QuestionStatus,
        next_status: QuestionStatus,
    ) -> None:
        if (
            next_status == QuestionStatus.APPROVED
            and current_status != QuestionStatus.PENDING
        ):
            raise ValidationError("Only pending questions can be approved")
        if (
            next_status == QuestionStatus.REJECTED
            and current_status != QuestionStatus.PENDING
        ):
            raise ValidationError("Only pending questions can be rejected")
        if (
            next_status == QuestionStatus.PENDING
            and current_status != QuestionStatus.PENDING
        ):
            raise ValidationError("Only pending questions can have revision requested")

    async def update_session(
        self, session_id: str, user_id: str, **updates
    ) -> Optional[GenerationSessionModel]:
        """Update a session"""
        updates["updated_at"] = datetime.now(timezone.utc)

        result = await self.collection.find_one_and_update(
            {"_id": session_id, "user_id": user_id},
            {"$set": updates},
            return_document=ReturnDocument.AFTER,
        )

        if not result:
            return None

        return GenerationSessionModel(**result)

    async def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session and all its questions"""
        result = await self.collection.delete_one(
            {"_id": session_id, "user_id": user_id}
        )
        return result.deleted_count > 0

    async def add_question(
        self, session_id: str, user_id: str, question: StoredQuestion
    ) -> bool:
        """Add a question to a session"""
        session = await self.get_session(session_id, user_id)
        if not session:
            logger.error("Session not found for add_question", session_id=session_id)
            return False

        question_index = self._find_question_index(session, question.question_id)
        if question_index is None:
            session.questions.append(question)
        else:
            session.questions[question_index] = question

        session.current_question_index = len(session.questions)
        session.updated_at = datetime.now(timezone.utc)

        logger.info(
            "Adding question to session",
            session_id=session_id,
            user_id=user_id,
            question_id=question.question_id,
        )
        return await self._persist_session(session)

    async def append_chat_message(
        self, session_id: str, user_id: str, message: SessionChatMessage
    ) -> bool:
        """Append a chat message to a persisted session transcript."""
        session = await self.get_session(session_id, user_id)
        if not session:
            return False

        session.chat_messages.append(message)
        session.updated_at = datetime.now(timezone.utc)
        return await self._persist_session(session)

    async def update_question_status(
        self,
        session_id: str,
        user_id: str,
        question_id: str,
        status: QuestionStatus,
        review_comments: Optional[str] = None,
    ) -> bool:
        """Update a question's status"""
        session = await self.get_session(session_id, user_id)
        if not session:
            return False

        question_index = self._find_question_index(session, question_id)
        if question_index is None:
            return False

        now = datetime.now(timezone.utc)
        question = session.questions[question_index]
        self._assert_transition_allowed(question.status, status)
        question.status = status
        question.reviewed_by = user_id
        question.reviewed_at = now

        if review_comments is not None:
            question.review_comments = review_comments

        if status == QuestionStatus.APPROVED:
            question.rejection_reason = None
        elif status == QuestionStatus.REJECTED:
            question.rejection_reason = review_comments
        else:
            question.rejection_reason = None

        session.updated_at = now
        return await self._persist_session(session)

    async def request_question_revision(
        self, session_id: str, user_id: str, question_id: str, notes: str
    ) -> bool:
        """Keep a draft in review with explicit revision guidance."""
        return await self.update_question_status(
            session_id=session_id,
            user_id=user_id,
            question_id=question_id,
            status=QuestionStatus.PENDING,
            review_comments=notes,
        )

    async def update_question_content(
        self, session_id: str, user_id: str, question_id: str, update_data: dict
    ) -> bool:
        """Update a question's content (text, options, answer, explanation)"""
        session = await self.get_session(session_id, user_id)
        if not session:
            return False

        question_index = self._find_question_index(session, question_id)
        if question_index is None:
            return False

        now = datetime.now(timezone.utc)
        question = session.questions[question_index]
        question.edit_history.append(
            {
                "edited_at": now.isoformat(),
                "edited_by": user_id,
                "previous": {
                    "type": question.type,
                    "difficulty": question.difficulty,
                    "blooms_level": question.blooms_level,
                    "question_text": question.question_text,
                    "options": question.options,
                    "correct_answer": question.correct_answer,
                    "explanation": question.explanation,
                    "source_citations": question.source_citations,
                    "source_ids": question.source_ids,
                    "tags": question.tags,
                    "quality_score": question.quality_score,
                    "status": question.status.value,
                    "review_comments": question.review_comments,
                    "rejection_reason": question.rejection_reason,
                    "published_question_id": question.published_question_id,
                    "published_at": question.published_at.isoformat()
                    if question.published_at
                    else None,
                },
            }
        )

        for key, value in update_data.items():
            setattr(question, key, value)

        question.status = QuestionStatus.PENDING
        question.review_comments = None
        question.reviewed_by = None
        question.reviewed_at = None
        question.rejection_reason = None

        session.updated_at = now
        return await self._persist_session(session)

    async def delete_question(
        self, session_id: str, user_id: str, question_id: str
    ) -> bool:
        """Delete a single generated draft question from a session."""
        session = await self.get_session(session_id, user_id)
        if not session:
            return False

        original_count = len(session.questions)
        session.questions = [
            question
            for question in session.questions
            if question.question_id != question_id
        ]
        if len(session.questions) == original_count:
            return False

        session.current_question_index = len(session.questions)
        session.updated_at = datetime.now(timezone.utc)
        return await self._persist_session(session)

    async def mark_questions_published(
        self,
        session_id: str,
        user_id: str,
        published_map: Dict[str, str],
    ) -> bool:
        """Attach published question ids back onto approved session drafts."""
        if not published_map:
            return True

        session = await self.get_session(session_id, user_id)
        if not session:
            return False

        now = datetime.now(timezone.utc)
        updated = False
        for question in session.questions:
            published_question_id = published_map.get(question.question_id)
            if not published_question_id:
                continue
            question.published_question_id = published_question_id
            question.published_at = now
            updated = True

        if not updated:
            return False

        session.updated_at = now
        return await self._persist_session(session)

    async def list_sessions(
        self,
        user_id: str,
        tenant_id: str,
        status: Optional[SessionStatus] = None,
        page: int = 1,
        per_page: int = 20,
    ) -> tuple[List[SessionSummary], int]:
        """List sessions for a user"""
        query = {"user_id": user_id, "tenant_id": tenant_id}
        if status:
            query["status"] = status.value

        total = await self.collection.count_documents(query)

        cursor = (
            self.collection.find(query)
            .sort("created_at", -1)
            .skip((page - 1) * per_page)
            .limit(per_page)
        )

        sessions = []
        async for doc in cursor:
            questions = doc.get("questions", [])
            approved = sum(
                1 for q in questions if q.get("status") == QuestionStatus.APPROVED.value
            )
            pending = sum(
                1 for q in questions if q.get("status") == QuestionStatus.PENDING.value
            )
            rejected = sum(
                1 for q in questions if q.get("status") == QuestionStatus.REJECTED.value
            )

            sessions.append(
                SessionSummary(
                    session_id=doc["session_id"],
                    status=SessionStatus(doc["status"]),
                    prompt=doc["original_prompt"],
                    original_prompt=doc["original_prompt"],
                    question_count=len(questions),
                    questions_count=len(questions),
                    approved_count=approved,
                    pending_count=pending,
                    rejected_count=rejected,
                    created_at=doc["created_at"],
                    updated_at=doc["updated_at"],
                )
            )

        return sessions, total

    async def get_pending_questions(
        self, user_id: str, tenant_id: str, page: int = 1, per_page: int = 20
    ) -> tuple[List[dict], int]:
        """Get all pending questions across all sessions for a user"""
        return await self.get_all_questions(
            user_id, tenant_id, QuestionStatus.PENDING, page, per_page
        )

    async def get_all_questions(
        self,
        user_id: str,
        tenant_id: str,
        status: Optional[QuestionStatus] = None,
        page: int = 1,
        per_page: int = 20,
    ) -> tuple[List[dict], int]:
        """Get all questions across all sessions for a user, optionally filtered by status"""
        # Build pipeline
        pipeline = [
            {"$match": {"user_id": user_id, "tenant_id": tenant_id}},
            {"$unwind": "$questions"},
        ]

        # Add status filter if provided
        if status:
            pipeline.append({"$match": {"questions.status": status.value}})

        pipeline.extend(
            [
                {"$sort": {"created_at": -1}},
                {
                    "$project": {
                        "_id": 0,
                        "session_id": 1,
                        "session_prompt": "$original_prompt",
                        "subject": "$config.subject",
                        "topic": "$config.topic",
                        "session_created_at": "$created_at",
                        "session_status": "$status",
                        "question_id": "$questions.question_id",
                        "type": "$questions.type",
                        "difficulty": "$questions.difficulty",
                        "blooms_level": "$questions.blooms_level",
                        "question_text": "$questions.question_text",
                        "options": "$questions.options",
                        "correct_answer": "$questions.correct_answer",
                        "explanation": "$questions.explanation",
                        "source_citations": "$questions.source_citations",
                        "source_ids": "$questions.source_ids",
                        "tags": "$questions.tags",
                        "quality_score": "$questions.quality_score",
                        "status": "$questions.status",
                        "review_comments": "$questions.review_comments",
                        "reviewed_by": "$questions.reviewed_by",
                        "reviewed_at": "$questions.reviewed_at",
                        "rejection_reason": "$questions.rejection_reason",
                        "published_question_id": "$questions.published_question_id",
                        "published_at": "$questions.published_at",
                    }
                },
            ]
        )

        # Get total count first
        count_pipeline = pipeline + [{"$count": "total"}]
        count_result = await self.collection.aggregate(count_pipeline).to_list(1)
        total = count_result[0]["total"] if count_result else 0

        # Add pagination
        pipeline.extend([{"$skip": (page - 1) * per_page}, {"$limit": per_page}])

        questions = await self.collection.aggregate(pipeline).to_list(per_page)
        return questions, total

    async def get_sessions_with_questions(
        self, user_id: str, tenant_id: str, page: int = 1, per_page: int = 10
    ) -> tuple[List[dict], int]:
        """Get generation sessions with question counts and status summary"""
        pipeline = [
            {"$match": {"user_id": user_id, "tenant_id": tenant_id}},
            {"$sort": {"created_at": -1}},
            {
                "$project": {
                    "_id": 0,
                    "session_id": 1,
                    "original_prompt": 1,
                    "status": 1,
                    "created_at": 1,
                    "updated_at": 1,
                    "config": 1,
                    "questions": 1,
                    "total_questions": {"$size": {"$ifNull": ["$questions", []]}},
                    "pending_count": {
                        "$size": {
                            "$filter": {
                                "input": {"$ifNull": ["$questions", []]},
                                "cond": {
                                    "$eq": [
                                        "$$this.status",
                                        QuestionStatus.PENDING.value,
                                    ]
                                },
                            }
                        }
                    },
                    "approved_count": {
                        "$size": {
                            "$filter": {
                                "input": {"$ifNull": ["$questions", []]},
                                "cond": {
                                    "$eq": [
                                        "$$this.status",
                                        QuestionStatus.APPROVED.value,
                                    ]
                                },
                            }
                        }
                    },
                    "rejected_count": {
                        "$size": {
                            "$filter": {
                                "input": {"$ifNull": ["$questions", []]},
                                "cond": {
                                    "$eq": [
                                        "$$this.status",
                                        QuestionStatus.REJECTED.value,
                                    ]
                                },
                            }
                        }
                    },
                }
            },
        ]

        # Get total count
        count_result = await self.collection.count_documents(
            {"user_id": user_id, "tenant_id": tenant_id}
        )

        # Add pagination
        pipeline.extend([{"$skip": (page - 1) * per_page}, {"$limit": per_page}])

        sessions = await self.collection.aggregate(pipeline).to_list(per_page)
        return sessions, count_result

    async def get_stats(self, user_id: str, tenant_id: str) -> dict:
        """Get generation statistics for a user"""
        from datetime import timedelta

        # Get current month start
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        query = {"user_id": user_id, "tenant_id": tenant_id}

        # Total sessions
        total_sessions = await self.collection.count_documents(query)

        # This month's sessions
        month_query = {**query, "created_at": {"$gte": month_start}}
        month_sessions = await self.collection.count_documents(month_query)

        # Aggregate questions data
        pipeline = [
            {"$match": query},
            {"$unwind": {"path": "$questions", "preserveNullAndEmptyArrays": False}},
            {
                "$group": {
                    "_id": None,
                    "total_questions": {"$sum": 1},
                    "approved": {
                        "$sum": {
                            "$cond": [{"$eq": ["$questions.status", "approved"]}, 1, 0]
                        }
                    },
                    "rejected": {
                        "$sum": {
                            "$cond": [{"$eq": ["$questions.status", "rejected"]}, 1, 0]
                        }
                    },
                }
            },
        ]

        result = await self.collection.aggregate(pipeline).to_list(1)

        if result:
            total_questions = result[0].get("total_questions", 0)
            approved = result[0].get("approved", 0)
            rejected = result[0].get("rejected", 0)
        else:
            total_questions = 0
            approved = 0
            rejected = 0

        # This month's questions
        month_pipeline = [
            {"$match": month_query},
            {"$unwind": {"path": "$questions", "preserveNullAndEmptyArrays": False}},
            {"$count": "count"},
        ]
        month_result = await self.collection.aggregate(month_pipeline).to_list(1)
        month_questions = month_result[0]["count"] if month_result else 0

        # Success rate (completed sessions / total sessions)
        completed = await self.collection.count_documents(
            {**query, "status": SessionStatus.COMPLETED.value}
        )
        success_rate = (
            round((completed / total_sessions * 100), 1) if total_sessions > 0 else 0
        )

        # Average quality (approved / (approved + rejected))
        reviewed = approved + rejected
        avg_quality = (
            round((approved / reviewed * 5), 1) if reviewed > 0 else 0
        )  # Scale to 5

        return {
            "total_generated": total_questions,
            "this_month": month_questions,
            "success_rate": success_rate,
            "avg_quality": avg_quality,
            "total_sessions": total_sessions,
            "month_sessions": month_sessions,
            "approved_questions": approved,
            "rejected_questions": rejected,
        }
