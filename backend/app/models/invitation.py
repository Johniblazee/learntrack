"""
Invitation models for user invitation system
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from enum import Enum
from bson import ObjectId


class PyObjectId(ObjectId):
    """Custom ObjectId type for Pydantic"""

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, field_schema):
        field_schema.update(type="string")


class InvitationStatus(str, Enum):
    """Invitation status"""

    PENDING = "pending"
    ACCEPTED = "accepted"
    EXPIRED = "expired"
    REVOKED = "revoked"
    REJECTED = "rejected"


class InvitationRole(str, Enum):
    """Role for invitation"""

    STUDENT = "student"
    PARENT = "parent"


class InvitationBase(BaseModel):
    """Base invitation model"""

    invitee_email: EmailStr = Field(
        ..., description="Email address of the person being invited"
    )
    role: InvitationRole = Field(
        ..., description="Role for the invited user (student or parent)"
    )
    invitee_name: Optional[str] = Field(
        None, description="Name of the person being invited"
    )
    message: Optional[str] = Field(None, description="Custom message from the tutor")


class InvitationCreate(InvitationBase):
    """Model for creating an invitation"""

    # For parent invitations, we need to know which students to link
    student_ids: Optional[list[str]] = Field(
        default=[], description="Student IDs to link (for parent invitations)"
    )


class InvitationInDB(InvitationBase):
    """Invitation model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    tutor_id: str = Field(..., description="Tutor who sent the invitation")
    token: str = Field(..., description="Unique invitation token")
    status: InvitationStatus = Field(default=InvitationStatus.PENDING)
    student_ids: list[str] = Field(
        default=[], description="Student IDs to link (for parent invitations)"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = Field(..., description="Expiration date of the invitation")
    accepted_at: Optional[datetime] = Field(
        None, description="When the invitation was accepted"
    )
    revoked_at: Optional[datetime] = Field(
        None, description="When the invitation was revoked"
    )
    rejected_at: Optional[datetime] = Field(
        None, description="When the invitation was rejected"
    )

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class Invitation(BaseModel):
    """Invitation response model"""

    id: str
    tutor_id: str
    invitee_email: EmailStr
    invitee_name: Optional[str] = None
    role: InvitationRole
    status: InvitationStatus
    token: str
    message: Optional[str] = None
    student_ids: list[str] = []
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat() if v else None}
    )


class InvitationVerifyResponse(BaseModel):
    """Response for invitation verification"""

    valid: bool
    invitation: Optional[Invitation] = None
    invited_students: list[dict[str, str]] = []
    error: Optional[str] = None
    tutor_name: Optional[str] = None
    tutor_email: Optional[str] = None


class InvitationAcceptRequest(BaseModel):
    """Request to accept an invitation"""

    token: str
    # User info from Clerk (will be synced)
    clerk_id: str
    email: EmailStr
    name: str
    # For parent invitations, they can select which students to link
    selected_student_ids: Optional[list[str]] = None


class InvitationListResponse(BaseModel):
    """Response for listing invitations"""

    invitations: list[Invitation]
    total: int
    pending: int
    accepted: int
    expired: int
    revoked: int
    rejected: int


class InvitationStats(BaseModel):
    """Statistics for invitations"""

    total_sent: int
    pending: int
    accepted: int
    expired: int
    revoked: int
    rejected: int
    acceptance_rate: float
