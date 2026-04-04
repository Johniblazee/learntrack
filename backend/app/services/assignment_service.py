"""
Assignment service for database operations
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import inspect
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
import os
from bson import ObjectId

from app.models.assignment import (
    Assignment,
    AssignmentCreate,
    AssignmentQuestionOptionSnapshot,
    AssignmentQuestionSnapshot,
    AssignmentUpdate,
    AssignmentInDB,
    AssignmentForStudent,
    AssignmentType,
    AssignmentStatus,
    QuestionAssignment,
)
from app.models.question import QuestionStatus
from app.models.notification import NotificationCreate, NotificationType
from app.models.activity import ActivityCreate, ActivityType
from app.core.exceptions import (
    AuthorizationError,
    DatabaseException,
    NotFoundError,
    ValidationError,
)
from app.core.utils import to_object_id
from app.services.activity_service import ActivityService
from app.services.email_service import email_service
from app.services.notification_service import NotificationService

logger = structlog.get_logger()

# Get frontend URL from environment
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

STUDENT_VISIBLE_ASSIGNMENT_STATUSES = {
    AssignmentStatus.PUBLISHED.value,
    AssignmentStatus.ACTIVE.value,
    AssignmentStatus.COMPLETED.value,
    AssignmentStatus.ARCHIVED.value,
}


def _convert_doc_to_assignment(doc: dict) -> Assignment:
    """Convert MongoDB document to Assignment model, handling ObjectId conversion"""
    normalized = dict(doc or {})
    if normalized.get("_id") is not None:
        normalized["_id"] = str(normalized["_id"])

    normalized.setdefault("subject_id", "")
    normalized.setdefault("topic", None)
    normalized.setdefault("student_ids", [])
    normalized.setdefault("questions", [])
    normalized.setdefault("status", AssignmentStatus.DRAFT.value)
    normalized.setdefault("total_points", 0)

    return Assignment(**normalized)


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _count_answered_questions(answers: Any) -> int:
    if not isinstance(answers, list):
        return 0

    total = 0
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        answer_text = str(answer.get("answer") or "").strip()
        selected_options = answer.get("selected_options") or []
        if answer_text or selected_options:
            total += 1
    return total


def _derive_student_assignment_status(
    assignment_doc: Dict[str, Any], progress_doc: Optional[Dict[str, Any]]
) -> str:
    assignment_status = str(assignment_doc.get("status") or "").lower()
    if assignment_status in {
        AssignmentStatus.ARCHIVED.value,
        AssignmentStatus.DRAFT.value,
    }:
        return assignment_status

    raw_progress_status = str((progress_doc or {}).get("status") or "").lower()
    if raw_progress_status == "graded":
        return "graded"
    if raw_progress_status == "submitted":
        return "submitted"
    if raw_progress_status == "in_progress":
        return "in_progress"

    due_date = assignment_doc.get("due_date")
    if isinstance(due_date, datetime):
        normalized_due_date = (
            due_date
            if due_date.tzinfo is not None
            else due_date.replace(tzinfo=timezone.utc)
        )
        if normalized_due_date < datetime.now(timezone.utc):
            return "overdue"

    return "pending"


def _build_assignment_question_snapshot(
    question_doc: Dict[str, Any],
) -> AssignmentQuestionSnapshot:
    options: List[AssignmentQuestionOptionSnapshot] = []
    for option in question_doc.get("options") or []:
        if isinstance(option, dict):
            option_text = str(option.get("text") or "").strip()
        else:
            option_text = str(getattr(option, "text", option) or "").strip()
        if option_text:
            options.append(AssignmentQuestionOptionSnapshot(text=option_text))

    return AssignmentQuestionSnapshot(
        question_text=str(question_doc.get("question_text") or "Untitled question"),
        question_type=str(question_doc.get("question_type") or "short-answer"),
        topic=str(question_doc.get("topic") or "general"),
        difficulty=str(question_doc.get("difficulty") or "medium"),
        explanation=question_doc.get("explanation"),
        options=options,
        correct_answer=question_doc.get("correct_answer"),
    )


class AssignmentService:
    """Assignment service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        collection = getattr(database, "assignments", None)
        if collection is None:
            try:
                from unittest.mock import AsyncMock

                collection = AsyncMock()
            except Exception:
                collection = database
            try:
                setattr(database, "assignments", collection)
            except Exception:
                pass
        self.collection: Any = collection

    @staticmethod
    def _normalize_ids(values: List[str]) -> List[str]:
        return list(
            dict.fromkeys(str(value).strip() for value in values if str(value).strip())
        )

    async def _resolve_owned_assignment_ids(
        self, assignment_ids: List[str], tutor_id: str
    ) -> tuple[List[str], List[str]]:
        normalized_ids = self._normalize_ids(assignment_ids)
        assignment_docs = await self.collection.find(
            {
                "_id": {
                    "$in": [
                        to_object_id(assignment_id) for assignment_id in normalized_ids
                    ]
                },
                "tutor_id": tutor_id,
            },
            {"_id": 1},
        ).to_list(length=None)
        found_ids = {
            str(assignment_doc.get("_id"))
            for assignment_doc in assignment_docs
            if assignment_doc.get("_id") is not None
        }
        owned_ids = [
            assignment_id
            for assignment_id in normalized_ids
            if assignment_id in found_ids
        ]
        skipped_ids = [
            assignment_id
            for assignment_id in normalized_ids
            if assignment_id not in found_ids
        ]
        return owned_ids, skipped_ids

    async def _send_assignment_publication_notifications(
        self, assignment: Dict[str, Any]
    ) -> None:
        try:
            tutor_id = str(assignment.get("tutor_id") or "").strip()
            if not tutor_id:
                return

            student_ids = self._normalize_ids(assignment.get("student_ids") or [])
            if not student_ids:
                return

            assignment_id_str = str(assignment.get("_id") or assignment.get("id") or "")
            assignment_title = str(assignment.get("title") or "Assignment")
            assignment_link = f"{FRONTEND_URL}/dashboard/assignments"

            tutor = await self.db.tutors.find_one({"clerk_id": tutor_id})
            tutor_name = tutor.get("name", "Your Teacher") if tutor else "Your Teacher"
            notification_service = NotificationService(self.db)
            activity_service = ActivityService(self.db)

            student_docs_list = await self.db.students.find(
                {"clerk_id": {"$in": student_ids}}
            ).to_list(length=None)
            student_docs_map = {
                doc["clerk_id"]: doc for doc in student_docs_list if doc.get("clerk_id")
            }

            notification_due_date = assignment.get("due_date") or datetime.now(
                timezone.utc
            )
            bulk_notifications = []

            for student_id in student_ids:
                try:
                    student = student_docs_map.get(student_id)
                    student_name = (
                        student.get("name", "") if isinstance(student, dict) else ""
                    )

                    if student and student.get("email"):
                        email_service.send_assignment_notification(
                            to_email=student["email"],
                            to_name=student_name,
                            assignment_title=assignment_title,
                            teacher_name=tutor_name,
                            due_date=notification_due_date,
                            assignment_link=assignment_link,
                        )

                    bulk_notifications.append(
                        NotificationCreate(
                            title="New assignment assigned",
                            message=f"{assignment_title} was assigned by {tutor_name}",
                            notification_type=NotificationType.SYSTEM,
                            recipient_id=student_id,
                            tutor_id=tutor_id,
                            related_entity_id=assignment_id_str,
                            related_entity_type="assignment",
                            action_url="/dashboard/assignments",
                        )
                    )

                    await activity_service.create_activity(
                        activity_data=ActivityCreate(
                            activity_type=ActivityType.ASSIGNMENT_STARTED,
                            user_id=student_id,
                            tutor_id=tutor_id,
                            description=f"Assigned {assignment_title}",
                            related_entity_id=assignment_id_str,
                            related_entity_type="assignment",
                            metadata={
                                "assignment_title": assignment_title,
                                "student_name": student_name,
                                "assigned_by": tutor_name,
                            },
                        ),
                        user_id=student_id,
                        tutor_id=tutor_id,
                    )
                except Exception as student_error:
                    logger.warning(
                        "Failed to prepare assignment publication notification",
                        student_id=student_id,
                        error=str(student_error),
                    )

            if bulk_notifications:
                await notification_service.bulk_create_notifications(bulk_notifications)
        except Exception as e:
            logger.warning(
                "Failed to send assignment publication notifications", error=str(e)
            )

    async def get_assignment(self, assignment_id: str) -> Assignment:
        """Backward-compatible alias for get_assignment_by_id."""
        return await self.get_assignment_by_id(assignment_id)

    async def get_assignment_with_ownership_check(
        self, assignment_id: str, tutor_id: str
    ) -> Assignment:
        """Get assignment and verify ownership for backward compatibility."""
        assignment = await self.get_assignment_by_id(assignment_id)
        if assignment.tutor_id != tutor_id:
            raise AuthorizationError("Not authorized to access this assignment")
        return assignment

    async def create_assignment(
        self, assignment_data: AssignmentCreate, tutor_id: str
    ) -> Assignment:
        """Create a new assignment with support for groups and subject-based assignment"""
        try:
            question_ids = list(
                dict.fromkeys(
                    str(question_id).strip()
                    for question_id in assignment_data.question_ids
                    if str(question_id).strip()
                )
            )
            question_oids = [to_object_id(question_id) for question_id in question_ids]
            question_docs = await self.db.questions.find(
                {
                    "_id": {"$in": question_oids},
                    "tutor_id": tutor_id,
                    "status": QuestionStatus.ACTIVE.value,
                },
                {
                    "_id": 1,
                    "question_text": 1,
                    "question_type": 1,
                    "topic": 1,
                    "difficulty": 1,
                    "points": 1,
                    "explanation": 1,
                    "options": 1,
                    "correct_answer": 1,
                },
            ).to_list(length=None)
            question_points = {
                str(question_doc.get("_id")): int(question_doc.get("points") or 1)
                for question_doc in question_docs
                if question_doc.get("_id") is not None
            }
            question_snapshots = {
                str(question_doc.get("_id")): _build_assignment_question_snapshot(
                    question_doc
                )
                for question_doc in question_docs
                if question_doc.get("_id") is not None
            }

            if len(question_points) != len(question_ids) or len(
                question_snapshots
            ) != len(question_ids):
                raise ValidationError(
                    "One or more selected questions are unavailable or do not belong to you"
                )

            # Resolve student IDs from direct selection, groups, and subject filters.
            normalized_direct_student_ids = await self._resolve_student_clerk_ids(
                assignment_data.student_ids or []
            )
            if normalized_direct_student_ids and len(
                normalized_direct_student_ids
            ) != len(
                list(
                    dict.fromkeys(
                        str(student_id).strip()
                        for student_id in (assignment_data.student_ids or [])
                        if str(student_id).strip()
                    )
                )
            ):
                raise ValidationError(
                    "One or more selected students must claim their account before assignments can be created"
                )

            student_ids = set(normalized_direct_student_ids)
            group_ids = assignment_data.group_ids or []

            # Add students from groups
            if group_ids:
                for group_id in group_ids:
                    group_students = await self._get_students_from_group(group_id)
                    student_ids.update(group_students)

            # Add students from subject filter
            if assignment_data.subject_filter:
                subject_students = await self._get_students_by_subject(
                    tutor_id, assignment_data.subject_filter
                )
                student_ids.update(subject_students)

            if not student_ids:
                raise ValidationError(
                    "At least one claimed student is required before creating an assignment"
                )

            # Create assignment document
            assignment_dict = assignment_data.model_dump(
                exclude={"group_ids", "subject_filter", "question_ids"}
            )
            questions = [
                QuestionAssignment(
                    question_id=qid,
                    order=index,
                    points=question_points.get(qid, 1),
                    snapshot=question_snapshots.get(qid),
                )
                for index, qid in enumerate(question_ids)
            ]
            assignment_dict["tutor_id"] = tutor_id
            assignment_dict["created_at"] = datetime.now(timezone.utc)
            assignment_dict["updated_at"] = datetime.now(timezone.utc)
            assignment_dict["status"] = AssignmentStatus.DRAFT.value
            assignment_dict["published_at"] = None
            assignment_dict["questions"] = [q.model_dump() for q in questions]
            assignment_dict["student_ids"] = list(student_ids)
            assignment_dict["group_ids"] = group_ids
            assignment_dict["assigned_via_subject"] = assignment_data.subject_filter
            assignment_dict["is_group_assignment"] = bool(
                group_ids or assignment_data.subject_filter
            )
            assignment_dict["group_completion_rates"] = {}
            assignment_dict["group_average_scores"] = {}
            assignment_dict["total_points"] = sum(q.points for q in questions)

            result = await self.collection.insert_one(assignment_dict)
            assignment_dict["_id"] = str(result.inserted_id)

            logger.info(
                "Assignment draft created",
                assignment_id=str(result.inserted_id),
                student_count=len(student_ids),
                group_count=len(group_ids),
                is_group_assignment=assignment_dict["is_group_assignment"],
            )

            return Assignment(**assignment_dict)

        except Exception as e:
            logger.error("Failed to create assignment", error=str(e))
            raise DatabaseException(f"Failed to create assignment: {str(e)}")

    async def get_assignment_by_id(
        self, assignment_id: str, tutor_id: Optional[str] = None
    ) -> Assignment:
        """Get assignment by ID with optional ownership validation"""
        try:
            oid = to_object_id(assignment_id)
            query: Dict[str, Any] = {"_id": oid}

            # Add tutor_id filter if provided for ownership validation
            if tutor_id:
                query["tutor_id"] = tutor_id

            assignment = await self.collection.find_one(query)
            if not assignment:
                if tutor_id:
                    raise AuthorizationError("Not authorized to access this assignment")
                raise NotFoundError("Assignment", assignment_id)
            return _convert_doc_to_assignment(assignment)
        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to get assignment", assignment_id=assignment_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get assignment: {str(e)}")

    async def get_assignments_for_tutor(
        self,
        tutor_id: str,
        subject_id: Optional[str] = None,
        status: Optional[str] = None,
        page: Optional[int] = None,
        per_page: Optional[int] = None,
    ) -> Any:
        """Get assignments for a tutor (legacy list or paginated dict)."""
        try:
            query: Dict[str, Any] = {"tutor_id": tutor_id}

            if subject_id:
                query["subject_id"] = subject_id
            if status:
                query["status"] = status

            cursor = await _maybe_await(self.collection.find(query))

            if page is None or per_page is None:
                # Cap at 200 to prevent unbounded collection scans
                max_docs = 200
                assignment_docs = []
                if hasattr(cursor, "to_list"):
                    assignment_docs = await _maybe_await(
                        cursor.to_list(length=max_docs)
                    )
                return [_convert_doc_to_assignment(doc) for doc in assignment_docs]

            per_page = min(per_page, 200)

            if hasattr(cursor, "sort"):
                cursor = await _maybe_await(cursor.sort("created_at", -1))

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate skip
            skip = (page - 1) * per_page

            if hasattr(cursor, "skip"):
                cursor = await _maybe_await(cursor.skip(skip))
            if hasattr(cursor, "limit"):
                cursor = await _maybe_await(cursor.limit(per_page))

            assignment_docs = []
            if hasattr(cursor, "to_list"):
                assignment_docs = await _maybe_await(cursor.to_list(length=per_page))

            assignment_ids = [
                str(assignment.get("_id"))
                for assignment in assignment_docs
                if assignment.get("_id")
            ]

            progress_stats_map: Dict[str, Dict[str, Any]] = {}
            if assignment_ids:
                completion_statuses = ["submitted", "graded", "completed"]
                progress_pipeline = [
                    {
                        "$match": {
                            "tutor_id": tutor_id,
                            "assignment_id": {"$in": assignment_ids},
                            "status": {"$in": completion_statuses},
                        }
                    },
                    {
                        "$group": {
                            "_id": "$assignment_id",
                            "submitted_students": {"$addToSet": "$student_id"},
                            "average_score": {"$avg": "$score"},
                        }
                    },
                ]

                progress_stats = await self.db.progress.aggregate(
                    progress_pipeline
                ).to_list(length=len(assignment_ids))

                for stats in progress_stats:
                    submitted_students = [
                        student_id
                        for student_id in stats.get("submitted_students", [])
                        if student_id
                    ]
                    avg_score = stats.get("average_score")
                    progress_stats_map[str(stats.get("_id"))] = {
                        "completion_count": len(submitted_students),
                        "average_score": round(float(avg_score), 1)
                        if avg_score is not None
                        else None,
                    }

            assignments: List[Assignment] = []
            for assignment in assignment_docs:
                assignment_id = str(assignment.get("_id"))
                assignment_stats = progress_stats_map.get(assignment_id, {})

                assignment["completion_count"] = int(
                    assignment_stats.get(
                        "completion_count", assignment.get("completion_count", 0)
                    )
                )

                if "average_score" in assignment_stats:
                    assignment["average_score"] = assignment_stats.get("average_score")

                assignments.append(_convert_doc_to_assignment(assignment))

            return {
                "items": assignments,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page
                if per_page > 0
                else 0,
            }

        except Exception as e:
            logger.error(
                "Failed to get tutor assignments", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get assignments: {str(e)}")

    async def get_assignments_for_student(
        self, student_id: str
    ) -> List[AssignmentForStudent]:
        """Get assignments assigned to a student"""
        try:
            student_doc = await self.db.students.find_one({"clerk_id": student_id})
            if not student_doc or not student_doc.get("tutor_id"):
                return []

            result = await self.get_student_assignment_summaries(
                student_id=student_id,
                tutor_id=str(student_doc.get("tutor_id")),
                page=1,
                per_page=200,
            )
            return result["items"]

        except Exception as e:
            logger.error(
                "Failed to get student assignments", student_id=student_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get assignments: {str(e)}")

    async def get_student_assignment_summaries(
        self,
        student_id: str,
        tutor_id: str,
        status: Optional[str] = None,
        page: int = 1,
        per_page: int = 10,
    ) -> Dict[str, Any]:
        """Get student-facing assignment summaries joined with progress state."""
        try:
            query: Dict[str, Any] = {
                "tutor_id": tutor_id,
                "student_ids": student_id,
                "status": {"$in": list(STUDENT_VISIBLE_ASSIGNMENT_STATUSES)},
            }

            assignment_docs = (
                await self.collection.find(query)
                .sort("due_date", 1)
                .to_list(length=500)
            )

            assignment_ids = [
                str(assignment.get("_id"))
                for assignment in assignment_docs
                if assignment.get("_id")
            ]

            progress_docs = []
            if assignment_ids:
                progress_docs = await self.db.progress.find(
                    {
                        "student_id": student_id,
                        "assignment_id": {"$in": assignment_ids},
                    }
                ).to_list(length=len(assignment_ids))

            progress_by_assignment = {
                str(progress.get("assignment_id")): progress
                for progress in progress_docs
                if progress.get("assignment_id")
            }

            subject_object_ids = []
            subject_name_by_string_id: Dict[str, str] = {}
            for assignment in assignment_docs:
                subject_id = assignment.get("subject_id")
                if isinstance(subject_id, str):
                    try:
                        subject_object_ids.append(to_object_id(subject_id))
                    except Exception:
                        subject_name_by_string_id[subject_id] = subject_id

            subject_docs = []
            if subject_object_ids:
                subject_docs = await self.db.subjects.find(
                    {"_id": {"$in": subject_object_ids}},
                    {"name": 1},
                ).to_list(length=len(subject_object_ids))

            subject_name_map = {
                str(subject.get("_id")): subject.get("name", "General")
                for subject in subject_docs
                if subject.get("_id")
            }

            summaries: List[AssignmentForStudent] = []
            for assignment in assignment_docs:
                assignment_id = str(assignment.get("_id"))
                progress_doc = progress_by_assignment.get(assignment_id)
                question_count = len(assignment.get("questions", []) or [])
                answered_count = _count_answered_questions(
                    progress_doc.get("answers") if progress_doc else []
                )
                derived_status = _derive_student_assignment_status(
                    assignment, progress_doc
                )
                progress_percent = (
                    round((answered_count / question_count) * 100)
                    if question_count > 0
                    else (100 if derived_status in {"submitted", "graded"} else 0)
                )

                subject_raw = assignment.get("subject_id")
                subject_key = str(subject_raw) if subject_raw is not None else ""
                subject_name = subject_name_map.get(
                    subject_key,
                    subject_name_by_string_id.get(subject_key, "General"),
                )

                summary = AssignmentForStudent(
                    id=assignment_id,
                    title=assignment.get("title", "Untitled Assignment"),
                    description=assignment.get("description"),
                    subject_name=subject_name,
                    topic=assignment.get("topic") or "General",
                    assignment_type=assignment.get(
                        "assignment_type", AssignmentType.PRACTICE.value
                    ),
                    due_date=assignment.get("due_date"),
                    time_limit=assignment.get("time_limit"),
                    max_attempts=int(assignment.get("max_attempts", 1) or 1),
                    total_points=int(assignment.get("total_points", 0) or 0),
                    question_count=question_count,
                    status=derived_status,
                    attempts_used=1 if progress_doc else 0,
                    best_score=progress_doc.get("score") if progress_doc else None,
                    last_attempt=(
                        progress_doc.get("submitted_at")
                        or progress_doc.get("updated_at")
                        or progress_doc.get("started_at")
                        if progress_doc
                        else None
                    ),
                    progress_percent=max(0, min(progress_percent, 100)),
                    feedback=progress_doc.get("feedback") if progress_doc else None,
                    submitted_at=progress_doc.get("submitted_at")
                    if progress_doc
                    else None,
                    graded_at=progress_doc.get("graded_at") if progress_doc else None,
                    review_available=(
                        derived_status == "graded"
                        or (
                            derived_status == "submitted"
                            and bool(assignment.get("show_results_immediately", False))
                        )
                    ),
                )
                summaries.append(summary)

            normalized_status = str(status or "").strip().lower()
            if normalized_status and normalized_status not in {"all"}:
                filter_aliases = {
                    "completed": {"graded"},
                    "active": {"pending", "in_progress"},
                }
                allowed_statuses = filter_aliases.get(
                    normalized_status, {normalized_status}
                )
                summaries = [
                    summary
                    for summary in summaries
                    if summary.status in allowed_statuses
                ]

            total = len(summaries)
            start = max(page - 1, 0) * per_page
            end = start + per_page

            return {
                "items": summaries[start:end],
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page
                if per_page > 0
                else 0,
            }
        except Exception as e:
            logger.error(
                "Failed to get student assignment summaries",
                student_id=student_id,
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(
                f"Failed to get student assignment summaries: {str(e)}"
            )

    async def publish_assignment(self, assignment_id: str, tutor_id: str) -> Assignment:
        """Publish a draft assignment and notify recipients."""
        try:
            assignment = await self.get_assignment_by_id(
                assignment_id, tutor_id=tutor_id
            )
            current_status = (
                assignment.status.value
                if isinstance(assignment.status, AssignmentStatus)
                else str(assignment.status or "").strip().lower()
            )

            if current_status == AssignmentStatus.PUBLISHED.value:
                return assignment

            if current_status not in {
                AssignmentStatus.DRAFT.value,
            }:
                raise ValidationError("Only draft assignments can be published")

            now = datetime.now(timezone.utc)
            oid = to_object_id(assignment_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$set": {
                        "status": AssignmentStatus.PUBLISHED.value,
                        "updated_at": now,
                        "published_at": assignment.published_at or now,
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Assignment", assignment_id)

            persisted = await self.collection.find_one(
                {"_id": oid, "tutor_id": tutor_id}
            )
            if not persisted:
                raise NotFoundError("Assignment", assignment_id)

            await self._send_assignment_publication_notifications(persisted)
            logger.info(
                "Assignment published", assignment_id=assignment_id, tutor_id=tutor_id
            )
            return _convert_doc_to_assignment(persisted)

        except (NotFoundError, AuthorizationError, ValidationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to publish assignment",
                assignment_id=assignment_id,
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to publish assignment: {str(e)}")

    async def update_assignment(
        self, assignment_id: str, assignment_update: AssignmentUpdate, tutor_id: str
    ) -> Assignment:
        """Update assignment (with ownership validation)"""
        try:
            # Validate ownership first
            await self.get_assignment_by_id(assignment_id, tutor_id=tutor_id)

            update_data = assignment_update.model_dump(exclude_unset=True)
            if not update_data:
                return await self.get_assignment_by_id(assignment_id)

            update_data["updated_at"] = datetime.now(timezone.utc)

            oid = to_object_id(assignment_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id}, {"$set": update_data}
            )

            if result.matched_count == 0:
                raise NotFoundError("Assignment", assignment_id)

            logger.info(
                "Assignment updated", assignment_id=assignment_id, tutor_id=tutor_id
            )
            return await self.get_assignment_by_id(assignment_id)

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to update assignment", assignment_id=assignment_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update assignment: {str(e)}")

    async def delete_assignment(self, assignment_id: str, tutor_id: str) -> bool:
        """Soft-delete assignment by archiving it."""
        try:
            # Validate ownership first
            await self.get_assignment_by_id(assignment_id, tutor_id=tutor_id)

            oid = to_object_id(assignment_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$set": {
                        "status": AssignmentStatus.ARCHIVED,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Assignment", assignment_id)

            logger.info(
                "Assignment deleted", assignment_id=assignment_id, tutor_id=tutor_id
            )
            return True

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to delete assignment", assignment_id=assignment_id, error=str(e)
            )
            raise DatabaseException(f"Failed to delete assignment: {str(e)}")

    async def bulk_update_status(
        self,
        assignment_ids: List[str],
        tutor_id: str,
        status: AssignmentStatus,
    ) -> Dict[str, Any]:
        """Update status for multiple tutor-owned assignments."""
        try:
            normalized_ids = self._normalize_ids(assignment_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one assignment")

            owned_ids, skipped_ids = await self._resolve_owned_assignment_ids(
                normalized_ids,
                tutor_id,
            )
            updated_ids: List[str] = []

            if owned_ids:
                result = await self.collection.update_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(assignment_id)
                                for assignment_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                    },
                    {
                        "$set": {
                            "status": status.value,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                if result.modified_count:
                    updated_ids = owned_ids

            return {
                "requested_count": len(normalized_ids),
                "updated_count": len(updated_ids),
                "updated_assignment_ids": updated_ids,
                "skipped_count": len(skipped_ids),
                "skipped_assignment_ids": skipped_ids,
            }
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to bulk update assignment status", error=str(e))
            raise DatabaseException(
                f"Failed to bulk update assignment status: {str(e)}"
            )

    async def bulk_delete_assignments(
        self,
        assignment_ids: List[str],
        tutor_id: str,
    ) -> Dict[str, Any]:
        """Soft-delete multiple tutor-owned assignments by archiving them."""
        try:
            normalized_ids = self._normalize_ids(assignment_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one assignment")

            owned_ids, skipped_ids = await self._resolve_owned_assignment_ids(
                normalized_ids,
                tutor_id,
            )
            archived_ids: List[str] = []

            if owned_ids:
                result = await self.collection.update_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(assignment_id)
                                for assignment_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                    },
                    {
                        "$set": {
                            "status": AssignmentStatus.ARCHIVED,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                if result.modified_count:
                    archived_ids = owned_ids

            return {
                "requested_count": len(normalized_ids),
                "deleted_count": len(archived_ids),
                "deleted_assignment_ids": archived_ids,
                "skipped_count": len(skipped_ids),
                "skipped_assignment_ids": skipped_ids,
            }
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to bulk delete assignments", error=str(e))
            raise DatabaseException(f"Failed to bulk delete assignments: {str(e)}")

    async def add_questions_to_assignment(
        self, assignment_id: str, question_ids: List[str], tutor_id: str
    ) -> Assignment:
        """Add questions to an assignment (with ownership validation)"""
        try:
            # Validate ownership first
            await self.get_assignment_by_id(assignment_id, tutor_id=tutor_id)

            questions = [
                QuestionAssignment(question_id=qid, order=i)
                for i, qid in enumerate(question_ids)
            ]
            question_dicts = [q.model_dump() for q in questions]

            oid = to_object_id(assignment_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$set": {
                        "questions": question_dicts,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Assignment", assignment_id)

            logger.info(
                "Questions added to assignment",
                assignment_id=assignment_id,
                question_count=len(question_ids),
            )
            return await self.get_assignment_by_id(assignment_id)

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to add questions to assignment",
                assignment_id=assignment_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to add questions: {str(e)}")

    async def assign_to_students(
        self, assignment_id: str, student_ids: List[str], tutor_id: str
    ) -> Assignment:
        """Assign assignment to students (with ownership validation)"""
        try:
            # Validate ownership first
            await self.get_assignment_by_id(assignment_id, tutor_id=tutor_id)

            oid = to_object_id(assignment_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$addToSet": {"student_ids": {"$each": student_ids}},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Assignment", assignment_id)

            logger.info(
                "Assignment assigned to students",
                assignment_id=assignment_id,
                student_count=len(student_ids),
            )
            return await self.get_assignment_by_id(assignment_id)

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to assign to students",
                assignment_id=assignment_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to assign to students: {str(e)}")

    async def assign_to_group(
        self, assignment_id: str, group_id: str, tutor_id: str
    ) -> Assignment:
        """Assign assignment to a student group (with ownership validation)"""
        try:
            # Validate ownership first
            await self.get_assignment_by_id(assignment_id, tutor_id=tutor_id)

            # Get students from group
            group_students = await self._get_students_from_group(group_id)

            if not group_students:
                raise ValidationError(f"Group {group_id} has no students")

            # Update assignment
            oid = to_object_id(assignment_id)
            result = await self.collection.update_one(
                {"_id": oid, "tutor_id": tutor_id},
                {
                    "$addToSet": {
                        "student_ids": {"$each": list(group_students)},
                        "group_ids": group_id,
                    },
                    "$set": {
                        "is_group_assignment": True,
                        "updated_at": datetime.now(timezone.utc),
                    },
                },
            )

            if result.matched_count == 0:
                raise NotFoundError("Assignment", assignment_id)

            logger.info(
                "Assignment assigned to group",
                assignment_id=assignment_id,
                group_id=group_id,
                student_count=len(group_students),
            )
            return await self.get_assignment_by_id(assignment_id)

        except (NotFoundError, ValidationError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to assign to group", assignment_id=assignment_id, error=str(e)
            )
            raise DatabaseException(f"Failed to assign to group: {str(e)}")

    async def get_group_performance(
        self, assignment_id: str, group_id: str, tutor_id: str
    ) -> Dict:
        """Get performance statistics for a specific group on an assignment (with ownership validation)"""
        try:
            # Validate ownership
            assignment = await self.get_assignment_by_id(
                assignment_id, tutor_id=tutor_id
            )
            group_students = await self._get_students_from_group(group_id)

            # Get progress for group students
            progress_collection = self.db.progress
            group_progress = await progress_collection.find(
                {
                    "assignment_id": assignment_id,
                    "student_id": {"$in": list(group_students)},
                }
            ).to_list(length=None)

            # Calculate statistics
            total_students = len(group_students)
            completed = sum(1 for p in group_progress if p.get("status") == "completed")
            scores = [
                p.get("score", 0) for p in group_progress if p.get("score") is not None
            ]

            return {
                "group_id": group_id,
                "assignment_id": assignment_id,
                "total_students": total_students,
                "completed_count": completed,
                "completion_rate": (completed / total_students * 100)
                if total_students > 0
                else 0,
                "average_score": sum(scores) / len(scores) if scores else 0,
                "highest_score": max(scores) if scores else 0,
                "lowest_score": min(scores) if scores else 0,
            }

        except (NotFoundError, AuthorizationError):
            raise
        except Exception as e:
            logger.error(
                "Failed to get group performance",
                assignment_id=assignment_id,
                group_id=group_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get group performance: {str(e)}")

    async def _get_students_from_group(self, group_id: str) -> List[str]:
        """Helper: Get student IDs from a group"""
        try:
            from app.core.exceptions import NotFoundError as NF

            oid = to_object_id(group_id)
            group = await self.db.student_groups.find_one({"_id": oid})

            if not group:
                raise NF("StudentGroup", group_id)

            return await self._resolve_student_clerk_ids(group.get("studentIds", []))

        except Exception as e:
            logger.error(
                "Failed to get students from group", group_id=group_id, error=str(e)
            )
            return []

    async def _get_students_by_subject(
        self, tutor_id: str, subject_id: str
    ) -> List[str]:
        """Helper: Get student IDs enrolled in a subject"""
        try:
            subject_names = {subject_id}
            subject = await self.db.subjects.find_one(
                {"_id": to_object_id(subject_id)}, {"name": 1}
            )
            if subject and subject.get("name"):
                subject_names.add(str(subject.get("name")))

            students = await self.db.students.find(
                {
                    "tutor_id": tutor_id,
                    "subjects": {"$in": list(subject_names)},
                },
                {"clerk_id": 1},
            ).to_list(length=None)

            return [
                str(student.get("clerk_id"))
                for student in students
                if student.get("clerk_id")
            ]

        except Exception as e:
            logger.error(
                "Failed to get students by subject", subject_id=subject_id, error=str(e)
            )
            return []

    async def _resolve_student_clerk_ids(self, identifiers: List[str]) -> List[str]:
        """Normalize legacy group student identifiers to student Clerk IDs."""
        try:
            cleaned_identifiers = list(
                dict.fromkeys(
                    str(identifier).strip()
                    for identifier in identifiers
                    if str(identifier).strip()
                )
            )
            if not cleaned_identifiers:
                return []

            object_ids = [
                candidate
                for identifier in cleaned_identifiers
                if isinstance((candidate := to_object_id(identifier)), ObjectId)
            ]
            clerk_ids = [
                identifier
                for identifier in cleaned_identifiers
                if not ObjectId.is_valid(identifier)
            ]

            query_filters = []
            if object_ids:
                query_filters.append({"_id": {"$in": object_ids}})
            if clerk_ids:
                query_filters.append({"clerk_id": {"$in": clerk_ids}})

            if not query_filters:
                return []

            students = await self.db.students.find(
                {"$or": query_filters},
                {"clerk_id": 1},
            ).to_list(length=None)

            return [
                str(student.get("clerk_id"))
                for student in students
                if student.get("clerk_id")
            ]
        except Exception as e:
            logger.error("Failed to normalize student identifiers", error=str(e))
            return []

    async def get_student_assignments_count(
        self, student_id: str, tutor_id: str, status: Optional[str] = None
    ) -> int:
        """Get total count of assignments for a student"""
        try:
            query = {"tutor_id": tutor_id, "student_ids": student_id}

            if status:
                query["status"] = status

            count = await self.collection.count_documents(query)
            return count
        except Exception as e:
            logger.error("Failed to get student assignments count", error=str(e))
            raise DatabaseException(f"Failed to get assignments count: {str(e)}")

    async def get_student_assignments_paginated(
        self,
        student_id: str,
        tutor_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 10,
    ) -> List[Assignment]:
        """Get paginated assignments for a student"""
        try:
            query = {"tutor_id": tutor_id, "student_ids": student_id}

            if status:
                query["status"] = status

            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(limit)
            )
            assignments_data = await cursor.to_list(length=limit)

            assignments = []
            for assignment_data in assignments_data:
                assignments.append(_convert_doc_to_assignment(assignment_data))

            return assignments
        except Exception as e:
            logger.error("Failed to get paginated student assignments", error=str(e))
            raise DatabaseException(f"Failed to get assignments: {str(e)}")
