"""
Cost Tracking and Quota Management Models
Pydantic models for AI usage cost tracking, quotas, and alerts
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from enum import Enum
from pydantic import BaseModel, Field, validator
from decimal import Decimal


class CostProvider(str, Enum):
    """AI providers for cost tracking"""

    OPENAI = "openai"
    GROQ = "groq"
    GEMINI = "gemini"
    ANTHROPIC = "anthropic"
    OTHER = "other"


class CostModel(str, Enum):
    """AI models for cost tracking"""

    # OpenAI
    GPT_4O = "gpt-4o"
    GPT_4O_MINI = "gpt-4o-mini"
    GPT_4_TURBO = "gpt-4-turbo"
    TEXT_EMBEDDING_3_SMALL = "text-embedding-3-small"
    TEXT_EMBEDDING_3_LARGE = "text-embedding-3-large"

    # Groq
    LLAMA_3_3_70B_VERSATILE = "llama-3.3-70b-versatile"
    LLAMA_3_1_8B_INSTANT = "llama-3.1-8b-instant"

    # Gemini
    GEMINI_1_5_PRO = "gemini-1.5-pro"
    GEMINI_1_5_FLASH = "gemini-1.5-flash"
    GEMINI_2_0_FLASH = "gemini-2.0-flash"
    GEMINI_2_5_FLASH = "gemini-2.5-flash"
    GEMINI_2_5_FLASH_LITE = "gemini-2.5-flash-lite"
    GEMINI_2_5_PRO = "gemini-2.5-pro"
    GEMINI_3_PRO_PREVIEW = "gemini-3-pro-preview"
    TEXT_EMBEDDING_004 = "text-embedding-004"

    # Anthropic
    CLAUDE_3_5_SONNET = "claude-3.5-sonnet"
    CLAUDE_3_5_SONNET_20241022 = "claude-3-5-sonnet-20241022"
    CLAUDE_3_HAIKU = "claude-3-haiku"
    CLAUDE_3_HAIKU_20240307 = "claude-3-haiku-20240307"
    CLAUDE_3_OPUS_20240229 = "claude-3-opus-20240229"
    CLAUDE_SONNET_4_20250514 = "claude-sonnet-4-20250514"

    # Other/Unknown
    OTHER = "other"


class CostPeriod(str, Enum):
    """Cost tracking periods"""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class CostTracking(BaseModel):
    """Individual cost tracking record"""

    tenant_id: str = Field(..., description="Tenant ID")
    provider: CostProvider = Field(..., description="AI provider")
    model: CostModel = Field(..., description="AI model used")
    input_tokens: int = Field(..., ge=0, description="Number of input tokens")
    output_tokens: int = Field(..., ge=0, description="Number of output tokens")
    input_cost: Decimal = Field(..., ge=0, description="Cost for input tokens")
    output_cost: Decimal = Field(..., ge=0, description="Cost for output tokens")
    total_cost: Decimal = Field(..., ge=0, description="Total cost for this request")
    operation: str = Field(
        ...,
        description="Type of operation (question_generation, embedding, chat, etc.)",
    )
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat(), Decimal: lambda v: float(v)}

    @validator("total_cost")
    def validate_total_cost(cls, v, values):
        """Validate that total cost equals input + output cost"""
        if "input_cost" in values and "output_cost" in values:
            expected = values["input_cost"] + values["output_cost"]
            if abs(v - expected) > Decimal("0.000001"):
                raise ValueError(
                    f"Total cost {v} doesn't match sum of input + output costs {expected}"
                )
        return v


class CostQuota(BaseModel):
    """Cost quota configuration for a tenant"""

    tenant_id: str = Field(..., description="Tenant ID")
    tier: str = Field(default="free", description="Tenant tier (free, pro, enterprise)")
    monthly_limit: Decimal = Field(..., gt=0, description="Monthly cost limit in USD")
    daily_limit: Decimal = Field(..., gt=0, description="Daily cost limit in USD")
    alert_threshold: Decimal = Field(
        default=Decimal("0.8"), ge=0.5, le=1.0, description="Alert threshold (0.5-1.0)"
    )
    current_monthly_usage: Decimal = Field(
        default=Decimal("0"), ge=0, description="Current monthly usage"
    )
    current_daily_usage: Decimal = Field(
        default=Decimal("0"), ge=0, description="Current daily usage"
    )
    last_monthly_reset: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    last_daily_reset: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    is_active: bool = Field(default=True, description="Whether quota is active")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = Field(None, description="Last update time")

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat(), Decimal: lambda v: float(v)}

    @property
    def monthly_remaining(self) -> Decimal:
        """Monthly quota remaining"""
        return max(Decimal("0"), self.monthly_limit - self.current_monthly_usage)

    @property
    def daily_remaining(self) -> Decimal:
        """Daily quota remaining"""
        return max(Decimal("0"), self.daily_limit - self.current_daily_usage)

    @property
    def monthly_usage_percentage(self) -> float:
        """Monthly usage as percentage"""
        if self.monthly_limit == 0:
            return 0.0
        return float(self.current_monthly_usage / self.monthly_limit)

    @property
    def daily_usage_percentage(self) -> float:
        """Daily usage as percentage"""
        if self.daily_limit == 0:
            return 0.0
        return float(self.current_daily_usage / self.daily_limit)


class CostAlert(BaseModel):
    """Cost alert for quota exceedance"""

    tenant_id: str = Field(..., description="Tenant ID")
    alert_type: str = Field(
        ...,
        description="Type of alert (daily_quota_warning, monthly_quota_exceeded, etc.)",
    )
    message: str = Field(..., description="Alert message")
    usage_percentage: Decimal = Field(
        ..., ge=0, le=2, description="Usage percentage when alert was triggered"
    )
    current_usage: Decimal = Field(..., ge=0, description="Current usage amount")
    limit: Decimal = Field(..., gt=0, description="Quota limit")
    severity: str = Field(..., description="Alert severity (info, warning, critical)")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    dismissed: bool = Field(default=False, description="Whether alert was dismissed")
    dismissed_at: Optional[datetime] = Field(
        None, description="When alert was dismissed"
    )

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat(), Decimal: lambda v: float(v)}


class UsageMetrics(BaseModel):
    """Usage metrics for a period"""

    tenant_id: str = Field(..., description="Tenant ID")
    period: CostPeriod = Field(..., description="Time period for metrics")
    start_date: datetime = Field(..., description="Start date of period")
    end_date: datetime = Field(..., description="End date of period")
    total_cost: Decimal = Field(..., ge=0, description="Total cost in period")
    total_tokens: int = Field(..., ge=0, description="Total tokens used")
    total_requests: int = Field(..., ge=0, description="Total number of requests")
    breakdown: List[Dict[str, Any]] = Field(
        default_factory=list, description="Breakdown by provider/model/operation"
    )

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat(), Decimal: lambda v: float(v)}

    @property
    def average_cost_per_request(self) -> Decimal:
        """Average cost per request"""
        if self.total_requests == 0:
            return Decimal("0")
        return self.total_cost / Decimal(str(self.total_requests))

    @property
    def average_tokens_per_request(self) -> float:
        """Average tokens per request"""
        if self.total_requests == 0:
            return 0.0
        return self.total_tokens / self.total_requests


class CostTrackingCreate(BaseModel):
    """Request model for creating cost tracking"""

    tenant_id: str = Field(..., description="Tenant ID")
    provider: CostProvider = Field(..., description="AI provider")
    model: CostModel = Field(..., description="AI model used")
    input_tokens: int = Field(..., ge=0, description="Number of input tokens")
    output_tokens: int = Field(..., ge=0, description="Number of output tokens")
    operation: str = Field(..., description="Type of operation")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class CostQuotaCreate(BaseModel):
    """Request model for creating cost quota"""

    tenant_id: str = Field(..., description="Tenant ID")
    tier: str = Field(default="free", description="Tenant tier")
    monthly_limit: Decimal = Field(..., gt=0, description="Monthly cost limit")
    daily_limit: Decimal = Field(..., gt=0, description="Daily cost limit")
    alert_threshold: Decimal = Field(
        default=Decimal("0.8"), ge=0.5, le=1.0, description="Alert threshold"
    )


class CostQuotaUpdate(BaseModel):
    """Request model for updating cost quota"""

    tier: Optional[str] = Field(None, description="Tenant tier")
    monthly_limit: Optional[Decimal] = Field(
        None, gt=0, description="Monthly cost limit"
    )
    daily_limit: Optional[Decimal] = Field(None, gt=0, description="Daily cost limit")
    alert_threshold: Optional[Decimal] = Field(
        None, ge=0.5, le=1.0, description="Alert threshold"
    )
    is_active: Optional[bool] = Field(None, description="Whether quota is active")


class CostEstimate(BaseModel):
    """Cost estimate for an operation"""

    estimated_input_tokens: int = Field(..., ge=0, description="Estimated input tokens")
    estimated_output_tokens: int = Field(
        ..., ge=0, description="Estimated output tokens"
    )
    provider: CostProvider = Field(..., description="AI provider")
    model: CostModel = Field(..., description="AI model")
    operation: str = Field(..., description="Type of operation")

    @property
    def estimated_cost(self) -> Decimal:
        """Calculate estimated cost based on token estimates"""
        # This should use the centralized cost calculation (CostTrackingService).
        # Fail fast so callers don't rely on a misleading placeholder value.
        raise NotImplementedError(
            "estimated_cost not implemented; use CostTrackingService to compute costs"
        )


class CostAnalysis(BaseModel):
    """Detailed cost analysis for a tenant"""

    tenant_id: str = Field(..., description="Tenant ID")
    period: CostPeriod = Field(..., description="Analysis period")
    total_cost: Decimal = Field(..., description="Total cost")
    cost_breakdown_by_provider: Dict[str, Decimal] = Field(
        ..., description="Cost breakdown by provider"
    )
    cost_breakdown_by_model: Dict[str, Decimal] = Field(
        ..., description="Cost breakdown by model"
    )
    cost_breakdown_by_operation: Dict[str, Decimal] = Field(
        ..., description="Cost breakdown by operation"
    )
    usage_trends: List[Dict[str, Any]] = Field(
        ..., description="Usage trends over time"
    )
    recommendations: List[str] = Field(
        ..., description="Cost optimization recommendations"
    )

    class Config:
        json_encoders = {
            Decimal: lambda v: float(v),
            datetime: lambda v: v.isoformat(),
        }
