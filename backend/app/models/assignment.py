"""
Assignment models and schemas
"""

from datetime import datetime, date, timezone
from typing import List, Optional, Dict
from enum import Enum
from pydantic import BaseModel, Field, validator, root_validator, ConfigDict
from bson import ObjectId

from app.models.user import PyObjectId


class AssignmentStatus(str, Enum):
    """Assignment status"""

    DRAFT = "draft"  # Added for backward compatibility
    SCHEDULED = "scheduled"
    PUBLISHED = "published"  # Added for backward compatibility
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class AssignmentType(str, Enum):
    """Assignment types"""

    PRACTICE = "practice"
    QUIZ = "quiz"
    EXAM = "exam"
    HOMEWORK = "homework"


class QuestionAssignment(BaseModel):
    """Question within an assignment"""

    question_id: str
    points: int = 1
    order: int = 0


class AssignmentBase(BaseModel):
    """Base assignment model"""

    title: str
    description: Optional[str] = None
    subject_id: str
    topic: Optional[str] = None  # Made optional for backward compatibility
    assignment_type: AssignmentType = AssignmentType.PRACTICE
    due_date: Optional[datetime] = None
    time_limit: Optional[int] = None  # in minutes
    max_attempts: int = 1
    shuffle_questions: bool = False
    show_results_immediately: bool = True


class AssignmentCreate(AssignmentBase):
    """Assignment creation model"""

    student_ids: Optional[List[str]] = None  # Individual students
    group_ids: Optional[List[str]] = None  # Student groups
    subject_filter: Optional[str] = None  # Filter students by subject
    question_ids: List[str]

    @validator("question_ids")
    def validate_questions(cls, v):
        if not v:
            raise ValueError("Assignment must have at least one question")
        return v

    @root_validator(skip_on_failure=True)
    def validate_assignment_targets(cls, values):
        """Ensure at least one target is specified"""
        student_ids = values.get("student_ids")
        group_ids = values.get("group_ids")
        subject_filter = values.get("subject_filter")

        if not any([student_ids, group_ids, subject_filter]):
            raise ValueError(
                "Assignment must target at least one student, group, or subject"
            )

        return values


class AssignmentUpdate(BaseModel):
    """Assignment update model"""

    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    time_limit: Optional[int] = None
    max_attempts: Optional[int] = None
    shuffle_questions: Optional[bool] = None
    show_results_immediately: Optional[bool] = None
    status: Optional[AssignmentStatus] = None


class AssignmentInDB(AssignmentBase):
    """Assignment model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str
    student_ids: List[str] = Field(
        default_factory=list
    )  # Made optional with default for backward compatibility
    questions: List[QuestionAssignment] = Field(
        default_factory=list
    )  # Made optional with default for backward compatibility
    status: AssignmentStatus = AssignmentStatus.SCHEDULED
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Group assignment metadata
    group_ids: List[str] = Field(
        default_factory=list
    )  # Groups this assignment was assigned to
    assigned_via_subject: Optional[str] = None  # Subject ID if assigned by subject
    is_group_assignment: bool = False  # Flag for group assignments

    # Statistics
    total_points: int = 0
    completion_count: int = 0
    average_score: Optional[float] = None

    # Group-specific statistics
    group_completion_rates: Dict[str, float] = Field(
        default_factory=dict
    )  # {group_id: completion_rate}
    group_average_scores: Dict[str, float] = Field(
        default_factory=dict
    )  # {group_id: average_score}

    # Reference materials
    reference_materials: List[str] = Field(default_factory=list)  # Material IDs

    @validator("id", pre=True)
    def convert_objectid_to_str(cls, v):
        """Convert ObjectId to string"""
        if isinstance(v, ObjectId):
            return str(v)
        return v

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Assignment(AssignmentInDB):
    """Assignment response model"""

    pass


class AssignmentWithProgress(Assignment):
    """Assignment with student progress"""

    student_progress: List[Dict] = Field(default_factory=list)
    completion_rate: float = 0.0


class AssignmentForStudent(BaseModel):
    """Assignment model for student view"""

    id: str
    title: str
    description: Optional[str]
    subject_name: str
    topic: str
    assignment_type: AssignmentType
    due_date: Optional[datetime] = None
    time_limit: Optional[int] = None
    max_attempts: int = 1
    total_points: int = 0
    question_count: int = 0
    status: str = "draft"  # student-specific status
    attempts_used: int = 0
    best_score: Optional[float] = None
    last_attempt: Optional[datetime] = None
    progress_percent: int = 0
    feedback: Optional[str] = None
    submitted_at: Optional[datetime] = None
    graded_at: Optional[datetime] = None
    review_available: bool = False
