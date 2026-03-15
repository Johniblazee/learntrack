"""
Progress tracking service for database operations
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog
from app.core.config import settings

from app.models.progress import (
    Progress,
    ProgressCreate,
    ProgressUpdate,
    ProgressInDB,
    StudentProgress,
    ProgressAnalytics,
    ParentProgressView,
    SubmissionStatus,
    QuestionAnswer,
    AnswerType,
    StudentPerformanceData,
    StudentPerformanceInDB,
    WeeklyProgressData,
    ProgressReportsResponse,
)
from app.core.exceptions import NotFoundError, DatabaseException
from app.core.utils import to_object_id

logger = structlog.get_logger()

COMPLETED_PROGRESS_STATUS_VALUES = {
    SubmissionStatus.SUBMITTED.value,
    SubmissionStatus.GRADED.value,
    "completed",
}


def _normalize_submission_status(status_value: Optional[str]) -> SubmissionStatus:
    """Normalize legacy/raw status values to SubmissionStatus enum."""
    normalized = (status_value or "").strip().lower()
    if normalized in {SubmissionStatus.GRADED.value, "reviewed"}:
        return SubmissionStatus.GRADED
    if normalized in {SubmissionStatus.SUBMITTED.value, "completed"}:
        return SubmissionStatus.SUBMITTED
    return SubmissionStatus.IN_PROGRESS


def _ensure_utc_datetime(value: Any, fallback: Optional[datetime] = None) -> datetime:
    """Ensure datetime values are timezone-aware (UTC)."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    return fallback or datetime.now(timezone.utc)


def _is_completed_status(status_value: Optional[str]) -> bool:
    return (status_value or "").strip().lower() in COMPLETED_PROGRESS_STATUS_VALUES


def _week_label(index: int, total: int) -> str:
    return f"Week {total - index}"


def _build_weekly_progress_rows(
    progress_records: List[Dict[str, Any]],
    *,
    weeks: int = 4,
    date_field: str = "created_at",
) -> List[WeeklyProgressData]:
    now = datetime.now(timezone.utc)
    rows: List[WeeklyProgressData] = []

    for week_index in range(weeks, 0, -1):
        week_start = now - timedelta(weeks=week_index)
        week_end = now - timedelta(weeks=week_index - 1)

        week_records = []
        for record in progress_records:
            raw_date = record.get(date_field)
            if raw_date is None:
                continue
            normalized_date = _ensure_utc_datetime(raw_date)
            if week_start <= normalized_date < week_end:
                week_records.append(record)
        completed_count = sum(
            1 for record in week_records if _is_completed_status(record.get("status"))
        )

        rows.append(
            WeeklyProgressData(
                week=_week_label(week_index, weeks + 1),
                completed=completed_count,
                assigned=len(week_records),
            )
        )

    return rows


def _build_subject_performance_rows(
    progress_records: List[Dict[str, Any]],
    subject_by_assignment_id: Dict[str, str],
) -> List[Dict[str, Any]]:
    subject_data: Dict[str, Dict[str, Any]] = {}

    for progress in progress_records:
        assignment_id = str(progress.get("assignment_id") or "")
        subject_name = subject_by_assignment_id.get(assignment_id, "General")
        bucket = subject_data.setdefault(
            subject_name,
            {"scores": [], "assignments": 0, "completed": 0},
        )
        bucket["assignments"] += 1
        if _is_completed_status(progress.get("status")):
            bucket["completed"] += 1

        score = progress.get("score")
        if score is not None:
            try:
                bucket["scores"].append(float(score))
            except (TypeError, ValueError):
                continue

    subject_rows = []
    for subject_name, bucket in subject_data.items():
        scores = bucket["scores"]
        subject_rows.append(
            {
                "subject": subject_name,
                "score": round(sum(scores) / len(scores), 1) if scores else 0,
                "assignments": bucket["assignments"],
                "completed": bucket["completed"],
            }
        )

    subject_rows.sort(key=lambda row: row["subject"].lower())
    return subject_rows


def _build_student_performance_rows(
    progress_records: List[Dict[str, Any]],
    *,
    student_names: Dict[str, str],
    subject_by_assignment_id: Dict[str, str],
) -> List[StudentPerformanceData]:
    score_buckets: Dict[str, Dict[str, List[float]]] = {}
    completion_counts: Dict[str, int] = {}

    for progress in progress_records:
        student_id = str(progress.get("student_id") or "")
        if not student_id:
            continue

        assignment_id = str(progress.get("assignment_id") or "")
        subject_name = subject_by_assignment_id.get(assignment_id, "General")
        student_scores = score_buckets.setdefault(student_id, {})
        student_scores.setdefault(subject_name, [])

        score = progress.get("score")
        if score is not None:
            try:
                student_scores[subject_name].append(float(score))
            except (TypeError, ValueError):
                pass

        if _is_completed_status(progress.get("status")):
            completion_counts[student_id] = completion_counts.get(student_id, 0) + 1

    rows: List[StudentPerformanceData] = []
    for student_id, subject_scores in score_buckets.items():
        averaged_subject_scores = {
            subject_name: int(round(sum(scores) / len(scores)))
            for subject_name, scores in subject_scores.items()
            if scores
        }
        all_scores = list(averaged_subject_scores.values())
        rows.append(
            StudentPerformanceData(
                name=student_names.get(student_id, "Student"),
                overall=int(round(sum(all_scores) / len(all_scores)))
                if all_scores
                else 0,
                completed_assignments=completion_counts.get(student_id, 0),
                subject_scores=averaged_subject_scores,
            )
        )

    rows.sort(key=lambda row: row.name.lower())
    return rows


class ProgressService:
    """Progress service for database operations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.progress
        self.performance_collection = database.student_performance

    async def create_progress(self, progress_data: ProgressCreate) -> Progress:
        """Create a new progress record"""
        try:
            # Check if progress already exists for this student/assignment
            existing = await self.collection.find_one(
                {
                    "student_id": progress_data.student_id,
                    "assignment_id": progress_data.assignment_id,
                }
            )

            if existing:
                return Progress(**existing)

            # Create new progress record
            progress_dict = progress_data.model_dump()
            progress_dict["created_at"] = datetime.now(timezone.utc)
            progress_dict["updated_at"] = datetime.now(timezone.utc)
            progress_dict["started_at"] = datetime.now(timezone.utc)
            progress_dict["status"] = SubmissionStatus.IN_PROGRESS
            progress_dict["answers"] = []
            progress_dict["points_earned"] = 0.0
            progress_dict["points_possible"] = 0.0

            result = await self.collection.insert_one(progress_dict)
            progress_dict["_id"] = result.inserted_id

            logger.info("Progress created", progress_id=str(result.inserted_id))
            return Progress(**progress_dict)

        except Exception as e:
            logger.error("Failed to create progress", error=str(e))
            raise DatabaseException(f"Failed to create progress: {str(e)}")

    async def get_progress_by_id(self, progress_id: str) -> Progress:
        """Get progress by ID"""
        try:
            oid = to_object_id(progress_id)
            progress = await self.collection.find_one({"_id": oid})
            if not progress:
                raise NotFoundError("Progress", progress_id)
            return Progress(**progress)
        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get progress", progress_id=progress_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get progress: {str(e)}")

    async def get_student_assignment_progress(
        self, student_id: str, assignment_id: str
    ) -> Optional[Progress]:
        """Get student's progress on a specific assignment"""
        try:
            progress = await self.collection.find_one(
                {"student_id": student_id, "assignment_id": assignment_id}
            )
            return Progress(**progress) if progress else None
        except Exception as e:
            logger.error(
                "Failed to get student assignment progress",
                student_id=student_id,
                assignment_id=assignment_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get progress: {str(e)}")

    async def update_progress(
        self, progress_id: str, progress_update: ProgressUpdate
    ) -> Progress:
        """Update progress"""
        try:
            update_data = progress_update.model_dump(exclude_unset=True)
            if not update_data:
                return await self.get_progress_by_id(progress_id)

            update_data["updated_at"] = datetime.now(timezone.utc)

            oid = to_object_id(progress_id)
            result = await self.collection.update_one(
                {"_id": oid}, {"$set": update_data}
            )

            if result.matched_count == 0:
                raise NotFoundError("Progress", progress_id)

            logger.info("Progress updated", progress_id=progress_id)
            return await self.get_progress_by_id(progress_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to update progress", progress_id=progress_id, error=str(e)
            )
            raise DatabaseException(f"Failed to update progress: {str(e)}")

    async def get_assignment_progress(
        self, assignment_id: str, tutor_id: Optional[str] = None
    ) -> List[StudentProgress]:
        """Get progress for all students in an assignment."""
        try:
            assignment_oid = to_object_id(assignment_id)
            assignment_query: Dict[str, Any] = {"_id": assignment_oid}
            if tutor_id:
                assignment_query["tutor_id"] = tutor_id

            assignment = await self.db.assignments.find_one(assignment_query)
            if not assignment:
                raise NotFoundError("Assignment", assignment_id)

            progress_query: Dict[str, Any] = {"assignment_id": assignment_id}
            if tutor_id:
                progress_query["tutor_id"] = tutor_id

            progress_docs = await self.collection.find(progress_query).to_list(
                length=1000
            )
            progress_by_student: Dict[str, Dict[str, Any]] = {
                doc.get("student_id"): doc
                for doc in progress_docs
                if doc.get("student_id")
            }

            assignment_student_ids = assignment.get("student_ids", []) or []
            all_student_ids = list(
                dict.fromkeys(
                    [*assignment_student_ids, *list(progress_by_student.keys())]
                )
            )

            students = []
            if all_student_ids:
                students = await self.db.students.find(
                    {"clerk_id": {"$in": all_student_ids}}
                ).to_list(length=len(all_student_ids))
            students_by_id = {
                student.get("clerk_id"): student for student in students if student
            }

            subject_name = "Unknown"
            subject_id_raw = assignment.get("subject_id")
            subject_query: Dict[str, Any] = {}
            if isinstance(subject_id_raw, ObjectId):
                subject_query = {"_id": subject_id_raw}
            elif isinstance(subject_id_raw, str):
                try:
                    subject_query = {"_id": to_object_id(subject_id_raw)}
                except Exception:
                    subject_query = {"id": subject_id_raw}

            if subject_query:
                subject_doc = await self.db.subjects.find_one(subject_query)
                if subject_doc:
                    subject_name = subject_doc.get("name", "Unknown")

            assignment_title = assignment.get("title", "Assignment")
            topic = assignment.get("topic") or "General"
            max_attempts = int(assignment.get("max_attempts", 1) or 1)
            now = datetime.now(timezone.utc)
            due_date_raw = assignment.get("due_date")
            due_date = _ensure_utc_datetime(due_date_raw, now) if due_date_raw else now

            progress_list: List[StudentProgress] = []
            for student_id in all_student_ids:
                progress_doc = progress_by_student.get(student_id)
                normalized_status = _normalize_submission_status(
                    progress_doc.get("status") if progress_doc else None
                )

                started_at = (
                    _ensure_utc_datetime(progress_doc.get("started_at"), now)
                    if progress_doc and progress_doc.get("started_at")
                    else None
                )
                submitted_at = (
                    _ensure_utc_datetime(progress_doc.get("submitted_at"), now)
                    if progress_doc and progress_doc.get("submitted_at")
                    else None
                )

                attempts_used = (
                    int(progress_doc.get("attempt_number", 1)) if progress_doc else 0
                )

                is_overdue = (
                    bool(due_date_raw)
                    and due_date < now
                    and normalized_status == SubmissionStatus.IN_PROGRESS
                )

                student_doc = students_by_id.get(student_id, {})

                progress_list.append(
                    StudentProgress(
                        student_id=student_id,
                        student_name=student_doc.get("name", "Unknown Student"),
                        assignment_id=assignment_id,
                        assignment_title=assignment_title,
                        subject_name=subject_name,
                        topic=topic,
                        status=normalized_status,
                        score=progress_doc.get("score") if progress_doc else None,
                        attempts_used=attempts_used,
                        max_attempts=max_attempts,
                        started_at=started_at,
                        submitted_at=submitted_at,
                        due_date=due_date,
                        is_overdue=is_overdue,
                    )
                )

            progress_list.sort(key=lambda item: item.student_name.lower())
            return progress_list

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get assignment progress",
                assignment_id=assignment_id,
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get assignment progress: {str(e)}")

    async def get_student_analytics(self, student_id: str) -> ProgressAnalytics:
        """Get progress analytics for a student using optimized aggregation queries"""
        try:
            # Use aggregation pipeline with $lookup to get all data in fewer queries
            # This eliminates N+1 query problem by joining progress with assignments and subjects
            pipeline = [
                {"$match": {"student_id": student_id}},
                # Convert assignment_id string to ObjectId for lookup (use $convert with onError)
                {
                    "$addFields": {
                        "assignment_oid": {
                            "$convert": {
                                "input": "$assignment_id",
                                "to": "objectId",
                                "onError": None,
                            }
                        }
                    }
                },
                # Lookup assignment details
                {
                    "$lookup": {
                        "from": "assignments",
                        "localField": "assignment_oid",
                        "foreignField": "_id",
                        "as": "assignment_info",
                    }
                },
                {
                    "$unwind": {
                        "path": "$assignment_info",
                        "preserveNullAndEmptyArrays": True,
                    }
                },
                # Lookup subject details
                {
                    "$lookup": {
                        "from": "subjects",
                        "localField": "assignment_info.subject_id",
                        "foreignField": "_id",
                        "as": "subject_info",
                    }
                },
                {
                    "$unwind": {
                        "path": "$subject_info",
                        "preserveNullAndEmptyArrays": True,
                    }
                },
                # Project needed fields
                {
                    "$project": {
                        "student_id": 1,
                        "assignment_id": 1,
                        "status": 1,
                        "score": 1,
                        "time_spent": 1,
                        "created_at": 1,
                        "submitted_at": 1,
                        "updated_at": 1,
                        "assignment_title": "$assignment_info.title",
                        "subject_name": {"$ifNull": ["$subject_info.name", "Unknown"]},
                    }
                },
            ]

            # Execute aggregation (single query replaces N+1 queries)
            # Allow a configurable maximum and detect truncation by requesting one extra
            max_limit = getattr(settings, "PROGRESS_AGG_LIMIT", 500)
            progress_records = await self.collection.aggregate(pipeline).to_list(
                length=max_limit + 1
            )

            # Detect truncation
            was_truncated = len(progress_records) > max_limit
            if was_truncated:
                logger.warning(
                    "Progress aggregation results truncated",
                    requested_limit=max_limit,
                    returned=max_limit + 1,
                )
                progress_records = progress_records[:max_limit]

            # Calculate basic analytics from fetched records
            total_assignments = len(progress_records)
            subject_by_assignment_id = {
                str(progress.get("assignment_id") or ""): progress.get(
                    "subject_name", "Unknown"
                )
                for progress in progress_records
                if progress.get("assignment_id")
            }
            completed_assignments = len(
                [p for p in progress_records if _is_completed_status(p.get("status"))]
            )
            pending_assignments = total_assignments - completed_assignments

            # Calculate average score
            scores = [
                p.get("score", 0)
                for p in progress_records
                if p.get("score") is not None
            ]
            average_score = round(sum(scores) / len(scores), 1) if scores else None

            # Calculate total time spent
            total_time = sum(p.get("time_spent", 0) or 0 for p in progress_records)

            subject_performance = _build_subject_performance_rows(
                progress_records,
                subject_by_assignment_id,
            )

            # Helper function to ensure datetime is timezone-aware for comparison
            def ensure_tz_aware(dt) -> Optional[datetime]:
                if dt is None:
                    return None
                if not isinstance(dt, datetime):
                    return None
                if dt.tzinfo is None:
                    return dt.replace(tzinfo=timezone.utc)
                return dt

            # Use timezone-aware datetime.min to avoid comparison errors with database datetimes
            min_datetime = datetime.min.replace(tzinfo=timezone.utc)

            # Get recent submissions (last 5 completed) - data already fetched
            completed_records = [
                p for p in progress_records if _is_completed_status(p.get("status"))
            ]
            completed_records.sort(
                key=lambda x: ensure_tz_aware(x.get("submitted_at"))
                or ensure_tz_aware(x.get("updated_at"))
                or min_datetime,
                reverse=True,
            )

            recent_submissions = []
            for progress in completed_records[:5]:
                recent_submissions.append(
                    {
                        "assignment_title": progress.get(
                            "assignment_title", "Assignment"
                        ),
                        "subject": progress.get("subject_name", "Unknown"),
                        "score": progress.get("score", 0),
                        "submitted_at": progress.get("submitted_at"),
                    }
                )

            weekly_progress = [
                row.model_dump()
                for row in _build_weekly_progress_rows(
                    progress_records,
                    weeks=4,
                    date_field="created_at",
                )
            ]

            analytics = ProgressAnalytics(
                total_assignments=total_assignments,
                completed_assignments=completed_assignments,
                pending_assignments=pending_assignments,
                overdue_assignments=0,
                average_score=average_score,
                total_time_spent=total_time // 60,  # Convert to minutes
                subject_performance=subject_performance,
                recent_submissions=recent_submissions,
                weekly_progress=weekly_progress,
            )

            return analytics

        except Exception as e:
            logger.error(
                "Failed to get student analytics", student_id=student_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get student analytics: {str(e)}")

    async def get_parent_progress_view(
        self, parent_id: str
    ) -> List[ParentProgressView]:
        """Get progress view for parent's children"""
        try:
            parent = await self.db.parents.find_one({"clerk_id": parent_id})
            if not parent:
                return []

            child_ids = parent.get("parent_children") or parent.get("student_ids") or []
            if not child_ids:
                return []

            students = await self.db.students.find(
                {"clerk_id": {"$in": child_ids}}
            ).to_list(length=len(child_ids))
            students_by_id = {
                student.get("clerk_id"): student for student in students if student
            }

            now = datetime.now(timezone.utc)
            completed_statuses = {
                SubmissionStatus.SUBMITTED,
                SubmissionStatus.GRADED,
            }

            parent_views: List[ParentProgressView] = []

            for child_id in child_ids:
                child = students_by_id.get(child_id)
                if not child:
                    continue

                analytics = await self.get_student_analytics(child_id)

                # Fetch recent progress attempts for this child
                progress_docs = (
                    await self.collection.find({"student_id": child_id})
                    .sort("updated_at", -1)
                    .limit(20)
                    .to_list(length=20)
                )

                assignment_ids = list(
                    {
                        str(doc.get("assignment_id"))
                        for doc in progress_docs
                        if doc.get("assignment_id")
                    }
                )

                assignment_object_ids = []
                for assignment_id in assignment_ids:
                    try:
                        assignment_object_ids.append(to_object_id(assignment_id))
                    except Exception:
                        continue

                assignments = []
                if assignment_object_ids:
                    assignments = await self.db.assignments.find(
                        {"_id": {"$in": assignment_object_ids}}
                    ).to_list(length=len(assignment_object_ids))
                assignments_by_id = {
                    str(assignment.get("_id")): assignment
                    for assignment in assignments
                    if assignment.get("_id")
                }

                subject_object_ids: List[ObjectId] = []
                for assignment in assignments:
                    subject_raw = assignment.get("subject_id")
                    if isinstance(subject_raw, ObjectId):
                        subject_object_ids.append(subject_raw)
                    elif isinstance(subject_raw, str):
                        try:
                            converted_subject_id = to_object_id(subject_raw)
                            if isinstance(converted_subject_id, ObjectId):
                                subject_object_ids.append(converted_subject_id)
                        except Exception:
                            continue

                subjects = []
                if subject_object_ids:
                    subjects = await self.db.subjects.find(
                        {"_id": {"$in": list(set(subject_object_ids))}}
                    ).to_list(length=len(subject_object_ids))
                subject_map = {
                    str(subject.get("_id")): subject.get("name", "Unknown")
                    for subject in subjects
                    if subject.get("_id")
                }

                recent_assignments: List[StudentProgress] = []
                for progress_doc in progress_docs:
                    assignment_id = str(progress_doc.get("assignment_id", ""))
                    assignment = assignments_by_id.get(assignment_id)
                    if not assignment:
                        continue

                    normalized_status = _normalize_submission_status(
                        progress_doc.get("status")
                    )
                    subject_key = str(assignment.get("subject_id", ""))
                    due_date_raw = assignment.get("due_date")
                    due_date = (
                        _ensure_utc_datetime(due_date_raw, now) if due_date_raw else now
                    )

                    recent_assignments.append(
                        StudentProgress(
                            student_id=child_id,
                            student_name=child.get("name", "Unknown Student"),
                            assignment_id=assignment_id,
                            assignment_title=assignment.get("title", "Assignment"),
                            subject_name=subject_map.get(subject_key, "Unknown"),
                            topic=assignment.get("topic") or "General",
                            status=normalized_status,
                            score=progress_doc.get("score"),
                            attempts_used=int(progress_doc.get("attempt_number", 1)),
                            max_attempts=int(assignment.get("max_attempts", 1) or 1),
                            started_at=progress_doc.get("started_at"),
                            submitted_at=progress_doc.get("submitted_at"),
                            due_date=due_date,
                            is_overdue=bool(due_date_raw)
                            and due_date < now
                            and normalized_status == SubmissionStatus.IN_PROGRESS,
                        )
                    )

                recent_assignments = recent_assignments[:5]

                # Fetch upcoming assignments for this child
                upcoming_assignment_docs = (
                    await self.db.assignments.find(
                        {
                            "student_ids": child_id,
                            "due_date": {"$ne": None, "$gte": now},
                            "status": {"$nin": ["archived", "completed"]},
                        }
                    )
                    .sort("due_date", 1)
                    .limit(10)
                    .to_list(length=10)
                )

                upcoming_assignment_ids = [
                    str(assignment.get("_id"))
                    for assignment in upcoming_assignment_docs
                    if assignment.get("_id")
                ]
                upcoming_progress_docs = []
                if upcoming_assignment_ids:
                    upcoming_progress_docs = await self.collection.find(
                        {
                            "student_id": child_id,
                            "assignment_id": {"$in": upcoming_assignment_ids},
                        }
                    ).to_list(length=len(upcoming_assignment_ids))

                upcoming_progress_map = {
                    doc.get("assignment_id"): doc
                    for doc in upcoming_progress_docs
                    if doc.get("assignment_id")
                }

                upcoming_assignments: List[Dict[str, Any]] = []
                for upcoming in upcoming_assignment_docs:
                    upcoming_assignment_id = str(upcoming.get("_id"))
                    progress_doc = upcoming_progress_map.get(upcoming_assignment_id)
                    progress_status = _normalize_submission_status(
                        progress_doc.get("status") if progress_doc else None
                    )

                    # Do not show completed/submitted work in upcoming list
                    if progress_status in completed_statuses:
                        continue

                    due_date = _ensure_utc_datetime(upcoming.get("due_date"), now)
                    upcoming_subject_key = str(upcoming.get("subject_id", ""))

                    upcoming_assignments.append(
                        {
                            "title": upcoming.get("title", "Untitled Assignment"),
                            "due_date": due_date.isoformat(),
                            "subject": subject_map.get(upcoming_subject_key, "Unknown"),
                        }
                    )

                parent_views.append(
                    ParentProgressView(
                        child_id=child_id,
                        child_name=child.get("name", "Unknown Student"),
                        analytics=analytics,
                        recent_assignments=recent_assignments,
                        upcoming_assignments=upcoming_assignments,
                    )
                )

            return parent_views

        except Exception as e:
            logger.error(
                "Failed to get parent progress view", parent_id=parent_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get parent progress view: {str(e)}")

    async def get_progress_reports(self, tutor_id: str) -> ProgressReportsResponse:
        """Get dynamic progress report data for a tutor."""
        try:
            students = await self.db.students.find(
                {"tutor_id": tutor_id, "is_active": True},
                {"clerk_id": 1, "name": 1},
            ).to_list(length=500)

            student_ids = [
                str(student.get("clerk_id"))
                for student in students
                if student.get("clerk_id")
            ]
            student_names = {
                str(student.get("clerk_id")): str(student.get("name") or "Student")
                for student in students
                if student.get("clerk_id")
            }

            assignments = await self.db.assignments.find(
                {"tutor_id": tutor_id},
                {"_id": 1, "subject_id": 1},
            ).to_list(length=5000)

            subject_object_ids: List[ObjectId] = []
            assignment_subject_lookup: Dict[str, str] = {}
            for assignment in assignments:
                assignment_id = str(assignment.get("_id") or "")
                subject_raw = assignment.get("subject_id")
                if isinstance(subject_raw, ObjectId):
                    subject_object_ids.append(subject_raw)
                    assignment_subject_lookup[assignment_id] = str(subject_raw)
                elif isinstance(subject_raw, str):
                    try:
                        converted_subject_id = to_object_id(subject_raw)
                        if isinstance(converted_subject_id, ObjectId):
                            subject_object_ids.append(converted_subject_id)
                        assignment_subject_lookup[assignment_id] = subject_raw
                    except Exception:
                        assignment_subject_lookup[assignment_id] = subject_raw

            subject_docs = []
            if subject_object_ids:
                subject_docs = await self.db.subjects.find(
                    {"_id": {"$in": list(set(subject_object_ids))}},
                    {"_id": 1, "name": 1},
                ).to_list(length=len(set(subject_object_ids)))

            subject_name_by_id = {
                str(subject.get("_id")): str(subject.get("name") or "General")
                for subject in subject_docs
                if subject.get("_id")
            }
            subject_by_assignment_id = {
                assignment_id: subject_name_by_id.get(
                    subject_ref, subject_ref or "General"
                )
                for assignment_id, subject_ref in assignment_subject_lookup.items()
            }

            progress_query: Dict[str, Any] = {"tutor_id": tutor_id}
            if student_ids:
                progress_query["student_id"] = {"$in": student_ids}

            progress_docs = await self.collection.find(progress_query).to_list(
                length=10000
            )

            student_performance = _build_student_performance_rows(
                progress_docs,
                student_names=student_names,
                subject_by_assignment_id=subject_by_assignment_id,
            )
            weekly_progress = _build_weekly_progress_rows(
                progress_docs,
                weeks=4,
                date_field="created_at",
            )

            return ProgressReportsResponse(
                student_performance=student_performance,
                weekly_progress=weekly_progress,
            )

        except Exception as e:
            logger.error(
                "Failed to get progress reports",
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get progress reports: {str(e)}")

    async def update_student_performance(
        self,
        student_id: str,
        student_name: str,
        subject_scores: Dict[str, int],
        tutor_id: str,
    ) -> StudentPerformanceInDB:
        """Persist aggregated performance snapshots when needed."""
        try:
            update_data: Dict[str, Any] = {
                "student_name": student_name,
                "subject_scores": subject_scores,
                "tutor_id": tutor_id,
                "updated_at": datetime.now(timezone.utc),
            }

            await self.performance_collection.update_one(
                {"student_id": student_id, "tutor_id": tutor_id},
                {
                    "$set": update_data,
                    "$setOnInsert": {
                        "student_id": student_id,
                        "created_at": datetime.now(timezone.utc),
                    },
                },
                upsert=True,
            )

            performance = await self.performance_collection.find_one(
                {"student_id": student_id, "tutor_id": tutor_id}
            )
            if not performance:
                raise DatabaseException("Failed to load updated performance snapshot")

            logger.info(
                "Student performance updated",
                student_id=student_id,
                tutor_id=tutor_id,
            )
            return StudentPerformanceInDB(**performance)

        except Exception as e:
            logger.error(
                "Failed to update student performance",
                student_id=student_id,
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to update student performance: {str(e)}")
