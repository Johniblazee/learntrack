"""
Admin models for super admin functionality
"""

from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from bson import ObjectId

from app.models.user import PyObjectId, AdminPermission


class TenantStatus(str, Enum):
    """Tenant status options"""

    ACTIVE = "active"
    SUSPENDED = "suspended"
    PENDING = "pending"
    TRIAL = "trial"
    EXPIRED = "expired"


class TenantInfo(BaseModel):
    """Tenant (tutor) information for admin view"""

    id: PyObjectId = Field(alias="_id")
    clerk_id: str
    email: EmailStr
    name: str
    status: TenantStatus = TenantStatus.ACTIVE
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None

    # Statistics
    students_count: int = 0
    parents_count: int = 0
    subjects_count: int = 0
    questions_count: int = 0
    assignments_count: int = 0

    # Settings
    subscription_tier: str = "free"
    storage_used_mb: float = 0.0
    storage_limit_mb: float = 500.0

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class TenantListResponse(BaseModel):
    """Response for tenant list endpoint"""

    tenants: List[TenantInfo]
    total: int
    page: int
    per_page: int
    total_pages: int


class TenantUsageSummary(BaseModel):
    """Recent AI usage snapshot for a tenant"""

    period_days: int = 30
    total_requests: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    last_request_at: Optional[datetime] = None
    top_provider: Optional[str] = None
    top_model: Optional[str] = None


class TenantQuotaSummary(BaseModel):
    """Quota status snapshot for a tenant"""

    tier: str = "free"
    is_active: bool = True
    daily_limit_usd: float = 0.0
    daily_usage_usd: float = 0.0
    monthly_limit_usd: float = 0.0
    monthly_usage_usd: float = 0.0
    alert_threshold: float = 0.8
    near_limit: bool = False
    over_limit: bool = False


class TenantStudentSummary(BaseModel):
    """Student summary shown inside a tenant workspace"""

    id: PyObjectId = Field(alias="_id")
    clerk_id: str
    name: str
    email: str = ""
    status: str = "active"
    is_active: bool = True
    grade: Optional[str] = None
    parents_count: int = 0
    total_assignments: int = 0
    completed_assignments: int = 0
    completion_rate: float = 0.0
    average_score: float = 0.0
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class TenantParentSummary(BaseModel):
    """Parent summary shown inside a tenant workspace"""

    id: PyObjectId = Field(alias="_id")
    clerk_id: str
    name: str
    email: str = ""
    status: str = "active"
    is_active: bool = True
    children_count: int = 0
    child_names: List[str] = []
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class TenantStudentListResponse(BaseModel):
    """Paginated tenant student roster"""

    students: List[TenantStudentSummary]
    total: int
    page: int
    per_page: int
    total_pages: int


class TenantParentListResponse(BaseModel):
    """Paginated tenant parent roster"""

    parents: List[TenantParentSummary]
    total: int
    page: int
    per_page: int
    total_pages: int


class TenantDetailsResponse(TenantInfo):
    """Expanded tenant detail response for the admin workspace"""

    active_students_count: int = 0
    active_parents_count: int = 0
    materials_count: int = 0
    pending_invitations_count: int = 0
    usage_summary: Optional[TenantUsageSummary] = None
    quota_summary: Optional[TenantQuotaSummary] = None


class TenantSuspendRequest(BaseModel):
    """Request to suspend a tenant"""

    reason: str
    notify_users: bool = True


class TenantActivateRequest(BaseModel):
    """Request to activate a tenant"""

    reason: Optional[str] = None
    notify_users: bool = True


class SystemMetrics(BaseModel):
    """System-wide metrics for admin dashboard"""

    # User counts
    total_tutors: int = 0
    total_students: int = 0
    total_parents: int = 0
    total_users: int = 0

    # Active users (logged in last 30 days)
    active_tutors: int = 0
    active_students: int = 0
    active_parents: int = 0

    # Content metrics
    total_questions: int = 0
    total_assignments: int = 0
    total_subjects: int = 0
    total_materials: int = 0

    # System health
    database_size_mb: float = 0.0
    storage_used_mb: float = 0.0

    # Activity metrics
    questions_generated_today: int = 0
    assignments_created_today: int = 0
    logins_today: int = 0

    # Time period
    metrics_updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class AuditAction(str, Enum):
    """Types of admin actions to audit"""

    # Tenant actions
    TENANT_VIEWED = "tenant_viewed"
    TENANT_SUSPENDED = "tenant_suspended"
    TENANT_ACTIVATED = "tenant_activated"
    TENANT_DELETED = "tenant_deleted"

    # User actions
    USER_VIEWED = "user_viewed"
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DELETED = "user_deleted"
    USER_ROLE_CHANGED = "user_role_changed"

    # System actions
    SETTINGS_CHANGED = "settings_changed"
    FEATURE_FLAG_TOGGLED = "feature_flag_toggled"
    DATA_EXPORTED = "data_exported"

    # Security actions
    ADMIN_LOGIN = "admin_login"
    ADMIN_PERMISSION_CHANGED = "admin_permission_changed"

    # Impersonation actions
    IMPERSONATION_STARTED = "impersonation_started"
    IMPERSONATION_ENDED = "impersonation_ended"

    # Batch operation actions
    BATCH_USERS_ACTIVATED = "batch_users_activated"
    BATCH_USERS_DEACTIVATED = "batch_users_deactivated"
    BATCH_USERS_DELETED = "batch_users_deleted"
    BATCH_TENANTS_SUSPENDED = "batch_tenants_suspended"
    BATCH_TENANTS_ACTIVATED = "batch_tenants_activated"


class AuditLog(BaseModel):
    """Audit log entry for admin actions"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    admin_id: str  # Clerk ID of admin who performed action
    admin_email: str
    action: AuditAction
    target_type: str  # "tenant", "user", "settings", etc.
    target_id: Optional[str] = None
    details: Dict[str, Any] = {}
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class AuditLogListResponse(BaseModel):
    """Response for audit log list endpoint"""

    logs: List[AuditLog]
    total: int
    page: int
    per_page: int


class ImpersonationSession(BaseModel):
    """Represents an active impersonation session"""

    session_id: str
    admin_clerk_id: str
    admin_email: str
    target_user_id: str
    target_clerk_id: str
    target_email: str
    target_name: str
    target_role: str
    target_tutor_id: Optional[str] = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime


class ImpersonationStartRequest(BaseModel):
    """Request to start impersonating a user"""

    target_user_id: str  # MongoDB _id or clerk_id of the user to impersonate


class ImpersonationResponse(BaseModel):
    """Response containing impersonation session details"""

    session_id: str
    target_user: Dict[str, Any]
    expires_in_minutes: int = 60
    message: str


# ============== Batch Operations Models ==============


class BatchOperationType(str, Enum):
    """Types of batch operations"""

    ACTIVATE = "activate"
    DEACTIVATE = "deactivate"
    DELETE = "delete"
    SUSPEND = "suspend"


class BatchUserOperationRequest(BaseModel):
    """Request for batch user operations"""

    user_ids: List[str]  # List of clerk_ids or MongoDB _ids
    operation: BatchOperationType
    reason: Optional[str] = None
    notify_users: bool = False


class BatchTenantOperationRequest(BaseModel):
    """Request for batch tenant operations"""

    tenant_ids: List[str]  # List of clerk_ids or MongoDB _ids
    operation: BatchOperationType
    reason: Optional[str] = None
    notify_users: bool = True


class BatchOperationResult(BaseModel):
    """Result of a single item in a batch operation"""

    id: str
    success: bool
    error: Optional[str] = None


class BatchOperationResponse(BaseModel):
    """Response for batch operations"""

    operation: BatchOperationType
    total_requested: int
    successful: int
    failed: int
    results: List[BatchOperationResult]
    message: str
