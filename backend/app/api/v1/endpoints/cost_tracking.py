"""
Cost Tracking API Endpoints
Provides endpoints for cost tracking, quotas, and usage analytics
"""

from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson.decimal128 import Decimal128

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


def _to_decimal(value: Any) -> Decimal:
    """Safely convert Mongo numeric values to Decimal."""
    if value is None:
        return Decimal("0")

    if isinstance(value, Decimal128):
        return value.to_decimal()

    if isinstance(value, Decimal):
        return value

    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _to_float(value: Any, precision: int = 6) -> float:
    """Safely convert numeric values to rounded float for API responses."""
    decimal_value = _to_decimal(value)
    return round(float(decimal_value), precision)


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

    # Only update if any explicit limits were provided
    if (
        quota_data.monthly_limit is not None
        or quota_data.daily_limit is not None
        or quota_data.alert_threshold is not None
        or quota_data.tier is not None
    ):
        quota = await service.update_quota(
            tenant_id=quota_data.tenant_id,
            monthly_limit=quota_data.monthly_limit,
            daily_limit=quota_data.daily_limit,
            alert_threshold=quota_data.alert_threshold,
            tier=quota_data.tier,
        )

    return quota


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
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)
    return await service.get_usage_metrics(
        tenant_id=current_user.tenant_id,
        period=period,
        start_date=start_date,
        end_date=end_date,
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

    # Verify quota exists before updating
    existing_quota = await service.get_quota(tenant_id)
    if not existing_quota:
        raise HTTPException(status_code=404, detail="Quota not found")

    return await service.update_quota(
        tenant_id=tenant_id,
        monthly_limit=quota_data.monthly_limit,
        daily_limit=quota_data.daily_limit,
        alert_threshold=quota_data.alert_threshold,
        tier=quota_data.tier,
    )


@router.get("/admin/usage-summary")
async def get_admin_usage_summary(
    days: int = Query(30, ge=1, le=365),
    current_user: ClerkUserContext = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get usage summary across all tenants (admin only)
    """
    if not current_user.is_super_admin:
        raise AuthorizationError("admin.analytics.read")

    now = datetime.now(timezone.utc)
    period_start = now - timedelta(days=days)

    base_match_stage = {"$match": {"timestamp": {"$gte": period_start}}}

    # Single $facet pipeline replaces 4 separate aggregation calls (M4)
    facet_pipeline = [
        base_match_stage,
        {
            "$facet": {
                "overall": [
                    {
                        "$group": {
                            "_id": None,
                            "total_cost": {"$sum": "$total_cost"},
                            "total_input_tokens": {"$sum": "$input_tokens"},
                            "total_output_tokens": {"$sum": "$output_tokens"},
                            "total_requests": {"$sum": 1},
                        }
                    }
                ],
                "by_provider": [
                    {
                        "$group": {
                            "_id": "$provider",
                            "total_cost": {"$sum": "$total_cost"},
                            "total_input_tokens": {"$sum": "$input_tokens"},
                            "total_output_tokens": {"$sum": "$output_tokens"},
                            "request_count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"total_cost": -1, "request_count": -1}},
                ],
                "by_operation": [
                    {
                        "$group": {
                            "_id": "$operation",
                            "total_cost": {"$sum": "$total_cost"},
                            "total_input_tokens": {"$sum": "$input_tokens"},
                            "total_output_tokens": {"$sum": "$output_tokens"},
                            "request_count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"total_cost": -1, "request_count": -1}},
                    {"$limit": 10},
                ],
                "top_tenants": [
                    {
                        "$group": {
                            "_id": "$tenant_id",
                            "total_cost": {"$sum": "$total_cost"},
                            "total_input_tokens": {"$sum": "$input_tokens"},
                            "total_output_tokens": {"$sum": "$output_tokens"},
                            "request_count": {"$sum": 1},
                            "last_request_at": {"$max": "$timestamp"},
                        }
                    },
                    {"$sort": {"total_cost": -1, "request_count": -1}},
                    {"$limit": 10},
                ],
            }
        },
    ]

    facet_result = await db.cost_tracking.aggregate(facet_pipeline).to_list(length=1)
    facet_data = facet_result[0] if facet_result else {}
    overall_result = facet_data.get("overall", [])
    provider_breakdown = facet_data.get("by_provider", [])
    operation_breakdown = facet_data.get("by_operation", [])
    top_tenants_raw = facet_data.get("top_tenants", [])

    usage_tenant_ids = await db.cost_tracking.distinct(
        "tenant_id", {"timestamp": {"$gte": period_start}}
    )
    total_tenants = await db.tutors.count_documents({"is_active": True})

    usage_summary = overall_result[0] if overall_result else {}
    total_requests = int(usage_summary.get("total_requests", 0) or 0)
    total_input_tokens = int(usage_summary.get("total_input_tokens", 0) or 0)
    total_output_tokens = int(usage_summary.get("total_output_tokens", 0) or 0)
    total_tokens = total_input_tokens + total_output_tokens
    total_cost = _to_decimal(usage_summary.get("total_cost"))

    tenant_ids = [
        tenant.get("_id")
        for tenant in top_tenants_raw
        if isinstance(tenant.get("_id"), str)
    ]
    tenant_docs = (
        await db.tutors.find(
            {"clerk_id": {"$in": tenant_ids}}, {"clerk_id": 1, "name": 1, "email": 1}
        ).to_list(length=len(tenant_ids))
        if tenant_ids
        else []
    )
    tenant_map = {
        doc.get("clerk_id"): doc for doc in tenant_docs if doc.get("clerk_id")
    }

    top_tenants = []
    for tenant in top_tenants_raw:
        tenant_id = tenant.get("_id")
        if not tenant_id:
            continue

        tenant_info = tenant_map.get(tenant_id, {})
        tenant_input_tokens = int(tenant.get("total_input_tokens", 0) or 0)
        tenant_output_tokens = int(tenant.get("total_output_tokens", 0) or 0)

        top_tenants.append(
            {
                "tenant_id": tenant_id,
                "tenant_name": tenant_info.get("name") or "Unknown Tenant",
                "tenant_email": tenant_info.get("email"),
                "request_count": int(tenant.get("request_count", 0) or 0),
                "total_tokens": tenant_input_tokens + tenant_output_tokens,
                "total_cost_usd": _to_float(tenant.get("total_cost")),
                "last_request_at": tenant.get("last_request_at"),
            }
        )

    provider_usage = []
    for item in provider_breakdown:
        provider_input_tokens = int(item.get("total_input_tokens", 0) or 0)
        provider_output_tokens = int(item.get("total_output_tokens", 0) or 0)
        provider_usage.append(
            {
                "provider": item.get("_id") or "unknown",
                "request_count": int(item.get("request_count", 0) or 0),
                "total_tokens": provider_input_tokens + provider_output_tokens,
                "total_cost_usd": _to_float(item.get("total_cost")),
            }
        )

    operation_usage = []
    for item in operation_breakdown:
        operation_input_tokens = int(item.get("total_input_tokens", 0) or 0)
        operation_output_tokens = int(item.get("total_output_tokens", 0) or 0)
        operation_usage.append(
            {
                "operation": item.get("_id") or "unknown",
                "request_count": int(item.get("request_count", 0) or 0),
                "total_tokens": operation_input_tokens + operation_output_tokens,
                "total_cost_usd": _to_float(item.get("total_cost")),
            }
        )

    quota_docs = await db.cost_quotas.find(
        {},
        {
            "tenant_id": 1,
            "is_active": 1,
            "current_daily_usage": 1,
            "daily_limit": 1,
            "current_monthly_usage": 1,
            "monthly_limit": 1,
            "alert_threshold": 1,
        },
    ).to_list(length=10000)

    total_quotas = len(quota_docs)
    active_quotas = 0
    near_or_over_limit = 0
    over_daily_limit = 0
    over_monthly_limit = 0

    for quota in quota_docs:
        if quota.get("is_active", True):
            active_quotas += 1
        else:
            continue

        daily_usage = _to_decimal(quota.get("current_daily_usage"))
        daily_limit = _to_decimal(quota.get("daily_limit"))
        monthly_usage = _to_decimal(quota.get("current_monthly_usage"))
        monthly_limit = _to_decimal(quota.get("monthly_limit"))
        alert_threshold = _to_decimal(quota.get("alert_threshold"))

        daily_ratio = daily_usage / daily_limit if daily_limit > 0 else Decimal("0")
        monthly_ratio = (
            monthly_usage / monthly_limit if monthly_limit > 0 else Decimal("0")
        )

        if daily_ratio >= Decimal("1"):
            over_daily_limit += 1
        if monthly_ratio >= Decimal("1"):
            over_monthly_limit += 1
        if daily_ratio >= alert_threshold or monthly_ratio >= alert_threshold:
            near_or_over_limit += 1

    return {
        "period_days": days,
        "period_start": period_start,
        "period_end": now,
        "generated_at": now,
        "totals": {
            "total_tenants": total_tenants,
            "tenants_with_usage": len(usage_tenant_ids),
            "total_requests": total_requests,
            "total_tokens": total_tokens,
            "total_cost_usd": _to_float(total_cost),
            "average_cost_per_request_usd": _to_float(
                total_cost / Decimal(total_requests)
                if total_requests > 0
                else Decimal("0")
            ),
        },
        "usage_by_provider": provider_usage,
        "usage_by_operation": operation_usage,
        "top_tenants": top_tenants,
        "quota_health": {
            "total_quotas": total_quotas,
            "active_quotas": active_quotas,
            "tenants_near_or_over_limit": near_or_over_limit,
            "tenants_over_daily_limit": over_daily_limit,
            "tenants_over_monthly_limit": over_monthly_limit,
        },
    }
