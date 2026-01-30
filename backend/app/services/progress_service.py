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
            progress_dict = progress_data.dict()
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
            update_data = progress_update.dict(exclude_unset=True)
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
        self, assignment_id: str
    ) -> List[StudentProgress]:
        """Get progress for all students in an assignment"""
        try:
            # This would need to join with students and assignments collections
            # For now, return empty list as placeholder
            cursor = self.collection.find({"assignment_id": assignment_id})
            progress_list = []

            async for progress in cursor:
                # In a real implementation, you'd join with student and assignment data
                student_progress = StudentProgress(
                    student_id=progress["student_id"],
                    student_name="Student Name",  # Would come from join
                    assignment_id=progress["assignment_id"],
                    assignment_title="Assignment Title",  # Would come from join
                    subject_name="Subject",  # Would come from join
                    topic="Topic",  # Would come from join
                    status=progress["status"],
                    score=progress.get("score"),
                    attempts_used=1,
                    max_attempts=3,
                    started_at=progress.get("started_at"),
                    submitted_at=progress.get("submitted_at"),
                    due_date=datetime.now(timezone.utc)
                    + timedelta(days=7),  # Would come from assignment
                    is_overdue=False,
                )
                progress_list.append(student_progress)

            return progress_list

        except Exception as e:
            logger.error(
                "Failed to get assignment progress",
                assignment_id=assignment_id,
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
            completed_assignments = len(
                [
                    p
                    for p in progress_records
                    if p.get("status") == SubmissionStatus.SUBMITTED.value
                ]
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

            # Calculate subject performance from aggregated data (no additional queries needed)
            subject_data: dict = {}
            for progress in progress_records:
                subject_name = progress.get("subject_name", "Unknown")
                if subject_name not in subject_data:
                    subject_data[subject_name] = {"scores": [], "count": 0}
                if progress.get("score") is not None:
                    subject_data[subject_name]["scores"].append(progress["score"])
                subject_data[subject_name]["count"] += 1

            subject_performance = []
            for subject_name, data in subject_data.items():
                avg_score = (
                    round(sum(data["scores"]) / len(data["scores"]), 1)
                    if data["scores"]
                    else 0
                )
                subject_performance.append(
                    {
                        "subject": subject_name,
                        "score": avg_score,
                        "assignments": data["count"],
                    }
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
                p
                for p in progress_records
                if p.get("status") == SubmissionStatus.SUBMITTED.value
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

            # Calculate weekly progress (last 4 weeks)
            weekly_progress = []
            now = datetime.now(timezone.utc)

            for week_num in range(4, 0, -1):
                week_start = now - timedelta(weeks=week_num)
                week_end = now - timedelta(weeks=week_num - 1)

                week_records = [
                    p
                    for p in progress_records
                    if (tz_dt := ensure_tz_aware(p.get("created_at")))
                    and week_start <= tz_dt < week_end
                ]
                completed_in_week = len(
                    [
                        p
                        for p in week_records
                        if p.get("status") == SubmissionStatus.SUBMITTED.value
                    ]
                )

                weekly_progress.append(
                    {
                        "week": f"Week {5 - week_num}",
                        "completed": completed_in_week,
                        "assigned": len(week_records),
                    }
                )

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
            # This would need to get children from user relationships
            # For now, return mock data
            mock_child_analytics = await self.get_student_analytics("mock_child_id")

            parent_view = ParentProgressView(
                child_id="mock_child_id",
                child_name="Sarah Johnson",
                analytics=mock_child_analytics,
                recent_assignments=[],
                upcoming_assignments=[
                    {
                        "title": "Algebra Practice",
                        "due_date": "2024-12-25",
                        "subject": "Mathematics",
                    },
                    {
                        "title": "Physics Quiz",
                        "due_date": "2024-12-28",
                        "subject": "Physics",
                    },
                ],
            )

            return [parent_view]

        except Exception as e:
            logger.error(
                "Failed to get parent progress view", parent_id=parent_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get parent progress view: {str(e)}")

    async def seed_student_performance_data(self) -> None:
        """Seed the database with initial student performance data"""
        try:
            # Check if data already exists
            existing_count = await self.performance_collection.count_documents({})
            if existing_count > 0:
                logger.info("Student performance data already exists, skipping seed")
                return

            # Seed data matching the frontend structure
            seed_data = [
                {
                    "student_id": "student_1",
                    "student_name": "Sarah Johnson",
                    "subject_scores": {"math": 85, "physics": 78, "chemistry": 92},
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                },
                {
                    "student_id": "student_2",
                    "student_name": "Mike Chen",
                    "subject_scores": {"math": 92, "physics": 88, "chemistry": 85},
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                },
                {
                    "student_id": "student_3",
                    "student_name": "Emma Davis",
                    "subject_scores": {"math": 78, "physics": 82, "chemistry": 89},
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                },
                {
                    "student_id": "student_4",
                    "student_name": "John Smith",
                    "subject_scores": {"math": 88, "physics": 95, "chemistry": 76},
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                },
                {
                    "student_id": "student_5",
                    "student_name": "Lisa Wang",
                    "subject_scores": {"math": 94, "physics": 87, "chemistry": 91},
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                },
            ]

            await self.performance_collection.insert_many(seed_data)
            logger.info(
                "Student performance data seeded successfully", count=len(seed_data)
            )

        except Exception as e:
            logger.error("Failed to seed student performance data", error=str(e))
            raise DatabaseException(f"Failed to seed data: {str(e)}")

    async def get_progress_reports(self) -> ProgressReportsResponse:
        """Get progress reports data for the reports dashboard"""
        try:
            # Ensure data is seeded
            await self.seed_student_performance_data()

            # Get student performance data
            cursor = self.performance_collection.find({})
            student_performance = []

            async for performance in cursor:
                student_data = StudentPerformanceData(
                    name=performance["student_name"],
                    math=performance["subject_scores"].get("math", 0),
                    physics=performance["subject_scores"].get("physics", 0),
                    chemistry=performance["subject_scores"].get("chemistry", 0),
                )
                student_performance.append(student_data)

            # Mock weekly progress data (in a real app, this would be calculated from actual progress)
            weekly_progress = [
                WeeklyProgressData(week="Week 1", completed=45, assigned=50),
                WeeklyProgressData(week="Week 2", completed=52, assigned=55),
                WeeklyProgressData(week="Week 3", completed=48, assigned=50),
                WeeklyProgressData(week="Week 4", completed=58, assigned=60),
            ]

            return ProgressReportsResponse(
                student_performance=student_performance, weekly_progress=weekly_progress
            )

        except Exception as e:
            logger.error("Failed to get progress reports", error=str(e))
            raise DatabaseException(f"Failed to get progress reports: {str(e)}")

    async def update_student_performance(
        self, student_id: str, student_name: str, subject_scores: Dict[str, int]
    ) -> StudentPerformanceInDB:
        """Update or create student performance data"""
        try:
            update_data = {
                "student_name": student_name,
                "subject_scores": subject_scores,
                "updated_at": datetime.now(timezone.utc),
            }

            result = await self.performance_collection.update_one(
                {"student_id": student_id},
                {
                    "$set": update_data,
                    "$setOnInsert": {
                        "student_id": student_id,
                        "created_at": datetime.now(timezone.utc),
                    },
                },
                upsert=True,
            )

            # Get the updated document
            performance = await self.performance_collection.find_one(
                {"student_id": student_id}
            )
            logger.info("Student performance updated", student_id=student_id)
            return StudentPerformanceInDB(**performance)

        except Exception as e:
            logger.error(
                "Failed to update student performance",
                student_id=student_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to update student performance: {str(e)}")
