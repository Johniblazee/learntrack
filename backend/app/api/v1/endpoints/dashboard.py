"""
Dashboard data endpoints
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from datetime import datetime, timezone
from bson import ObjectId

from app.core.database import get_database
from app.core.enhanced_auth import (
    require_parent,
    require_tutor,
    require_student,
    ClerkUserContext,
)
from pydantic import BaseModel
from app.services.assignment_service import AssignmentService
from app.services.progress_service import _is_completed_status

logger = structlog.get_logger()
router = APIRouter()

COMPLETED_PROGRESS_STATUSES = {"submitted", "graded"}
LIVE_ASSIGNMENT_STATUSES = {"scheduled", "published", "active"}


class DashboardStats(BaseModel):
    """Dashboard statistics response"""

    total_students: int
    active_assignments: int
    avg_performance: float
    engagement_rate: float
    top_performers: List[Dict[str, Any]]
    performance_data: List[Dict[str, Any]]
    recent_activity: List[Dict[str, Any]]
    upcoming_deadlines: List[Dict[str, Any]]


class TopPerformer(BaseModel):
    """Top performer data"""

    name: str
    subject: str
    score: float
    trend: str
    avatar: str


class SubjectPerformance(BaseModel):
    """Subject performance data"""

    subject: str
    avgScore: float
    completionRate: float


def _grade_label(score: float) -> str:
    if score >= 90:
        return "A"
    if score >= 85:
        return "B+"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    return "Needs support"


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get dashboard statistics for tutor - calculated in real-time from actual data"""
    try:
        # Calculate real-time stats from actual data

        # 1. Count total students for this tutor from students collection
        total_students = await database.students.count_documents(
            {"tutor_id": current_user.clerk_id, "is_active": True}
        )

        # 2. Count active assignments
        active_assignments = await database.assignments.count_documents(
            {
                "tutor_id": current_user.clerk_id,
                "status": {"$in": list(LIVE_ASSIGNMENT_STATUSES)},
            }
        )

        # 3. Calculate average performance from student progress records
        pipeline = [
            {
                "$match": {
                    "tutor_id": current_user.clerk_id,
                    "status": {"$in": list(COMPLETED_PROGRESS_STATUSES)},
                    "score": {"$ne": None},
                }
            },
            {"$group": {"_id": None, "avg_score": {"$avg": "$score"}}},
        ]

        avg_result = await database.progress.aggregate(pipeline).to_list(length=1)
        avg_performance = (
            round(avg_result[0]["avg_score"], 1)
            if avg_result and avg_result[0].get("avg_score")
            else 0.0
        )

        # 4. Calculate engagement rate (students who submitted in last 7 days / total students)
        from datetime import datetime, timedelta, timezone

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

        active_students = await database.progress.distinct(
            "student_id",
            {
                "tutor_id": current_user.clerk_id,
                "$or": [
                    {"submitted_at": {"$gte": seven_days_ago}},
                    {"updated_at": {"$gte": seven_days_ago}},
                ],
            },
        )

        engagement_rate = (
            round((len(active_students) / total_students * 100), 1)
            if total_students > 0
            else 0.0
        )

        # Return calculated stats
        return DashboardStats(
            total_students=total_students,
            active_assignments=active_assignments,
            avg_performance=avg_performance,
            engagement_rate=engagement_rate,
            top_performers=[],  # Fetched separately via /top-performers endpoint
            performance_data=[],  # Fetched separately via /performance-chart endpoint
            recent_activity=[],  # Fetched separately via /recent-activity endpoint
            upcoming_deadlines=[],  # Fetched separately via /upcoming-deadlines endpoint
        )
    except Exception as e:
        logger.error("Failed to get dashboard stats", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get dashboard stats: {str(e)}"
        )


@router.get("/top-performers", response_model=List[TopPerformer])
async def get_top_performers(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get top performing students from real graded/submitted progress."""
    try:
        pipeline = [
            {
                "$match": {
                    "tutor_id": current_user.clerk_id,
                    "status": {"$in": list(COMPLETED_PROGRESS_STATUSES)},
                    "score": {"$ne": None},
                }
            },
            {"$sort": {"submitted_at": -1, "updated_at": -1}},
            {
                "$group": {
                    "_id": {
                        "student_id": "$student_id",
                        "assignment_id": "$assignment_id",
                    },
                    "latest_score": {"$first": "$score"},
                }
            },
            {
                "$group": {
                    "_id": "$_id.student_id",
                    "avg_score": {"$avg": "$latest_score"},
                    "scores": {"$push": "$latest_score"},
                    "latest_assignment_id": {"$first": "$_id.assignment_id"},
                }
            },
            {"$sort": {"avg_score": -1}},
            {"$limit": 4},
            {
                "$lookup": {
                    "from": "students",
                    "localField": "_id",
                    "foreignField": "clerk_id",
                    "as": "student",
                }
            },
            {"$unwind": {"path": "$student", "preserveNullAndEmptyArrays": True}},
            {
                "$project": {
                    "avg_score": 1,
                    "scores": 1,
                    "latest_assignment_id": 1,
                    "name": {"$ifNull": ["$student.name", "Unknown"]},
                }
            },
        ]

        top_students = await database.progress.aggregate(pipeline).to_list(length=4)

        if not top_students:
            return []

        assignment_ids = [
            str(student_data.get("latest_assignment_id") or "")
            for student_data in top_students
            if student_data.get("latest_assignment_id")
        ]
        assignment_object_ids = []
        for assignment_id in assignment_ids:
            try:
                assignment_object_ids.append(ObjectId(assignment_id))
            except Exception:
                continue

        assignments = []
        if assignment_object_ids:
            assignments = await database.assignments.find(
                {"_id": {"$in": assignment_object_ids}},
                {"subject_id": 1},
            ).to_list(length=len(assignment_object_ids))
        subject_ids = [
            assignment.get("subject_id")
            for assignment in assignments
            if assignment.get("subject_id")
        ]
        subject_docs = []
        if subject_ids:
            subject_docs = await database.subjects.find(
                {"_id": {"$in": subject_ids}},
                {"_id": 1, "name": 1},
            ).to_list(length=len(subject_ids))
        subject_name_by_id = {
            str(subject.get("_id")): str(subject.get("name") or "General")
            for subject in subject_docs
            if subject.get("_id")
        }
        subject_by_assignment_id = {
            str(assignment.get("_id")): subject_name_by_id.get(
                str(assignment.get("subject_id")),
                "General",
            )
            for assignment in assignments
            if assignment.get("_id")
        }

        performers = []
        for student_data in top_students:
            scores = [
                float(score)
                for score in student_data.get("scores", [])
                if isinstance(score, (int, float))
            ]
            latest_score = scores[0] if scores else 0.0
            historical_scores = scores[1:4]
            baseline = (
                sum(historical_scores) / len(historical_scores)
                if historical_scores
                else latest_score
            )
            trend_delta = round(latest_score - baseline, 1)
            if trend_delta > 0.5:
                trend = f"+{trend_delta:.1f}"
            elif trend_delta < -0.5:
                trend = f"{trend_delta:.1f}"
            else:
                trend = "steady"

            name = str(student_data.get("name") or "Unknown")
            performers.append(
                TopPerformer(
                    name=name,
                    subject=subject_by_assignment_id.get(
                        str(student_data.get("latest_assignment_id") or ""),
                        "General",
                    ),
                    score=round(float(student_data.get("avg_score", 0) or 0), 1),
                    trend=trend,
                    avatar=name[:2].upper(),
                )
            )

        return performers

    except Exception as e:
        logger.error("Failed to get top performers", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get top performers: {str(e)}"
        )


@router.get("/subject-performance", response_model=List[SubjectPerformance])
async def get_subject_performance(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get subject performance data calculated from real progress records."""
    try:
        subjects = await database.subjects.find(
            {"tutor_id": current_user.clerk_id}
        ).to_list(length=100)
        if not subjects:
            return []

        subject_ids = [subject.get("_id") for subject in subjects if subject.get("_id")]
        assignments = await database.assignments.find(
            {
                "tutor_id": current_user.clerk_id,
                "subject_id": {"$in": subject_ids},
            },
            {"_id": 1, "subject_id": 1, "student_ids": 1},
        ).to_list(length=1000)

        assignment_ids = [
            str(assignment.get("_id"))
            for assignment in assignments
            if assignment.get("_id")
        ]
        progress_docs = []
        if assignment_ids:
            progress_docs = await database.progress.find(
                {
                    "tutor_id": current_user.clerk_id,
                    "assignment_id": {"$in": assignment_ids},
                },
                {"assignment_id": 1, "score": 1, "status": 1},
            ).to_list(length=5000)

        assignments_by_subject: Dict[str, Dict[str, Any]] = {}
        assignment_subject_map: Dict[str, str] = {}
        for assignment in assignments:
            subject_key = str(assignment.get("subject_id"))
            assignment_id = str(assignment.get("_id"))
            assignment_subject_map[assignment_id] = subject_key
            bucket = assignments_by_subject.setdefault(
                subject_key,
                {"expected_submissions": 0},
            )
            bucket["expected_submissions"] += len(
                assignment.get("student_ids", []) or []
            )

        progress_by_subject: Dict[str, Dict[str, Any]] = {}
        for progress in progress_docs:
            subject_key = assignment_subject_map.get(
                str(progress.get("assignment_id") or "")
            )
            if not subject_key:
                continue
            bucket = progress_by_subject.setdefault(
                subject_key,
                {"completed": 0, "scores": []},
            )
            if _is_completed_status(str(progress.get("status") or "")):
                bucket["completed"] += 1
            score = progress.get("score")
            if score is not None:
                try:
                    bucket["scores"].append(float(score))
                except (TypeError, ValueError):
                    continue

        subject_performance = []
        for subject in subjects:
            subject_id = str(subject.get("_id"))
            progress_bucket = progress_by_subject.get(subject_id, {})
            assignment_bucket = assignments_by_subject.get(subject_id, {})
            scores = progress_bucket.get("scores", [])
            avg_score = round(sum(scores) / len(scores), 1) if scores else 0.0
            expected_submissions = int(
                assignment_bucket.get("expected_submissions", 0) or 0
            )
            completed_submissions = int(progress_bucket.get("completed", 0) or 0)
            completion_rate = (
                round((completed_submissions / expected_submissions) * 100, 1)
                if expected_submissions > 0
                else 0.0
            )

            subject_performance.append(
                {
                    "subject": subject["name"],
                    "avgScore": avg_score,
                    "completionRate": min(completion_rate, 100.0),  # Cap at 100%
                }
            )

        return subject_performance
    except Exception as e:
        logger.error("Failed to get subject performance", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get subject performance: {str(e)}"
        )


@router.get("/recent-activity")
async def get_recent_activity(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
    limit: int = 10,
):
    """Get recent tutor activity feed derived from tracked activity events."""
    try:
        activity_docs = (
            await database.activities.find({"tutor_id": current_user.clerk_id})
            .sort("created_at", -1)
            .limit(limit)
            .to_list(length=limit)
        )

        if not activity_docs:
            return []

        student_ids = {
            str(doc.get("user_id"))
            for doc in activity_docs
            if isinstance(doc.get("user_id"), str)
        }

        assignment_object_ids = []
        seen_assignment_ids = set()
        for doc in activity_docs:
            metadata = doc.get("metadata") or {}
            related_entity_type = str(doc.get("related_entity_type") or "").lower()
            related_entity_id = str(doc.get("related_entity_id") or "")
            metadata_assignment_id = str(metadata.get("assignment_id") or "")

            candidate_ids = []
            if related_entity_type == "assignment" and related_entity_id:
                candidate_ids.append(related_entity_id)
            if metadata_assignment_id:
                candidate_ids.append(metadata_assignment_id)

            for assignment_id in candidate_ids:
                if assignment_id in seen_assignment_ids:
                    continue
                try:
                    assignment_object_ids.append(ObjectId(assignment_id))
                    seen_assignment_ids.add(assignment_id)
                except Exception:
                    continue

        students = []
        if student_ids:
            students = await database.students.find(
                {"clerk_id": {"$in": list(student_ids)}},
                {"clerk_id": 1, "name": 1},
            ).to_list(length=len(student_ids))
        students_by_id = {
            str(student.get("clerk_id")): str(student.get("name") or "Learner")
            for student in students
            if student.get("clerk_id")
        }

        assignments = []
        if assignment_object_ids:
            assignments = await database.assignments.find(
                {"_id": {"$in": assignment_object_ids}},
                {"title": 1},
            ).to_list(length=len(assignment_object_ids))
        assignments_by_id = {
            str(assignment.get("_id")): str(
                assignment.get("title") or "Untitled assignment"
            )
            for assignment in assignments
            if assignment.get("_id")
        }

        action_map = {
            "assignment_submitted": "submitted",
            "assignment_completed": "completed",
            "assignment_started": "started",
            "material_viewed": "viewed",
            "material_downloaded": "downloaded",
            "message_sent": "sent",
            "invitation_accepted": "joined",
        }
        type_map = {
            "assignment_submitted": "submitted",
            "assignment_completed": "completed",
            "invitation_accepted": "joined",
        }

        activities = []
        for doc in activity_docs:
            activity_type = str(doc.get("activity_type") or "").lower()
            metadata = doc.get("metadata") or {}

            GENERIC_NAME_SENTINELS = {"a student", "student", "learner", "unknown"}

            actor_id = str(doc.get("user_id") or "")
            actor_name = str(metadata.get("student_name") or "").strip()
            if actor_name.lower() in GENERIC_NAME_SENTINELS:
                actor_name = ""  # force DB lookup for old records with generic names

            if not actor_name:
                if actor_id == current_user.clerk_id:
                    actor_name = "You"
                else:
                    actor_name = students_by_id.get(actor_id, "Learner")

            related_assignment_id = str(doc.get("related_entity_id") or "")
            if not related_assignment_id:
                related_assignment_id = str(metadata.get("assignment_id") or "")

            assignment_title = str(metadata.get("assignment_title") or "").strip()
            if not assignment_title and related_assignment_id:
                assignment_title = assignments_by_id.get(related_assignment_id, "")
            if not assignment_title:
                if activity_type == "message_sent":
                    assignment_title = "a conversation"
                elif activity_type.startswith("material_"):
                    assignment_title = "learning material"
                else:
                    assignment_title = "an activity"

            activities.append(
                {
                    "student": actor_name,
                    "action": action_map.get(activity_type, "updated"),
                    "assignment": assignment_title,
                    "time": "Recently",
                    "type": type_map.get(activity_type, "activity"),
                    "created_at": doc.get("created_at"),
                }
            )

        return activities
    except Exception as e:
        logger.error("Failed to get recent activity", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get recent activity: {str(e)}"
        )


@router.get("/upcoming-deadlines")
async def get_upcoming_deadlines(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
    limit: int = 10,
):
    """Calculate upcoming assignment deadlines dynamically with relative dates"""
    try:
        from datetime import datetime, timedelta, timezone

        # Get current date in UTC (timezone-aware)
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        total_students = await database.students.count_documents(
            {"tutor_id": current_user.clerk_id, "is_active": True}
        )

        assignments = (
            await database.assignments.find(
                {
                    "tutor_id": current_user.clerk_id,
                    "due_date": {
                        "$gte": today_start
                    },  # Include assignments from start of today
                    "status": {"$in": list(LIVE_ASSIGNMENT_STATUSES)},
                }
            )
            .sort("due_date", 1)
            .limit(limit)
            .to_list(length=limit)
        )

        assignment_ids = [
            str(assignment.get("_id"))
            for assignment in assignments
            if assignment.get("_id")
        ]
        subject_object_ids = [
            assignment.get("subject_id")
            for assignment in assignments
            if isinstance(assignment.get("subject_id"), ObjectId)
        ]

        subject_docs = []
        if subject_object_ids:
            subject_docs = await database.subjects.find(
                {"_id": {"$in": subject_object_ids}}
            ).to_list(length=len(subject_object_ids))
        subject_map = {
            str(doc.get("_id")): doc.get("name", "Unknown") for doc in subject_docs
        }

        submission_map = {}
        if assignment_ids:
            progress_pipeline = [
                {
                    "$match": {
                        "tutor_id": current_user.clerk_id,
                        "assignment_id": {"$in": assignment_ids},
                        "status": {"$in": list(COMPLETED_PROGRESS_STATUSES)},
                    }
                },
                {"$group": {"_id": "$assignment_id", "count": {"$sum": 1}}},
            ]
            submission_stats = await database.progress.aggregate(
                progress_pipeline
            ).to_list(length=len(assignment_ids))
            submission_map = {
                item["_id"]: item.get("count", 0) for item in submission_stats
            }

        deadlines = []
        for assignment in assignments:
            due_date = assignment.get("due_date")
            if not due_date:
                continue

            # Make due_date timezone-aware if it isn't already
            if due_date.tzinfo is None:
                due_date = due_date.replace(tzinfo=timezone.utc)

            # Calculate relative date label
            due_date_start = due_date.replace(hour=0, minute=0, second=0, microsecond=0)
            days_until = (due_date_start - today_start).days

            if days_until == 0:
                date_label = "Today"
                urgency = "high"
            elif days_until == 1:
                date_label = "Tomorrow"
                urgency = "high"
            elif days_until <= 7:
                date_label = due_date.strftime("%b %d")  # e.g., "Dec 28"
                urgency = "medium"
            else:
                date_label = due_date.strftime("%b %d")
                urgency = "low"

            subject_id = assignment.get("subject_id")
            subject_name = subject_map.get(str(subject_id), "Unknown")
            assignment_id = str(assignment.get("_id"))
            submission_count = submission_map.get(assignment_id, 0)
            total_expected = (
                len(assignment.get("student_ids", []) or []) or total_students
            )

            deadlines.append(
                {
                    "id": assignment_id,
                    "title": assignment.get("title", "Untitled Assignment"),
                    "subject": subject_name,
                    "dueDate": date_label,
                    "urgency": urgency,
                    "completed": submission_count,
                    "total": total_expected,
                    "due_date_iso": due_date.isoformat(),  # For sorting/filtering on frontend
                }
            )

        return deadlines
    except Exception as e:
        logger.error("Failed to calculate upcoming deadlines", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to calculate upcoming deadlines: {str(e)}"
        )


@router.get("/performance-chart")
async def get_performance_chart(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
    days: int = 30,
):
    """Calculate performance chart data dynamically from progress records"""
    try:
        from datetime import timedelta

        # Calculate date range (last 30 days)
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        pipeline = [
            {
                "$match": {
                    "tutor_id": current_user.clerk_id,
                    "status": {"$in": list(COMPLETED_PROGRESS_STATUSES)},
                    "score": {"$ne": None},
                    "$or": [
                        {"submitted_at": {"$gte": start_date, "$lte": end_date}},
                        {"graded_at": {"$gte": start_date, "$lte": end_date}},
                        {"updated_at": {"$gte": start_date, "$lte": end_date}},
                    ],
                }
            },
            {
                "$addFields": {
                    "_effective_date": {
                        "$ifNull": [
                            "$submitted_at",
                            "$graded_at",
                            "$updated_at",
                            "$created_at",
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": {
                        "date": {
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": "$_effective_date",
                            }
                        },
                    },
                    "avg_score": {"$avg": "$score"},
                }
            },
            {"$sort": {"_id.date": 1}},
        ]

        results = await database.progress.aggregate(pipeline).to_list(length=1000)

        date_map = {}
        for result in results:
            date = result["_id"]["date"]
            avg_score = round(result["avg_score"], 1)

            date_map[date] = {
                "period": date,
                "performance": avg_score,
            }

        # Fill missing dates in range with performance: 0
        current = start_date
        while current <= end_date:
            date_str = current.strftime("%Y-%m-%d")
            if date_str not in date_map:
                date_map[date_str] = {"period": date_str, "performance": 0}
            current += timedelta(days=1)

        chart_data = sorted(date_map.values(), key=lambda x: x["period"])

        return chart_data
    except Exception as e:
        logger.error("Failed to calculate performance chart data", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate performance chart data: {str(e)}",
        )


@router.get("/progress-chart")
async def get_progress_chart(
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
    days: int = 30,
):
    """Calculate weekly assignment progress chart data from real assignments and progress."""
    try:
        from datetime import datetime, timedelta, timezone

        # Calculate date range
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        # Get all subjects for this tutor
        subjects = await database.subjects.find(
            {"tutor_id": current_user.clerk_id}
        ).to_list(length=100)
        subject_map = {str(s.get("_id")): s.get("name", "Unknown") for s in subjects}

        # Calculate completion rate by date and subject
        # Get assignments created in the date range
        assignments = await database.assignments.find(
            {
                "tutor_id": current_user.clerk_id,
                "created_at": {"$gte": start_date, "$lte": end_date},
            }
        ).to_list(length=1000)

        assignment_ids = [
            str(assignment.get("_id"))
            for assignment in assignments
            if assignment.get("_id")
        ]
        submission_map = {}
        if assignment_ids:
            submission_pipeline = [
                {
                    "$match": {
                        "tutor_id": current_user.clerk_id,
                        "assignment_id": {"$in": assignment_ids},
                        "status": {"$in": list(COMPLETED_PROGRESS_STATUSES)},
                    }
                },
                {"$group": {"_id": "$assignment_id", "count": {"$sum": 1}}},
            ]
            submission_stats = await database.progress.aggregate(
                submission_pipeline
            ).to_list(length=len(assignment_ids))
            submission_map = {
                item["_id"]: item.get("count", 0) for item in submission_stats
            }

        date_map = {}
        for assignment in assignments:
            created_date = assignment.get("created_at")
            if not created_date:
                continue

            date_str = created_date.strftime("%Y-%m-%d")
            subject_id = assignment.get("subject_id")
            subject_name = (
                subject_map.get(str(subject_id), "Unknown").lower().replace(" ", "_")
            )

            assignment_id = str(assignment.get("_id"))
            submission_count = submission_map.get(assignment_id, 0)

            expected_submissions = max(len(assignment.get("student_ids", []) or []), 1)
            completion_rate = min((submission_count / expected_submissions) * 100, 100)

            if date_str not in date_map:
                date_map[date_str] = {
                    "day": date_str[-2:],
                    "completionRate": 0.0,
                    "_completion_total": 0.0,
                    "_completion_count": 0,
                }

            date_map[date_str]["_completion_total"] += completion_rate
            date_map[date_str]["_completion_count"] += 1
            date_map[date_str]["completionRate"] = round(
                date_map[date_str]["_completion_total"]
                / max(date_map[date_str]["_completion_count"], 1),
                1,
            )

            subject_total_key = f"_{subject_name}_total"
            subject_count_key = f"_{subject_name}_count"
            date_map[date_str][subject_total_key] = (
                float(date_map[date_str].get(subject_total_key, 0.0) or 0.0)
                + completion_rate
            )
            date_map[date_str][subject_count_key] = (
                int(date_map[date_str].get(subject_count_key, 0) or 0) + 1
            )
            date_map[date_str][subject_name] = round(
                date_map[date_str][subject_total_key]
                / max(date_map[date_str][subject_count_key], 1),
                1,
            )

        chart_data = []
        for row in date_map.values():
            cleaned_row = {
                key: value for key, value in row.items() if not key.startswith("_")
            }
            chart_data.append(cleaned_row)

        return chart_data
    except Exception as e:
        logger.error("Failed to calculate progress chart data", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to calculate progress chart data: {str(e)}"
        )


@router.get("/student-stats")
async def get_student_dashboard_stats(
    current_user: ClerkUserContext = Depends(require_student),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get dashboard statistics for student"""
    try:
        assignment_service = AssignmentService(database)
        assignment_result = await assignment_service.get_student_assignment_summaries(
            student_id=current_user.clerk_id,
            tutor_id=current_user.tutor_id or current_user.clerk_id,
            page=1,
            per_page=1000,
        )
        assignments = assignment_result.get("items", [])

        total_assignments = len(assignments)
        completed = len(
            [
                assignment
                for assignment in assignments
                if str(getattr(assignment, "status", "") or "")
                in COMPLETED_PROGRESS_STATUSES
            ]
        )
        pending = len(
            [
                assignment
                for assignment in assignments
                if str(getattr(assignment, "status", "") or "")
                not in COMPLETED_PROGRESS_STATUSES.union({"archived"})
            ]
        )

        completed_scores = [
            getattr(assignment, "best_score", None)
            for assignment in assignments
            if str(getattr(assignment, "status", "") or "")
            in COMPLETED_PROGRESS_STATUSES
            and getattr(assignment, "best_score", None) is not None
        ]
        avg_score = (
            round(sum(completed_scores) / len(completed_scores), 1)
            if completed_scores
            else 0
        )

        return {
            "total_assignments": total_assignments,
            "completed": completed,
            "pending": pending,
            "overall_average": avg_score,
            "current_grade": _grade_label(avg_score),
        }
    except Exception as e:
        logger.error("Failed to get student dashboard stats", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get student dashboard stats: {str(e)}"
        )


@router.get("/parent-stats")
async def get_parent_dashboard_stats(
    current_user: ClerkUserContext = Depends(require_parent),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get dashboard statistics for parent"""
    try:
        from app.services.progress_service import ProgressService

        progress_service = ProgressService(database)
        parent_views = await progress_service.get_parent_progress_view(
            current_user.clerk_id,
            parent_tutor_id=current_user.tutor_id,
        )
        student_docs = await database.students.find(
            {"clerk_id": {"$in": [view.child_id for view in parent_views]}},
            {"clerk_id": 1, "student_profile.grade": 1},
        ).to_list(length=len(parent_views))
        grade_by_child_id = {
            str(student.get("clerk_id")): student.get("student_profile", {}).get(
                "grade"
            )
            for student in student_docs
            if student.get("clerk_id")
        }

        children = []
        for view in parent_views:
            avg_score = view.analytics.average_score or 0
            total_assignments = max(view.analytics.total_assignments, 0)
            completed_assignments = min(
                view.analytics.completed_assignments, total_assignments
            )
            completion_rate = (
                round((completed_assignments / total_assignments) * 100)
                if total_assignments > 0
                else 0
            )
            children.append(
                {
                    "id": view.child_id,
                    "name": view.child_name,
                    "grade": grade_by_child_id.get(view.child_id),
                    "overall_progress": completion_rate,
                    "recent_grade": _grade_label(avg_score),
                    "assignments_due": len(view.upcoming_assignments),
                }
            )

        return {"children": children}
    except Exception as e:
        logger.error("Failed to get parent dashboard stats", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get parent dashboard stats: {str(e)}"
        )
