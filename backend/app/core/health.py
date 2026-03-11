"""
Health and Readiness probe endpoints with dependency checks.
"""

from typing import Dict, Any, List
from datetime import datetime, timezone
from dataclasses import dataclass
from enum import Enum
import structlog

from app.core.config import settings

logger = structlog.get_logger()


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


@dataclass
class DependencyCheck:
    name: str
    status: HealthStatus
    latency_ms: float
    message: str = ""


class HealthChecker:
    """Health and readiness checker for application dependencies"""

    def __init__(self):
        self.checks: List[DependencyCheck] = []

    async def check_mongodb_client(self) -> DependencyCheck:
        """Check that the MongoDB client is initialized and responsive."""
        import time
        from app.core.database import database

        start = time.time()
        try:
            if database.client is None or database.database is None:
                return DependencyCheck(
                    name="mongodb",
                    status=HealthStatus.UNHEALTHY,
                    latency_ms=0,
                    message="Database client not initialized",
                )

            await database.ensure_connected()
            latency = (time.time() - start) * 1000

            return DependencyCheck(
                name="mongodb",
                status=HealthStatus.HEALTHY,
                latency_ms=round(latency, 2),
                message="Connected",
            )
        except Exception as e:
            latency = (time.time() - start) * 1000
            logger.error("MongoDB readiness check failed", error=str(e))
            return DependencyCheck(
                name="mongodb",
                status=HealthStatus.UNHEALTHY,
                latency_ms=round(latency, 2),
                message=str(e),
            )

    async def check_mongodb(self) -> DependencyCheck:
        """Check MongoDB connectivity"""
        import time
        from app.core.database import database

        start = time.time()
        try:
            if database.client is None:
                return DependencyCheck(
                    name="mongodb",
                    status=HealthStatus.UNHEALTHY,
                    latency_ms=0,
                    message="Database client not initialized",
                )

            # Ping the database
            await database.client.admin.command("ping")
            latency = (time.time() - start) * 1000

            return DependencyCheck(
                name="mongodb",
                status=HealthStatus.HEALTHY,
                latency_ms=round(latency, 2),
                message="Connected",
            )
        except Exception as e:
            latency = (time.time() - start) * 1000
            logger.error("MongoDB health check failed", error=str(e))
            return DependencyCheck(
                name="mongodb",
                status=HealthStatus.UNHEALTHY,
                latency_ms=round(latency, 2),
                message=str(e),
            )

    async def check_qdrant(self) -> DependencyCheck:
        """Check Qdrant vector database connectivity"""
        import time

        start = time.time()

        if not settings.QDRANT_URL:
            return DependencyCheck(
                name="qdrant",
                status=HealthStatus.DEGRADED,
                latency_ms=0,
                message="Qdrant not configured",
            )

        try:
            from qdrant_client import QdrantClient
            from qdrant_client.http import models

            client = QdrantClient(
                url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY, timeout=5
            )

            # Check connection by listing collections
            client.get_collections()
            latency = (time.time() - start) * 1000

            return DependencyCheck(
                name="qdrant",
                status=HealthStatus.HEALTHY,
                latency_ms=round(latency, 2),
                message="Connected",
            )
        except Exception as e:
            latency = (time.time() - start) * 1000
            logger.warning("Qdrant health check failed", error=str(e))
            return DependencyCheck(
                name="qdrant",
                status=HealthStatus.DEGRADED,
                latency_ms=round(latency, 2),
                message=str(e),
            )

    async def check_readiness(self, deep: bool = False) -> Dict[str, Any]:
        """Check if application is ready to serve traffic."""
        checks = []

        mongo_check = await self.check_mongodb_client()
        checks.append(mongo_check)

        if deep:
            qdrant_check = await self.check_qdrant()
            checks.append(qdrant_check)

        # Determine overall status
        has_unhealthy = any(c.status == HealthStatus.UNHEALTHY for c in checks)
        has_degraded = any(c.status == HealthStatus.DEGRADED for c in checks)

        if has_unhealthy:
            overall_status = HealthStatus.UNHEALTHY
        elif has_degraded:
            overall_status = HealthStatus.DEGRADED
        else:
            overall_status = HealthStatus.HEALTHY

        return {
            "status": overall_status.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "learntrack-api",
            "version": settings.VERSION,
            "environment": settings.ENVIRONMENT,
            "checks": [
                {
                    "name": c.name,
                    "status": c.status.value,
                    "latency_ms": c.latency_ms,
                    "message": c.message,
                }
                for c in checks
            ],
        }

    async def check_liveness(self) -> Dict[str, Any]:
        """Simple liveness check - is the process alive?"""
        return {
            "status": HealthStatus.HEALTHY.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "learntrack-api",
            "version": settings.VERSION,
        }


# Global health checker instance
health_checker = HealthChecker()
