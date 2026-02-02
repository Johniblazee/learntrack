"""
Admin audit log models for tracking system activity
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field, ConfigDict
from bson import ObjectId
from enum import Enum

from app.models.user import PyObjectId


class AuditLogMethod(str, Enum):
    """HTTP methods for audit logging"""

    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"


class AuditLogBase(BaseModel):
    """Base audit log model"""

    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    user_id: str = Field(..., description="User's Clerk ID who performed the action")
    user_email: Optional[str] = Field(None, description="User's email address")
    user_name: Optional[str] = Field(None, description="User's name")
    method: str = Field(
        ..., description="HTTP method or action type (GET, POST, LOGIN, etc.)"
    )
    resource: str = Field(
        ..., description="Resource being accessed (e.g., 'users', 'assignments')"
    )
    resource_id: Optional[str] = Field(
        None, description="ID of specific resource if applicable"
    )
    status_code: int = Field(..., description="HTTP response status code")
    duration_ms: int = Field(default=0, description="Request duration in milliseconds")
    ip_address: Optional[str] = Field(None, description="Client IP address")
    user_agent: Optional[str] = Field(None, description="Client user agent string")
    tenant_id: Optional[str] = Field(
        None, description="Tenant ID for multi-tenant systems"
    )
    endpoint: str = Field(..., description="API endpoint path")
    query_params: Optional[Dict[str, Any]] = Field(None, description="Query parameters")
    details: Optional[Dict[str, Any]] = Field(
        None, description="Additional details about the request"
    )


class AuditLogCreate(AuditLogBase):
    """Audit log creation model"""

    pass


class AuditLogInDB(AuditLogBase):
    """Audit log model as stored in database"""

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )


class AuditLog(BaseModel):
    """Audit log response model for API"""

    id: str = Field(..., alias="_id")
    timestamp: datetime
    user_id: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    method: str
    resource: str
    resource_id: Optional[str] = None
    status_code: int
    duration_ms: int
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    tenant_id: Optional[str] = None
    endpoint: str
    query_params: Optional[Dict[str, Any]] = None
    details: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(
        populate_by_name=True,
        json_encoders={datetime: lambda v: v.isoformat() if v else None, ObjectId: str},
    )


class AuditLogFilter(BaseModel):
    """Filter parameters for audit log queries"""

    method: Optional[str] = None
    resource: Optional[str] = None
    user_id: Optional[str] = None
    status_code: Optional[int] = None
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None
    tenant_id: Optional[str] = None


class PaginatedAuditLogResponse(BaseModel):
    """Paginated response for audit logs"""

    activities: List[AuditLog]
    total: int
    page: int
    per_page: int
    total_pages: int


class AuditLogSummary(BaseModel):
    """Summary statistics for audit logs"""

    total_requests: int
    unique_users: int
    avg_response_time_ms: float
    error_rate: float
    top_resources: List[Dict[str, Any]]
    top_users: List[Dict[str, Any]]
