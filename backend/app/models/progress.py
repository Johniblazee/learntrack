"""
Progress tracking models and schemas
"""

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict
from bson import ObjectId

from app.models.user import PyObjectId


class SubmissionStatus(str, Enum):
    """Submission status"""

    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    GRADED = "graded"


class AnswerType(str, Enum):
    """Answer types"""

    CORRECT = "correct"
    INCORRECT = "incorrect"
    PARTIAL = "partial"
    UNANSWERED = "unanswered"


class QuestionAnswer(BaseModel):
    """Student answer to a question"""

    question_id: str
    answer: Optional[str] = None
    selected_options: List[str] = Field(default_factory=list)
    answer_type: AnswerType = AnswerType.UNANSWERED
    points_earned: float = 0.0
    points_possible: float = 1.0
    time_spent: Optional[int] = None  # seconds
    answered_at: Optional[datetime] = None


class ProgressBase(BaseModel):
    """Base progress model"""

    assignment_id: str
    student_id: str
    tutor_id: str = Field(
        ..., description="Tutor ID - references the tutor's Clerk user ID"
    )


class ProgressCreate(ProgressBase):
    """Progress creation model"""

    pass


class ProgressUpdate(BaseModel):
    """Progress update model"""

    answers: Optional[List[QuestionAnswer]] = None
    status: Optional[SubmissionStatus] = None
    submitted_at: Optional[datetime] = None
    score: Optional[float] = None
    points_earned: Optional[float] = None
    points_possible: Optional[float] = None
    feedback: Optional[str] = None
    graded_at: Optional[datetime] = None
    graded_by: Optional[str] = None
    time_spent: Optional[int] = None


class ProgressInDB(ProgressBase):
    """Progress model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    attempt_number: int = 1
    status: SubmissionStatus = SubmissionStatus.IN_PROGRESS
    answers: List[QuestionAnswer] = Field(default_factory=list)

    # Timing
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    submitted_at: Optional[datetime] = None
    time_spent: Optional[int] = None  # total seconds

    # Scoring
    score: Optional[float] = None  # percentage
    points_earned: float = 0.0
    points_possible: float = 0.0
    feedback: Optional[str] = None
    graded_at: Optional[datetime] = None
    graded_by: Optional[str] = None

    # Metadata
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Progress(ProgressInDB):
    """Progress response model"""

    pass


class AnswerSubmissionRequest(BaseModel):
    """Payload for student assignment submission"""

    answers: List[QuestionAnswer] = Field(default_factory=list)
    submit_assignment: bool = True


class GradeSubmissionRequest(BaseModel):
    """Payload for tutor grading updates"""

    score: float = Field(..., ge=0, le=100)
    feedback: Optional[str] = None


class StudentProgress(BaseModel):
    """Student progress summary"""

    student_id: str
    student_name: str
    assignment_id: str
    assignment_title: str
    subject_name: str
    topic: str
    status: SubmissionStatus
    score: Optional[float]
    attempts_used: int
    max_attempts: int
    started_at: Optional[datetime]
    submitted_at: Optional[datetime]
    due_date: datetime
    is_overdue: bool = False


class ProgressAnalytics(BaseModel):
    """Progress analytics for reporting"""

    total_assignments: int = 0
    completed_assignments: int = 0
    pending_assignments: int = 0
    overdue_assignments: int = 0
    average_score: Optional[float] = None
    total_time_spent: int = 0  # minutes

    # Subject-wise breakdown
    subject_performance: List[Dict[str, Any]] = Field(default_factory=list)

    # Recent activity
    recent_submissions: List[Dict[str, Any]] = Field(default_factory=list)

    # Trends
    weekly_progress: List[Dict[str, Any]] = Field(default_factory=list)


class ParentProgressView(BaseModel):
    """Progress view for parents"""

    child_id: str
    child_name: str
    analytics: ProgressAnalytics
    recent_assignments: List[StudentProgress]
    upcoming_assignments: List[Dict[str, Any]]


class StudentPerformanceData(BaseModel):
    """Student performance data for reports"""

    name: str
    overall: int = 0
    completed_assignments: int = 0
    subject_scores: Dict[str, int] = Field(default_factory=dict)


class StudentPerformanceInDB(BaseModel):
    """Student performance as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    student_id: str
    student_name: str
    subject_scores: Dict[str, int] = Field(
        default_factory=dict
    )  # subject_name -> score
    tutor_id: str = Field(
        ..., description="Tutor ID - references the tutor's Clerk user ID"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class WeeklyProgressData(BaseModel):
    """Weekly progress data for reports"""

    week: str
    completed: int
    assigned: int


class ProgressReportsResponse(BaseModel):
    """Response model for progress reports endpoint"""

    student_performance: List[StudentPerformanceData]
    weekly_progress: List[WeeklyProgressData]
