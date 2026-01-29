"""
AI Cost Tracking and Quota Management Service
Tracks AI usage costs per tenant with configurable quotas and alerts
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple
from decimal import Decimal
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.ai.models.cost_tracking import (
    CostTracking,
    CostQuota,
    CostAlert,
    UsageMetrics,
    CostProvider,
    CostModel,
    CostPeriod,
)
from app.core.config import settings
from app.core.exceptions import ValidationError, NotFoundError

logger = structlog.get_logger()

# Cost per token for different models (in USD)
MODEL_COSTS: Dict[str, Dict[str, Dict[str, Decimal]]] = {
    "openai": {
        "gpt-4o": {
            "input": Decimal("0.000005"),  # $0.005 per 1K tokens
            "output": Decimal("0.000015"),  # $0.015 per 1K tokens
        },
        "gpt-4o-mini": {
            "input": Decimal("0.00000015"),  # $0.00015 per 1K tokens
            "output": Decimal("0.0000006"),  # $0.0006 per 1K tokens
        },
        "gpt-4-turbo": {
            "input": Decimal("0.00001"),  # $0.01 per 1K tokens
            "output": Decimal("0.00003"),  # $0.03 per 1K tokens
        },
        "text-embedding-3-small": {
            "input": Decimal("0.00000002"),  # $0.00002 per 1K tokens
            "output": Decimal("0"),
        },
        "text-embedding-3-large": {
            "input": Decimal("0.00000013"),  # $0.00013 per 1K tokens
            "output": Decimal("0"),
        },
    },
    "groq": {
        "llama-3.3-70b-versatile": {
            "input": Decimal("0.00000059"),  # $0.00059 per 1K tokens
            "output": Decimal("0.00000079"),  # $0.00079 per 1K tokens
        },
        "llama-3.1-8b-instant": {
            "input": Decimal("0.00000005"),  # $0.00005 per 1K tokens
            "output": Decimal("0.00000008"),  # $0.00008 per 1K tokens
        },
    },
    "gemini": {
        "gemini-1.5-pro": {
            "input": Decimal("0.00125"),  # $1.25 per 1M tokens
            "output": Decimal("0.00375"),  # $3.75 per 1M tokens
        },
        "gemini-1.5-flash": {
            "input": Decimal("0.000075"),  # $0.075 per 1M tokens
            "output": Decimal("0.00015"),  # $0.15 per 1M tokens
        },
        "text-embedding-004": {
            "input": Decimal("0.000025"),  # $0.025 per 1M tokens
            "output": Decimal("0"),
        },
    },
    "anthropic": {
        "claude-3.5-sonnet": {
            "input": Decimal("0.000003"),  # $3.00 per 1M tokens
            "output": Decimal("0.000015"),  # $15.00 per 1M tokens
        },
        "claude-3-haiku": {
            "input": Decimal("0.00000025"),  # $0.25 per 1M tokens
            "output": Decimal("0.00000125"),  # $1.25 per 1M tokens
        },
    },
}

# Default quotas by tenant tier
DEFAULT_QUOTAS: Dict[str, Dict[str, Any]] = {
    "free": {
        "monthly_limit": Decimal("10.00"),  # $10 per month
        "daily_limit": Decimal("1.00"),  # $1 per day
        "alert_threshold": Decimal("0.80"),  # Alert at 80%
    },
    "pro": {
        "monthly_limit": Decimal("100.00"),  # $100 per month
        "daily_limit": Decimal("10.00"),  # $10 per day
        "alert_threshold": Decimal("0.85"),  # Alert at 85%
    },
    "enterprise": {
        "monthly_limit": Decimal("1000.00"),  # $1000 per month
        "daily_limit": Decimal("100.00"),  # $100 per day
        "alert_threshold": Decimal("0.90"),  # Alert at 90%
    },
}


class CostTrackingService:
    """Service for tracking AI costs and managing quotas"""

    COLLECTION_NAME = "cost_tracking"
    QUOTA_COLLECTION = "cost_quotas"
    ALERTS_COLLECTION = "cost_alerts"

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.cost_collection = database[self.COLLECTION_NAME]
        self.quota_collection = database[self.QUOTA_COLLECTION]
        self.alerts_collection = database[self.ALERTS_COLLECTION]

    async def track_usage(
        self,
        tenant_id: str,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        operation: str,  # "question_generation", "embedding", "chat", etc.
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CostTracking:
        """
        Track AI usage and calculate costs

        Args:
            tenant_id: Tenant identifier
            provider: AI provider (openai, groq, etc.)
            model: Model name
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            operation: Type of operation
            metadata: Additional metadata

        Returns:
            CostTracking record
        """
        # Calculate costs
        input_cost = self._calculate_cost(provider, model, input_tokens, "input")
        output_cost = self._calculate_cost(provider, model, output_tokens, "output")
        total_cost = input_cost + output_cost

        # Create cost record
        cost_record = CostTracking(
            tenant_id=tenant_id,
            provider=CostProvider(provider),
            model=CostModel(model),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_cost=input_cost,
            output_cost=output_cost,
            total_cost=total_cost,
            operation=operation,
            timestamp=datetime.now(timezone.utc),
            metadata=metadata or {},
        )

        # Store in database
        await self.cost_collection.insert_one(cost_record.model_dump())

        logger.info(
            "Tracked AI usage",
            tenant_id=tenant_id,
            provider=provider,
            model=model,
            operation=operation,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_cost=float(total_cost),
        )

        # Check quota and send alerts if needed
        await self._check_quota_and_alerts(tenant_id, total_cost)

        return cost_record

    def _calculate_cost(
        self, provider: str, model: str, tokens: int, token_type: str
    ) -> Decimal:
        """Calculate cost for given tokens"""
        provider_costs = MODEL_COSTS.get(provider, {})
        model_costs = provider_costs.get(model, {})
        cost_per_token = model_costs.get(token_type, Decimal("0"))

        # Convert to cost per token (costs are stored per 1K or 1M tokens)
        if provider in ["openai", "anthropic", "groq"]:
            # Costs are per 1K tokens
            cost_per_token = cost_per_token / Decimal("1000")
        elif provider == "gemini":
            # Costs are per 1M tokens
            cost_per_token = cost_per_token / Decimal("1000000")

        return cost_per_token * Decimal(str(tokens))

    async def get_quota(self, tenant_id: str) -> Optional[CostQuota]:
        """Get quota configuration for tenant"""
        quota_doc = await self.quota_collection.find_one({"tenant_id": tenant_id})
        if quota_doc:
            quota_doc["_id"] = str(quota_doc["_id"])
            return CostQuota(**quota_doc)
        return None

    async def create_default_quota(
        self, tenant_id: str, tier: str = "free"
    ) -> CostQuota:
        """Create default quota for tenant based on tier"""
        if tier not in DEFAULT_QUOTAS:
            raise ValidationError(f"Unknown tier: {tier}")

        quota_config = DEFAULT_QUOTAS[tier]

        quota = CostQuota(
            tenant_id=tenant_id,
            tier=tier,
            monthly_limit=quota_config["monthly_limit"],
            daily_limit=quota_config["daily_limit"],
            alert_threshold=quota_config["alert_threshold"],
            current_monthly_usage=Decimal("0"),
            current_daily_usage=Decimal("0"),
            last_monthly_reset=datetime.now(timezone.utc),
            last_daily_reset=datetime.now(timezone.utc),
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )

        await self.quota_collection.insert_one(quota.model_dump())
        logger.info("Created default quota", tenant_id=tenant_id, tier=tier)

        return quota

    async def update_quota(
        self,
        tenant_id: str,
        monthly_limit: Optional[Decimal] = None,
        daily_limit: Optional[Decimal] = None,
        alert_threshold: Optional[Decimal] = None,
        tier: Optional[str] = None,
    ) -> CostQuota:
        """Update quota settings"""
        quota = await self.get_quota(tenant_id)
        if not quota:
            quota = await self.create_default_quota(tenant_id)

        update_data = {}
        if monthly_limit is not None:
            update_data["monthly_limit"] = monthly_limit
        if daily_limit is not None:
            update_data["daily_limit"] = daily_limit
        if alert_threshold is not None:
            update_data["alert_threshold"] = alert_threshold
        if tier is not None:
            update_data["tier"] = tier
            update_data["updated_at"] = datetime.now(timezone.utc)

        if update_data:
            await self.quota_collection.update_one(
                {"tenant_id": tenant_id}, {"$set": update_data}
            )
            quota = await self.get_quota(tenant_id)

        return quota

    async def check_quota(
        self, tenant_id: str, estimated_cost: Optional[Decimal] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if tenant has sufficient quota

        Args:
            tenant_id: Tenant identifier
            estimated_cost: Estimated cost for upcoming operation

        Returns:
            Tuple of (allowed, reason_if_denied)
        """
        quota = await self.get_quota(tenant_id)
        if not quota:
            quota = await self.create_default_quota(tenant_id)

        # Reset usage counters if needed
        quota = await self._reset_usage_if_needed(quota)

        # Check daily quota
        daily_remaining = quota.daily_limit - quota.current_daily_usage
        if estimated_cost and estimated_cost > daily_remaining:
            return False, f"Daily quota exceeded. Remaining: ${daily_remaining:.2f}"

        # Check monthly quota
        monthly_remaining = quota.monthly_limit - quota.current_monthly_usage
        if estimated_cost and estimated_cost > monthly_remaining:
            return False, f"Monthly quota exceeded. Remaining: ${monthly_remaining:.2f}"

        return True, None

    async def _reset_usage_if_needed(self, quota: CostQuota) -> CostQuota:
        """Reset usage counters if time period has passed"""
        now = datetime.now(timezone.utc)
        updates = {}

        # Reset daily usage if new day
        if (now - quota.last_daily_reset).days >= 1:
            updates["current_daily_usage"] = Decimal("0")
            updates["last_daily_reset"] = now

        # Reset monthly usage if new month
        if (
            now.month != quota.last_monthly_reset.month
            or now.year != quota.last_monthly_reset.year
        ):
            updates["current_monthly_usage"] = Decimal("0")
            updates["last_monthly_reset"] = now

        if updates:
            await self.quota_collection.update_one(
                {"tenant_id": quota.tenant_id}, {"$set": updates}
            )
            # Update quota object
            for key, value in updates.items():
                setattr(quota, key, value)

        return quota

    async def _check_quota_and_alerts(self, tenant_id: str, cost: Decimal):
        """Check quota after usage and send alerts if needed"""
        quota = await self.get_quota(tenant_id)
        if not quota:
            return

        # Update usage counters
        quota = await self._reset_usage_if_needed(quota)

        new_daily_usage = quota.current_daily_usage + cost
        new_monthly_usage = quota.current_monthly_usage + cost

        await self.quota_collection.update_one(
            {"tenant_id": tenant_id},
            {
                "$set": {
                    "current_daily_usage": new_daily_usage,
                    "current_monthly_usage": new_monthly_usage,
                }
            },
        )

        # Check alert thresholds
        await self._check_alert_thresholds(
            tenant_id, quota, new_daily_usage, new_monthly_usage
        )

    async def _check_alert_thresholds(
        self,
        tenant_id: str,
        quota: CostQuota,
        daily_usage: Decimal,
        monthly_usage: Decimal,
    ):
        """Check if usage exceeds alert thresholds"""
        daily_ratio = (
            float(daily_usage / quota.daily_limit) if quota.daily_limit > 0 else 0
        )
        monthly_ratio = (
            float(monthly_usage / quota.monthly_limit) if quota.monthly_limit > 0 else 0
        )

        alert_threshold = float(quota.alert_threshold)

        # Check for alerts
        alerts_to_create = []

        if daily_ratio >= alert_threshold:
            alerts_to_create.append(
                ("daily", daily_ratio, daily_usage, quota.daily_limit)
            )

        if monthly_ratio >= alert_threshold:
            alerts_to_create.append(
                ("monthly", monthly_ratio, monthly_usage, quota.monthly_limit)
            )

        # Create alerts
        for alert_type, ratio, usage, limit in alerts_to_create:
            # Check if we already sent this type of alert recently
            recent_alert = await self.alerts_collection.find_one(
                {
                    "tenant_id": tenant_id,
                    "alert_type": alert_type,
                    "timestamp": {
                        "$gte": datetime.now(timezone.utc) - timedelta(hours=1)
                    },
                }
            )

            if not recent_alert:
                alert = CostAlert(
                    tenant_id=tenant_id,
                    alert_type=f"{alert_type}_quota_warning",
                    message=f"{alert_type.title()} usage at {ratio:.1%} (${usage:.2f} of ${limit:.2f})",
                    usage_percentage=Decimal(str(ratio)),
                    current_usage=usage,
                    limit=limit,
                    severity="warning" if ratio < 1.0 else "critical",
                    timestamp=datetime.now(timezone.utc),
                )

                await self.alerts_collection.insert_one(alert.model_dump())
                logger.warning(
                    "Cost quota alert",
                    tenant_id=tenant_id,
                    alert_type=alert.alert_type,
                    message=alert.message,
                )

    async def get_usage_metrics(
        self,
        tenant_id: str,
        period: CostPeriod = CostPeriod.MONTHLY,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> UsageMetrics:
        """Get usage metrics for a tenant"""
        if not start_date:
            end_date = datetime.now(timezone.utc)
            if period == CostPeriod.DAILY:
                start_date = end_date - timedelta(days=1)
            elif period == CostPeriod.WEEKLY:
                start_date = end_date - timedelta(weeks=1)
            elif period == CostPeriod.MONTHLY:
                start_date = end_date - timedelta(days=30)
            else:  # YEARLY
                start_date = end_date - timedelta(days=365)

        # Aggregate usage data
        pipeline = [
            {
                "$match": {
                    "tenant_id": tenant_id,
                    "timestamp": {"$gte": start_date, "$lte": end_date},
                }
            },
            {
                "$group": {
                    "_id": {
                        "provider": "$provider",
                        "model": "$model",
                        "operation": "$operation",
                    },
                    "total_cost": {"$sum": "$total_cost"},
                    "input_tokens": {"$sum": "$input_tokens"},
                    "output_tokens": {"$sum": "$output_tokens"},
                    "request_count": {"$sum": 1},
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_cost": {"$sum": "$total_cost"},
                    "total_input_tokens": {"$sum": "$input_tokens"},
                    "total_output_tokens": {"$sum": "$output_tokens"},
                    "total_requests": {"$sum": "$request_count"},
                    "breakdown": {
                        "$push": {
                            "provider": "$_id.provider",
                            "model": "$_id.model",
                            "operation": "$_id.operation",
                            "cost": "$total_cost",
                            "tokens": {"$add": ["$input_tokens", "$output_tokens"]},
                            "requests": "$request_count",
                        }
                    },
                }
            },
        ]

        result = await self.cost_collection.aggregate(pipeline).to_list(length=1)

        if not result:
            return UsageMetrics(
                tenant_id=tenant_id,
                period=period,
                start_date=start_date,
                end_date=end_date,
                total_cost=Decimal("0"),
                total_tokens=0,
                total_requests=0,
            )

        data = result[0]
        return UsageMetrics(
            tenant_id=tenant_id,
            period=period,
            start_date=start_date,
            end_date=end_date,
            total_cost=Decimal(str(data["total_cost"])),
            total_tokens=data["total_input_tokens"] + data["total_output_tokens"],
            total_requests=data["total_requests"],
            breakdown=data["breakdown"],
        )

    async def get_cost_history(
        self,
        tenant_id: str,
        days: int = 30,
        provider: Optional[str] = None,
        operation: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get cost history for a tenant"""
        start_date = datetime.now(timezone.utc) - timedelta(days=days)

        query = {"tenant_id": tenant_id, "timestamp": {"$gte": start_date}}

        if provider:
            query["provider"] = provider
        if operation:
            query["operation"] = operation

        cursor = self.cost_collection.find(query).sort("timestamp", -1)
        history = await cursor.to_list(length=1000)

        # Convert ObjectId to string
        for item in history:
            item["_id"] = str(item["_id"])

        return history

    async def get_alerts(
        self, tenant_id: str, severity: Optional[str] = None, limit: int = 50
    ) -> List[CostAlert]:
        """Get cost alerts for a tenant"""
        query = {"tenant_id": tenant_id}
        if severity:
            query["severity"] = severity

        cursor = self.alerts_collection.find(query).sort("timestamp", -1).limit(limit)
        alerts = []

        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            alerts.append(CostAlert(**doc))

        return alerts

    async def dismiss_alert(self, alert_id: str) -> bool:
        """Dismiss a cost alert"""
        result = await self.alerts_collection.update_one(
            {"_id": alert_id},
            {"$set": {"dismissed": True, "dismissed_at": datetime.now(timezone.utc)}},
        )
        return result.modified_count > 0
