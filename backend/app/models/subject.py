"""
Subject models and schemas
"""

from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator
from bson import ObjectId

from app.models.user import PyObjectId


class SubjectBase(BaseModel):
    """Base subject model"""

    name: str
    description: Optional[str] = None
    topics: List[str] = []


class SubjectCreate(SubjectBase):
    """Subject creation model"""

    tutor_id: Optional[str] = None


class SubjectUpdate(BaseModel):
    """Subject update model"""

    name: Optional[str] = None
    description: Optional[str] = None
    topics: Optional[List[str]] = None


class SubjectInDB(SubjectBase):
    """Subject model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    question_count: int = 0
    is_active: bool = True

    @field_validator("id", mode="before")
    @classmethod
    def validate_object_id(cls, v):
        if isinstance(v, ObjectId):
            return str(v)
        return v

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Subject(SubjectInDB):
    """Subject response model"""

    pass


class SubjectWithStats(Subject):
    """Subject with statistics"""

    total_questions: int = 0
    active_assignments: int = 0
    total_students: int = 0
