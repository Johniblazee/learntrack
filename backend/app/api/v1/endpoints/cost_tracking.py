"""
Cost Tracking API Endpoints
Provides endpoints for cost tracking, quotas, and usage analytics
"""

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.dependencies import get_database
from app.core.enhanced_auth import ClerkUserContext, get_current_user
from app.ai.models.cost_tracking import (
    CostQuota,
    CostQuotaCreate,
    CostQuotaUpdate,
    UsageMetrics,
    CostPeriod,
    CostTracking,
    CostAlert,
    CostProvider,
    CostModel,
)
from app.ai.services.cost_tracker import CostTrackingService, DEFAULT_QUOTAS
from app.core.exceptions import ValidationError, NotFoundError, AuthorizationError

router = APIRouter()


@router.get("/quota", response_model=CostQuota)
async def get_cost_quota(
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get cost quota for current tenant
    """
    if not current_user.has_permission("billing.read"):
        raise AuthorizationError("billing.read")

    service = CostTrackingService(db)
    quota = await service.get_quota(current_user.tenant_id)

    if not quota:
        # Create default quota
        tier = "pro" if current_user.role == "TUTOR" else "free"
        quota = await service.create_default_quota(current_user.tenant_id, tier)

    return quota


@router.post("/quota", response_model=CostQuota)
async def create_cost_quota(
    quota_data: CostQuotaCreate,
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Create cost quota for tenant
    """
    if not current_user.has_permission("billing.write"):
        raise AuthorizationError("billing.write")

    service = CostTrackingService(db)

    # Enforce tenant-level authorization: only allow creating quotas for your tenant
    if current_user.tenant_id != quota_data.tenant_id:
        raise AuthorizationError("billing.write")

    # Check if quota already exists
    existing = await service.get_quota(quota_data.tenant_id)
    if existing:
        raise HTTPException(
            status_code=400, detail="Quota already exists for this tenant"
        )

    # Create default quota using requested tier, then override limits if provided
    quota = await service.create_default_quota(
        quota_data.tenant_id, tier=quota_data.tier
    )

    # If the request provided explicit limits, update them
    await service.update_quota(
        tenant_id=quota_data.tenant_id,
        monthly_limit=quota_data.monthly_limit,
        daily_limit=quota_data.daily_limit,
        alert_threshold=quota_data.alert_threshold,
        tier=quota_data.tier,
    )

    return await service.get_quota(quota_data.tenant_id)


@router.put("/quota", response_model=CostQuota)
async def update_cost_quota(
    quota_data: CostQuotaUpdate,
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Update cost quota for tenant
    """
    if not current_user.has_permission("billing.write"):
        raise AuthorizationError("billing.write")

    service = CostTrackingService(db)
    return await service.update_quota(
        tenant_id=current_user.tenant_id,
        monthly_limit=quota_data.monthly_limit,
        daily_limit=quota_data.daily_limit,
        alert_threshold=quota_data.alert_threshold,
        tier=quota_data.tier,
    )


@router.get("/usage-metrics", response_model=UsageMetrics)
async def get_usage_metrics(
    period: CostPeriod = Query(CostPeriod.MONTHLY),
    days: int = Query(30, ge=1, le=365),
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get usage metrics for current tenant
    """
    if not current_user.has_permission("billing.read"):
        raise AuthorizationError("billing.read")

    service = CostTrackingService(db)
    return await service.get_usage_metrics(
        tenant_id=current_user.tenant_id, period=period, days=days
    )


@router.get("/usage-history")
async def get_cost_history(
    days: int = Query(30, ge=1, le=365),
    provider: Optional[CostProvider] = Query(None),
    operation: Optional[str] = Query(None),
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get detailed cost history for current tenant
    """
    if not current_user.has_permission("billing.read"):
        raise AuthorizationError("billing.read")

    service = CostTrackingService(db)
    history = await service.get_cost_history(
        tenant_id=current_user.tenant_id,
        days=days,
        provider=provider,
        operation=operation,
    )

    return {"history": history, "count": len(history)}


@router.get("/alerts", response_model=List[CostAlert])
async def get_cost_alerts(
    severity: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get cost alerts for current tenant
    """
    if not current_user.has_permission("billing.read"):
        raise AuthorizationError("billing.read")

    service = CostTrackingService(db)
    return await service.get_alerts(
        tenant_id=current_user.tenant_id, severity=severity, limit=limit
    )


@router.post("/alerts/{alert_id}/dismiss")
async def dismiss_cost_alert(
    alert_id: str,
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Dismiss a cost alert
    """
    if not current_user.has_permission("billing.write"):
        raise AuthorizationError("billing.write")

    service = CostTrackingService(db)
    # Ensure tenant ownership when dismissing alerts
    success = await service.dismiss_alert(alert_id, tenant_id=current_user.tenant_id)

    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"message": "Alert dismissed successfully"}


@router.get("/check-quota")
async def check_cost_quota(
    estimated_cost: float = Query(..., gt=0),
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Check if tenant has sufficient quota for an estimated cost
    """
    if not current_user.has_permission("billing.read"):
        raise AuthorizationError("billing.read")

    from decimal import Decimal

    service = CostTrackingService(db)
    allowed, reason = await service.check_quota(
        tenant_id=current_user.tenant_id, estimated_cost=Decimal(str(estimated_cost))
    )

    return {"allowed": allowed, "reason": reason, "estimated_cost": estimated_cost}


@router.get("/quotas/templates")
async def get_quota_templates(
    current_user: ClerkUserContext = Depends(get_current_user),
):
    """
    Get available quota templates
    """
    if not current_user.has_permission("billing.read"):
        raise AuthorizationError("billing.read")

    return {"templates": DEFAULT_QUOTAS}


# Admin endpoints for super admins
@router.get("/admin/tenants/{tenant_id}/quota", response_model=CostQuota)
async def get_tenant_quota_admin(
    tenant_id: str,
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get quota for a specific tenant (admin only)
    """
    if not current_user.is_super_admin:
        raise AuthorizationError("admin.quota.read")

    service = CostTrackingService(db)
    quota = await service.get_quota(tenant_id)

    if not quota:
        raise HTTPException(status_code=404, detail="Quota not found for tenant")

    return quota


@router.put("/admin/tenants/{tenant_id}/quota", response_model=CostQuota)
async def update_tenant_quota_admin(
    tenant_id: str,
    quota_data: CostQuotaUpdate,
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Update quota for a specific tenant (admin only)
    """
    if not current_user.is_super_admin:
        raise AuthorizationError("admin.quota.write")

    service = CostTrackingService(db)
    return await service.update_quota(
        tenant_id=tenant_id,
        monthly_limit=quota_data.monthly_limit,
        daily_limit=quota_data.daily_limit,
        alert_threshold=quota_data.alert_threshold,
        tier=quota_data.tier,
    )


@router.get("/admin/usage-summary")
async def get_admin_usage_summary(
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get usage summary across all tenants (admin only)
    """
    if not current_user.is_super_admin:
        raise AuthorizationError("admin.analytics.read")

    # This would require additional aggregation queries
    # For now, return a placeholder
    return {
        "message": "Admin usage summary not yet implemented",
        "todo": "Add aggregation queries for cross-tenant analytics",
    }
