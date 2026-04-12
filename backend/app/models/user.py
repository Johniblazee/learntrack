"""
User models and schemas
"""

from datetime import datetime, timezone
from typing import Optional, List, Any
from enum import Enum
from pydantic import BaseModel, Field, EmailStr, field_validator, ConfigDict
from bson import ObjectId


class UserRole(str, Enum):
    """User roles in the system"""

    TUTOR = "tutor"
    STUDENT = "student"
    PARENT = "parent"
    SUPER_ADMIN = "super_admin"


class AccountStatus(str, Enum):
    """Lifecycle state for tutor-managed student accounts."""

    PROVISIONED = "provisioned"
    INVITED = "invited"
    CLAIMED = "claimed"


class AdminPermission(str, Enum):
    """Granular permissions for super admin users"""

    # Tenant management
    VIEW_ALL_TENANTS = "view_all_tenants"
    MANAGE_TENANTS = "manage_tenants"
    SUSPEND_TENANTS = "suspend_tenants"

    # User management
    VIEW_ALL_USERS = "view_all_users"
    MANAGE_USERS = "manage_users"
    CREATE_TUTORS = "create_tutors"
    DELETE_USERS = "delete_users"

    # System settings
    MANAGE_SYSTEM_SETTINGS = "manage_system_settings"
    MANAGE_AI_PROVIDERS = "manage_ai_providers"
    MANAGE_FEATURE_FLAGS = "manage_feature_flags"

    # Analytics & reporting
    VIEW_ANALYTICS = "view_analytics"
    EXPORT_DATA = "export_data"

    # Audit & security
    VIEW_AUDIT_LOGS = "view_audit_logs"
    MANAGE_SECURITY = "manage_security"

    # Full access
    FULL_ACCESS = "full_access"


class StudentProfileData(BaseModel):
    """Student-specific profile fields stored on student users."""

    phone: Optional[str] = None
    grade: Optional[str] = None
    parentName: Optional[str] = None
    parentEmail: Optional[EmailStr] = None
    averageScore: float = 0.0
    completionRate: float = 0.0
    totalAssignments: int = 0
    completedAssignments: int = 0
    notes: Optional[str] = None
    interests: List[str] = Field(default_factory=list)


class StudentProfileUpdate(BaseModel):
    """Partial student profile update payload."""

    phone: Optional[str] = None
    grade: Optional[str] = None
    parentName: Optional[str] = None
    parentEmail: Optional[EmailStr] = None
    averageScore: Optional[float] = None
    completionRate: Optional[float] = None
    totalAssignments: Optional[int] = None
    completedAssignments: Optional[int] = None
    notes: Optional[str] = None
    interests: Optional[List[str]] = None


# Use string type for ObjectId to avoid Pydantic v2 compatibility issues
PyObjectId = str


class UserBase(BaseModel):
    """Base user model"""

    email: EmailStr
    name: str
    role: UserRole
    is_active: bool = True
    slug: Optional[str] = None  # URL-friendly slug (e.g., "john-doe")


class UserCreate(UserBase):
    """User creation model"""

    clerk_id: Optional[str] = None
    tutor_id: Optional[str] = None  # Will be set automatically for tutors
    tenant_id: Optional[str] = None  # Tenant ID for multi-tenancy


class UserUpdate(BaseModel):
    """User update model"""

    email: Optional[EmailStr] = None
    name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    student_profile: Optional[StudentProfileUpdate] = None
    # Convenience aliases used by onboarding/profile forms
    phone: Optional[str] = None
    grade: Optional[str] = None
    parentName: Optional[str] = None
    parentEmail: Optional[EmailStr] = None
    notes: Optional[str] = None
    interests: Optional[List[str]] = None
    updated_at: Optional[datetime] = None


class UserInDB(UserBase):
    """User model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    clerk_id: Optional[str] = None
    tutor_id: Optional[str] = (
        None  # Tutor ID - for tutors: their own clerk_id, for others: their tutor's clerk_id
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login: Optional[datetime] = None
    account_status: Optional[AccountStatus] = None
    claimed_at: Optional[datetime] = None
    last_invited_at: Optional[datetime] = None
    invitation_sent_count: int = 0
    onboarding_completed: bool = False

    # Super admin fields
    is_super_admin: bool = False  # Flag for super admin users
    admin_permissions: List[AdminPermission] = []  # Granular admin permissions

    # Role-specific fields
    tutor_subjects: Optional[List[str]] = []  # Subject IDs for tutors
    student_tutors: Optional[List[str]] = []  # Tutor IDs for students
    parent_children: Optional[List[str]] = []  # Student IDs for parents
    student_ids: List[str] = []  # For parents: linked student IDs
    student_profile: Optional[StudentProfileData] = None

    @field_validator("id", mode="before")
    @classmethod
    def validate_object_id(cls, v):
        """Convert ObjectId to string for Pydantic validation"""
        if isinstance(v, ObjectId):
            return str(v)
        return v

    @field_validator("tutor_id", mode="before")
    @classmethod
    def migrate_tutor_id(cls, v, info):
        """Migrate tutor_id for existing users - set to clerk_id for tutors, None for others"""
        if v is None and info.data.get("role") == UserRole.TUTOR:
            # For tutors without tutor_id, use their clerk_id
            return info.data.get("clerk_id")
        return v

    @field_validator("account_status", mode="before")
    @classmethod
    def derive_account_status(cls, v, info):
        if v is not None:
            return v

        role = info.data.get("role")
        clerk_id = info.data.get("clerk_id")
        if role == UserRole.STUDENT:
            return AccountStatus.CLAIMED if clerk_id else AccountStatus.PROVISIONED
        return AccountStatus.CLAIMED if clerk_id else None

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class User(UserInDB):
    """User response model"""

    pass


class UserProfile(BaseModel):
    """User profile for frontend"""

    id: str
    email: str
    name: str
    role: UserRole
    is_active: bool
    created_at: datetime

    # Role-specific data
    subjects_count: Optional[int] = 0
    students_count: Optional[int] = 0
    children_count: Optional[int] = 0


class StudentAssignment(BaseModel):
    """Student assignment relationship"""

    student_id: str
    tutor_id: str
    assigned_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_active: bool = True


class ParentChildRelation(BaseModel):
    """Parent-child relationship"""

    parent_id: str
    child_id: str
    relation_type: str = "parent"  # parent, guardian, etc.
    assigned_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_active: bool = True
