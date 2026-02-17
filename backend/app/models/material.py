"""
Reference Material models and schemas
"""

from datetime import datetime, timezone
from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict
from bson import ObjectId

from app.models.user import PyObjectId


class MaterialType(str, Enum):
    """Material type"""

    PDF = "pdf"
    DOC = "doc"
    VIDEO = "video"
    LINK = "link"
    IMAGE = "image"
    OTHER = "other"


class MaterialStatus(str, Enum):
    """Material status"""

    ACTIVE = "active"
    ARCHIVED = "archived"
    DRAFT = "draft"


class MaterialBase(BaseModel):
    """Base material model"""

    title: str
    description: Optional[str] = None
    material_type: MaterialType
    file_url: Optional[str] = None  # UploadThing URL or external link
    file_size: Optional[int] = None  # in bytes
    subject_id: Optional[str] = None
    topic: Optional[str] = None
    tags: List[str] = []
    tutor_id: str = Field(
        ..., description="Tutor ID - references the tutor's Clerk user ID"
    )


class MaterialCreate(MaterialBase):
    """Material creation model"""

    tutor_id: Optional[str] = None
    shared_with_students: bool = True


class MaterialUpdate(BaseModel):
    """Material update model"""

    title: Optional[str] = None
    description: Optional[str] = None
    material_type: Optional[MaterialType] = None
    file_url: Optional[str] = None
    file_size: Optional[int] = None
    subject_id: Optional[str] = None
    topic: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[MaterialStatus] = None
    shared_with_students: Optional[bool] = None


class MaterialInDB(MaterialBase):
    """Material model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    status: MaterialStatus = MaterialStatus.ACTIVE
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Usage tracking
    view_count: int = 0
    download_count: int = 0

    # Relationships
    linked_questions: List[str] = []  # Question IDs
    linked_assignments: List[str] = []  # Assignment IDs

    # Access control
    shared_with_students: bool = True  # Whether students can access

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Material(MaterialInDB):
    """Material response model"""

    pass


class MaterialWithStats(Material):
    """Material with usage statistics"""

    total_views: int = 0
    total_downloads: int = 0
    linked_questions_count: int = 0
    linked_assignments_count: int = 0
