"""
Assignment template models for reusable assignment templates
"""

from typing import Optional, List
from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict
from bson import ObjectId
from enum import Enum

from app.models.user import PyObjectId


class TemplateStatus(str, Enum):
    """Status of template"""

    ACTIVE = "active"
    ARCHIVED = "archived"
    DRAFT = "draft"


class AssignmentTemplateBase(BaseModel):
    """Base assignment template model"""

    name: str = Field(..., description="Template name")
    description: Optional[str] = Field(None, description="Template description")
    subject_id: str = Field(..., description="Subject ID")
    question_ids: List[str] = Field(default=[], description="Pre-selected question IDs")

    # Template settings
    duration_minutes: Optional[int] = Field(
        None, description="Assignment duration in minutes"
    )
    passing_score: int = Field(default=70, description="Passing score percentage")
    allow_retakes: bool = Field(default=False, description="Allow students to retake")
    shuffle_questions: bool = Field(
        default=True, description="Shuffle questions for each student"
    )
    show_correct_answers: bool = Field(
        default=True, description="Show correct answers after submission"
    )

    # Additional settings
    instructions: Optional[str] = Field(None, description="Assignment instructions")
    tags: List[str] = Field(default=[], description="Tags for categorization")


class AssignmentTemplateCreate(AssignmentTemplateBase):
    """Assignment template creation model"""

    status: TemplateStatus = Field(default=TemplateStatus.ACTIVE)


class AssignmentTemplateInDB(AssignmentTemplateBase):
    """Assignment template model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str = Field(..., description="Tutor who created the template")
    tenant_id: str = Field(..., description="Tenant ID")
    status: TemplateStatus = Field(default=TemplateStatus.ACTIVE)
    usage_count: int = Field(default=0, description="Number of times template was used")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_used_at: Optional[datetime] = Field(
        None, description="Last time template was used"
    )

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class AssignmentTemplate(BaseModel):
    """Assignment template response model"""

    id: str
    tutor_id: str
    tenant_id: str
    name: str
    description: Optional[str] = None
    subject_id: str
    question_ids: List[str] = []
    duration_minutes: Optional[int] = None
    passing_score: int = 70
    allow_retakes: bool = False
    shuffle_questions: bool = True
    show_correct_answers: bool = True
    instructions: Optional[str] = None
    tags: List[str] = []
    status: TemplateStatus = TemplateStatus.ACTIVE
    usage_count: int = 0
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat() if v else None}
    )


class AssignmentTemplateUpdate(BaseModel):
    """Assignment template update model"""

    name: Optional[str] = None
    description: Optional[str] = None
    subject_id: Optional[str] = None
    question_ids: Optional[List[str]] = None
    duration_minutes: Optional[int] = None
    passing_score: Optional[int] = None
    allow_retakes: Optional[bool] = None
    shuffle_questions: Optional[bool] = None
    show_correct_answers: Optional[bool] = None
    instructions: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[TemplateStatus] = None

    model_config = ConfigDict(json_encoders={ObjectId: str})


class AssignmentTemplateListResponse(BaseModel):
    """Response for listing assignment templates"""

    templates: List[AssignmentTemplate]
    total: int
    active: int
    archived: int
    draft: int


class AssignmentTemplateStats(BaseModel):
    """Statistics for assignment templates"""

    total_templates: int
    active: int
    archived: int
    draft: int
    total_usage: int
    most_used_template: Optional[AssignmentTemplate] = None
