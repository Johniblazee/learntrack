"""
Student models and schemas
"""

from datetime import datetime, timezone
from typing import Optional, List, Union
from pydantic import BaseModel, Field, EmailStr, field_validator, ConfigDict
from bson import ObjectId

from app.models.user import PyObjectId


class StudentBase(BaseModel):
    name: str = Field(..., description="Student's full name", example="John Smith")
    email: EmailStr = Field(
        ..., description="Student's email address", example="john.smith@example.com"
    )
    phone: Optional[str] = Field(
        None, description="Student's phone number", example="+1-555-0123"
    )
    grade: Optional[str] = Field(
        None, description="Student's grade level", example="10th"
    )
    subjects: List[str] = Field(
        default_factory=list,
        description="List of subjects the student is enrolled in",
        example=["Mathematics", "Science"],
    )
    status: str = Field(
        default="active", description="Student's enrollment status", example="active"
    )
    parentEmail: Optional[str] = Field(
        None, description="Parent's email address", example="parent@example.com"
    )
    parentPhone: Optional[str] = Field(
        None, description="Parent's phone number", example="+1-555-0456"
    )
    averageScore: float = Field(
        default=0.0,
        description="Student's average score across all assignments",
        example=85.5,
    )
    completionRate: float = Field(
        default=0.0, description="Percentage of assignments completed", example=92.3
    )
    totalAssignments: int = Field(
        default=0, description="Total number of assignments given", example=15
    )
    completedAssignments: int = Field(
        default=0, description="Number of assignments completed", example=14
    )
    notes: Optional[str] = Field(
        None,
        description="Additional notes about the student",
        example="Excellent progress in mathematics",
    )
    tutor_id: str = Field(
        ..., description="Tutor ID - references the tutor's Clerk user ID"
    )
    parent_ids: List[str] = Field(
        default_factory=list,
        description="List of parent Clerk user IDs who can access this student",
    )

    @field_validator("parentEmail")
    @classmethod
    def validate_parent_email(cls, v):
        if v is None or v == "":
            return None
        # Validate as email if not empty
        from pydantic import ValidationError

        try:
            EmailStr._validate(v, None)
            return v
        except ValidationError:
            raise ValueError("Invalid email format")


class StudentCreate(StudentBase):
    """Schema for creating a new student"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Jane Doe",
                "email": "jane.doe@example.com",
                "phone": "+1-555-0789",
                "grade": "11th",
                "subjects": ["Physics", "Chemistry"],
                "parentEmail": "parent.doe@example.com",
                "parentPhone": "+1-555-0987",
                "notes": "Interested in STEM subjects",
            }
        }
    )


class StudentUpdate(BaseModel):
    """Schema for updating an existing student"""

    name: Optional[str] = Field(
        None, description="Student's full name", example="John Smith"
    )
    email: Optional[EmailStr] = Field(
        None, description="Student's email address", example="john.smith@example.com"
    )
    phone: Optional[str] = Field(
        None, description="Student's phone number", example="+1-555-0123"
    )
    grade: Optional[str] = Field(
        None, description="Student's grade level", example="10th"
    )
    subjects: Optional[List[str]] = Field(
        None, description="List of subjects", example=["Mathematics", "Science"]
    )
    status: Optional[str] = None
    parentEmail: Optional[str] = None
    parentPhone: Optional[str] = None
    averageScore: Optional[float] = None
    completionRate: Optional[float] = None
    totalAssignments: Optional[int] = None
    completedAssignments: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("parentEmail")
    @classmethod
    def validate_parent_email(cls, v):
        if v is None or v == "":
            return None
        # Validate as email if not empty
        from pydantic import ValidationError

        try:
            EmailStr._validate(v, None)
            return v
        except ValidationError:
            raise ValueError("Invalid email format")


class StudentInDB(StudentBase):
    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    enrollmentDate: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    lastActivity: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Student(StudentInDB):
    pass


class StudentGroupBase(BaseModel):
    name: str
    description: str = ""
    studentIds: List[str] = Field(default_factory=list)
    subjects: List[str] = Field(default_factory=list)
    color: str = "blue"
    imageUrl: Optional[str] = Field(None, description="URL to the group's cover image")

    @field_validator("name", mode="before")
    @classmethod
    def normalize_group_name(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("Group name is required")
        return normalized

    @field_validator("description", mode="before")
    @classmethod
    def normalize_group_description(cls, value: Optional[str]) -> str:
        return str(value or "").strip()

    @field_validator("studentIds", mode="before")
    @classmethod
    def normalize_group_student_ids(cls, value: Optional[List[str]]) -> List[str]:
        if not value:
            return []

        normalized_ids: List[str] = []
        seen: set[str] = set()
        for item in value:
            normalized = str(item or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_ids.append(normalized)
        return normalized_ids

    @field_validator("subjects", mode="before")
    @classmethod
    def normalize_group_subjects(cls, value: Optional[List[str]]) -> List[str]:
        if not value:
            return []

        normalized_subjects: List[str] = []
        seen: set[str] = set()
        for item in value:
            normalized = str(item or "").strip()
            if not normalized:
                continue
            lowered = normalized.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            normalized_subjects.append(normalized)
        return normalized_subjects

    @field_validator("color")
    @classmethod
    def validate_group_color(cls, value: str) -> str:
        normalized = str(value or "blue").strip().lower() or "blue"
        allowed_colors = {
            "blue",
            "green",
            "purple",
            "orange",
            "red",
            "pink",
            "yellow",
            "indigo",
        }
        if normalized not in allowed_colors:
            raise ValueError("Invalid group color")
        return normalized

    @field_validator("imageUrl", mode="before")
    @classmethod
    def normalize_group_image(cls, value: Optional[str]) -> Optional[str]:
        normalized = str(value or "").strip()
        return normalized or None


class StudentGroupCreate(StudentGroupBase):
    pass


class StudentGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    studentIds: Optional[List[str]] = None
    subjects: Optional[List[str]] = None
    color: Optional[str] = None
    imageUrl: Optional[str] = None

    @field_validator("name", mode="before")
    @classmethod
    def normalize_optional_group_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Group name is required")
        return normalized

    @field_validator("description", mode="before")
    @classmethod
    def normalize_optional_group_description(
        cls, value: Optional[str]
    ) -> Optional[str]:
        if value is None:
            return None
        return str(value).strip()

    @field_validator("studentIds", mode="before")
    @classmethod
    def normalize_optional_group_student_ids(
        cls, value: Optional[List[str]]
    ) -> Optional[List[str]]:
        if value is None:
            return None
        return StudentGroupBase.normalize_group_student_ids(value)

    @field_validator("subjects", mode="before")
    @classmethod
    def normalize_optional_group_subjects(
        cls, value: Optional[List[str]]
    ) -> Optional[List[str]]:
        if value is None:
            return None
        return StudentGroupBase.normalize_group_subjects(value)

    @field_validator("color")
    @classmethod
    def validate_optional_group_color(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return StudentGroupBase.validate_group_color(value)

    @field_validator("imageUrl", mode="before")
    @classmethod
    def normalize_optional_group_image(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return StudentGroupBase.normalize_group_image(value)


class StudentGroupInDB(StudentGroupBase):
    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str = Field(
        ..., description="Tutor ID - references the tutor's Clerk user ID"
    )
    createdDate: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Coerce legacy ObjectId values to strings for compatibility
    @field_validator("id", mode="before")
    @classmethod
    def validate_object_id(cls, v):
        if isinstance(v, ObjectId):
            return str(v)
        return v

    @field_validator("studentIds", mode="before")
    @classmethod
    def validate_student_ids(cls, v):
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) if isinstance(x, ObjectId) else x for x in v]
        return v

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class StudentGroup(StudentGroupInDB):
    pass
