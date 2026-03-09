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
    require_tutor,
    require_authenticated_user,
    ClerkUserContext,
)
from pydantic import BaseModel

logger = structlog.get_logger()
router = APIRouter()


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

        # 2. Count active assignments (assignments with status "active" or "published")
        active_assignments = await database.assignments.count_documents(
            {
                "tutor_id": current_user.clerk_id,
                "status": {"$in": ["active", "published"]},
            }
        )

        # 3. Calculate average performance from student submissions
        # Get all submissions for this tutor's assignments
        pipeline = [
            {"$match": {"tutor_id": current_user.clerk_id}},
            {"$group": {"_id": None, "avg_score": {"$avg": "$score"}}},
        ]

        avg_result = await database.submissions.aggregate(pipeline).to_list(length=1)
        avg_performance = (
            round(avg_result[0]["avg_score"], 1)
            if avg_result and avg_result[0].get("avg_score")
            else 0.0
        )

        # 4. Calculate engagement rate (students who submitted in last 7 days / total students)
        from datetime import datetime, timedelta, timezone

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

        active_students = await database.submissions.distinct(
            "student_id",
            {
                "tutor_id": current_user.clerk_id,
                "submitted_at": {"$gte": seven_days_ago},
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
    """Get top performing students - calculated from real submissions"""
    try:
        pipeline = [
            {"$match": {"tutor_id": current_user.clerk_id}},
            {
                "$group": {
                    "_id": "$student_id",
                    "avg_score": {"$avg": "$score"},
                    "total_submissions": {"$sum": 1},
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
                    "name": {"$ifNull": ["$student.name", "Unknown"]},
                }
            },
        ]

        top_students = await database.submissions.aggregate(pipeline).to_list(length=4)

        if not top_students:
            return []

        performers = [
            TopPerformer(
                name=student_data.get("name", "Unknown"),
                subject="General",
                score=round(student_data.get("avg_score", 0), 1),
                trend="up" if student_data.get("avg_score", 0) >= 90 else "down",
                avatar=student_data.get("name", "U")[:2].upper(),
            )
            for student_data in top_students
        ]

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
    """Get subject performance data calculated from real submissions"""
    try:
        subjects = await database.subjects.find(
            {"tutor_id": current_user.clerk_id}
        ).to_list(length=100)
        if not subjects:
            return []

        subject_ids = [
            str(subject.get("_id")) for subject in subjects if subject.get("_id")
        ]

        submission_pipeline = [
            {
                "$match": {
                    "tutor_id": current_user.clerk_id,
                    "subject_id": {"$in": subject_ids},
                }
            },
            {
                "$group": {
                    "_id": "$subject_id",
                    "avg_score": {"$avg": "$score"},
                    "total_submissions": {"$sum": 1},
                }
            },
        ]
        submission_stats = await database.submissions.aggregate(
            submission_pipeline
        ).to_list(length=200)
        submission_map = {item["_id"]: item for item in submission_stats}

        assignment_pipeline = [
            {
                "$match": {
                    "tutor_id": current_user.clerk_id,
                    "subject_id": {"$in": subject_ids},
                }
            },
            {"$group": {"_id": "$subject_id", "total_assignments": {"$sum": 1}}},
        ]
        assignment_stats = await database.assignments.aggregate(
            assignment_pipeline
        ).to_list(length=200)
        assignment_map = {
            item["_id"]: item.get("total_assignments", 0) for item in assignment_stats
        }

        subject_performance = []
        for subject in subjects:
            subject_id = str(subject.get("_id"))
            submission = submission_map.get(subject_id)
            if submission and submission.get("avg_score") is not None:
                avg_score = round(submission.get("avg_score", 0), 1)
                total_assignments = assignment_map.get(subject_id, 0)
                completion_rate = round(
                    (submission.get("total_submissions", 0) / max(total_assignments, 1))
                    * 100,
                    1,
                )
            else:
                avg_score = 0.0
                completion_rate = 0.0

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
                actor_name = ""          # force DB lookup for old records with generic names

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
                    "status": {"$in": ["active", "published"]},
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
            doc.get("_id"): doc.get("name", "Unknown") for doc in subject_docs
        }

        submission_map = {}
        if assignment_ids:
            submission_pipeline = [
                {
                    "$match": {
                        "tutor_id": current_user.clerk_id,
                        "assignment_id": {"$in": assignment_ids},
                    }
                },
                {"$group": {"_id": "$assignment_id", "count": {"$sum": 1}}},
            ]
            submission_stats = await database.submissions.aggregate(
                submission_pipeline
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
            subject_name = subject_map.get(subject_id, "Unknown")
            assignment_id = str(assignment.get("_id"))
            submission_count = submission_map.get(assignment_id, 0)

            deadlines.append(
                {
                    "title": assignment.get("title", "Untitled Assignment"),
                    "subject": subject_name,
                    "dueDate": date_label,
                    "urgency": urgency,
                    "completed": submission_count,
                    "total": total_students,
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
    """Calculate performance chart data dynamically from submissions"""
    try:
        from datetime import timedelta

        # Calculate date range (last 30 days)
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)

        # Get all subjects for this tutor
        subjects = await database.subjects.find(
            {"tutor_id": current_user.clerk_id}
        ).to_list(length=100)
        subject_map = {str(s.get("_id")): s.get("name", "Unknown") for s in subjects}

        # Aggregate submissions by date and subject
        pipeline = [
            {
                "$match": {
                    "tutor_id": current_user.clerk_id,
                    "submitted_at": {"$gte": start_date, "$lte": end_date},
                }
            },
            {
                "$group": {
                    "_id": {
                        "date": {
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": "$submitted_at",
                            }
                        },
                        "subject_id": "$subject_id",
                    },
                    "avg_score": {"$avg": "$score"},
                }
            },
            {"$sort": {"_id.date": 1}},
        ]

        results = await database.submissions.aggregate(pipeline).to_list(length=1000)

        # Group by date
        date_map = {}
        for result in results:
            date = result["_id"]["date"]
            subject_id = result["_id"]["subject_id"]
            subject_name = (
                subject_map.get(subject_id, "Unknown").lower().replace(" ", "_")
            )
            avg_score = round(result["avg_score"], 1)

            if date not in date_map:
                date_map[date] = {"day": date[-2:]}  # Get day from YYYY-MM-DD

            date_map[date][subject_name] = avg_score

        # Convert to list and fill missing days with interpolated values
        chart_data = list(date_map.values())

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
    """Calculate weekly assignment progress chart data dynamically from assignments and submissions"""
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
                    }
                },
                {"$group": {"_id": "$assignment_id", "count": {"$sum": 1}}},
            ]
            submission_stats = await database.submissions.aggregate(
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
                subject_map.get(subject_id, "Unknown").lower().replace(" ", "_")
            )

            assignment_id = str(assignment.get("_id"))
            submission_count = submission_map.get(assignment_id, 0)

            # Calculate completion rate (assuming 10 students per assignment as baseline)
            expected_submissions = 10
            completion_rate = min((submission_count / expected_submissions) * 100, 100)

            if date_str not in date_map:
                date_map[date_str] = {"day": date_str[-2:]}

            # Average if multiple assignments on same day
            if subject_name in date_map[date_str]:
                date_map[date_str][subject_name] = (
                    date_map[date_str][subject_name] + completion_rate
                ) / 2
            else:
                date_map[date_str][subject_name] = round(completion_rate, 1)

        chart_data = list(date_map.values())

        return chart_data
    except Exception as e:
        logger.error("Failed to calculate progress chart data", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to calculate progress chart data: {str(e)}"
        )


@router.get("/student-stats")
async def get_student_dashboard_stats(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get dashboard statistics for student"""
    try:
        # Get student's assignments
        assignments = await database.assignments.find(
            {"student_ids": current_user.clerk_id}
        ).to_list(length=100)

        # Get student's progress
        progress_records = await database.progress.find(
            {"student_id": current_user.clerk_id}
        ).to_list(length=100)

        # Calculate stats
        total_assignments = len(assignments)
        completed_statuses = {"completed", "submitted", "graded"}
        completed = len(
            [p for p in progress_records if p.get("status") in completed_statuses]
        )
        pending = total_assignments - completed

        # Calculate average score
        completed_scores = [
            p.get("score", 0)
            for p in progress_records
            if p.get("status") in completed_statuses and p.get("score") is not None
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
            "current_grade": "A"
            if avg_score >= 90
            else "B+"
            if avg_score >= 85
            else "B"
            if avg_score >= 80
            else "C",
        }
    except Exception as e:
        logger.error("Failed to get student dashboard stats", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get student dashboard stats: {str(e)}"
        )


@router.get("/parent-stats")
async def get_parent_dashboard_stats(
    current_user: ClerkUserContext = Depends(require_authenticated_user),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get dashboard statistics for parent"""
    try:
        # Get parent's children from parents collection
        parent = await database.parents.find_one({"clerk_id": current_user.clerk_id})

        if not parent:
            return {"children": []}

        child_ids = parent.get("parent_children", [])

        students = await database.students.find(
            {"clerk_id": {"$in": child_ids}}
        ).to_list(length=len(child_ids))
        student_map = {student.get("clerk_id"): student for student in students}

        progress_pipeline = [
            {"$match": {"student_id": {"$in": child_ids}}},
            {
                "$group": {
                    "_id": "$student_id",
                    "completed_scores": {
                        "$push": {
                            "$cond": [
                                {
                                    "$and": [
                                        {
                                            "$in": [
                                                "$status",
                                                ["completed", "submitted", "graded"],
                                            ]
                                        },
                                        {"$ne": ["$score", None]},
                                    ]
                                },
                                "$score",
                                "$$REMOVE",
                            ]
                        }
                    },
                    "assignments_due": {
                        "$sum": {"$cond": [{"$eq": ["$status", "in_progress"]}, 1, 0]}
                    },
                }
            },
        ]
        progress_stats = await database.progress.aggregate(progress_pipeline).to_list(
            length=len(child_ids)
        )
        progress_map = {item["_id"]: item for item in progress_stats}

        children = []
        for child_id in child_ids:
            child = student_map.get(child_id)
            if not child:
                continue

            child_progress = progress_map.get(child_id, {})
            completed_scores = child_progress.get("completed_scores", [])
            avg_score = (
                round(sum(completed_scores) / len(completed_scores), 1)
                if completed_scores
                else 0
            )

            children.append(
                {
                    "id": child_id,
                    "name": child.get("name", "Unknown"),
                    "grade": child.get("student_profile", {}).get("grade", "N/A"),
                    "overall_progress": avg_score,
                    "recent_grade": "A"
                    if avg_score >= 90
                    else "B+"
                    if avg_score >= 85
                    else "B",
                    "assignments_due": child_progress.get("assignments_due", 0),
                }
            )

        return {"children": children}
    except Exception as e:
        logger.error("Failed to get parent dashboard stats", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to get parent dashboard stats: {str(e)}"
        )
