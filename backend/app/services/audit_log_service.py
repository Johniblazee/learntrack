"""
Audit log service for tracking system activity and API requests
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.audit_log import (
    AuditLog,
    AuditLogCreate,
    AuditLogInDB,
    AuditLogFilter,
    PaginatedAuditLogResponse,
    AuditLogSummary,
)

logger = structlog.get_logger()


class AuditLogService:
    """Service for managing audit logs"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.audit_logs

    async def create_audit_log(self, audit_log_data: AuditLogCreate) -> AuditLog:
        """Create a new audit log entry"""
        try:
            audit_log_dict = audit_log_data.model_dump()

            result = await self.collection.insert_one(audit_log_dict)
            audit_log_dict["_id"] = str(result.inserted_id)

            logger.debug(
                "Audit log created",
                audit_log_id=str(result.inserted_id),
                user_id=audit_log_data.user_id,
                method=audit_log_data.method,
                resource=audit_log_data.resource,
            )
            return AuditLog(**audit_log_dict)
        except Exception as e:
            logger.error(
                "Failed to create audit log",
                error=str(e),
                user_id=audit_log_data.user_id if audit_log_data else None,
            )
            raise

    async def get_audit_logs(
        self,
        filters: Optional[AuditLogFilter] = None,
        page: int = 1,
        per_page: int = 20,
    ) -> PaginatedAuditLogResponse:
        """Get paginated audit logs with optional filters"""
        try:
            query = {}

            if filters:
                if filters.method:
                    query["method"] = filters.method.upper()
                if filters.resource:
                    query["resource"] = {"$regex": filters.resource, "$options": "i"}
                if filters.user_id:
                    query["user_id"] = filters.user_id
                if filters.status_code:
                    query["status_code"] = filters.status_code
                if filters.tenant_id:
                    query["tenant_id"] = filters.tenant_id
                if filters.from_date or filters.to_date:
                    date_filter = {}
                    if filters.from_date:
                        date_filter["$gte"] = filters.from_date
                    if filters.to_date:
                        date_filter["$lte"] = filters.to_date
                    if date_filter:
                        query["timestamp"] = date_filter

            # Get total count
            total = await self.collection.count_documents(query)

            # Calculate pagination
            skip = (page - 1) * per_page
            total_pages = (total + per_page - 1) // per_page if total > 0 else 1

            # Get paginated results
            cursor = (
                self.collection.find(query)
                .sort("timestamp", -1)
                .skip(skip)
                .limit(per_page)
            )
            audit_logs_data = await cursor.to_list(length=per_page)

            # Convert to AuditLog models
            audit_logs = []
            for log_data in audit_logs_data:
                log_data["_id"] = str(log_data["_id"])
                audit_logs.append(AuditLog(**log_data))

            return PaginatedAuditLogResponse(
                activities=audit_logs,
                total=total,
                page=page,
                per_page=per_page,
                total_pages=total_pages,
            )
        except Exception as e:
            logger.error("Failed to get audit logs", error=str(e))
            raise

    async def get_audit_logs_by_user(
        self, user_id: str, limit: int = 50, days: int = 30
    ) -> List[AuditLog]:
        """Get audit logs for a specific user"""
        try:
            from_date = datetime.now(timezone.utc) - timedelta(days=days)

            cursor = (
                self.collection.find(
                    {"user_id": user_id, "timestamp": {"$gte": from_date}}
                )
                .sort("timestamp", -1)
                .limit(limit)
            )

            audit_logs_data = await cursor.to_list(length=limit)

            audit_logs = []
            for log_data in audit_logs_data:
                log_data["_id"] = str(log_data["_id"])
                audit_logs.append(AuditLog(**log_data))

            return audit_logs
        except Exception as e:
            logger.error("Failed to get user audit logs", error=str(e), user_id=user_id)
            raise

    async def get_audit_log_summary(self, days: int = 7) -> AuditLogSummary:
        """Get summary statistics for audit logs"""
        try:
            from_date = datetime.now(timezone.utc) - timedelta(days=days)

            # Total requests
            total_requests = await self.collection.count_documents(
                {"timestamp": {"$gte": from_date}}
            )

            # Unique users
            unique_users_pipeline = [
                {"$match": {"timestamp": {"$gte": from_date}}},
                {"$group": {"_id": "$user_id"}},
                {"$count": "unique_users"},
            ]
            unique_users_result = await self.collection.aggregate(
                unique_users_pipeline
            ).to_list(length=1)
            unique_users = (
                unique_users_result[0]["unique_users"] if unique_users_result else 0
            )

            # Average response time
            avg_time_pipeline = [
                {"$match": {"timestamp": {"$gte": from_date}}},
                {"$group": {"_id": None, "avg_duration": {"$avg": "$duration_ms"}}},
            ]
            avg_time_result = await self.collection.aggregate(
                avg_time_pipeline
            ).to_list(length=1)
            avg_response_time = (
                avg_time_result[0]["avg_duration"] if avg_time_result else 0
            )

            # Error rate
            error_count = await self.collection.count_documents(
                {"timestamp": {"$gte": from_date}, "status_code": {"$gte": 400}}
            )
            error_rate = (
                (error_count / total_requests * 100) if total_requests > 0 else 0
            )

            # Top resources
            resources_pipeline = [
                {"$match": {"timestamp": {"$gte": from_date}}},
                {"$group": {"_id": "$resource", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": 5},
            ]
            top_resources = await self.collection.aggregate(resources_pipeline).to_list(
                length=5
            )

            # Top users
            users_pipeline = [
                {"$match": {"timestamp": {"$gte": from_date}}},
                {
                    "$group": {
                        "_id": "$user_id",
                        "count": {"$sum": 1},
                        "name": {"$first": "$user_name"},
                    }
                },
                {"$sort": {"count": -1}},
                {"$limit": 5},
            ]
            top_users = await self.collection.aggregate(users_pipeline).to_list(
                length=5
            )

            return AuditLogSummary(
                total_requests=total_requests,
                unique_users=unique_users,
                avg_response_time_ms=avg_response_time,
                error_rate=error_rate,
                top_resources=top_resources,
                top_users=top_users,
            )
        except Exception as e:
            logger.error("Failed to get audit log summary", error=str(e))
            raise

    async def cleanup_old_logs(self, retention_days: int = 30) -> int:
        """Remove audit logs older than retention_days"""
        try:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=retention_days)

            result = await self.collection.delete_many(
                {"timestamp": {"$lt": cutoff_date}}
            )

            deleted_count = result.deleted_count
            logger.info(
                "Cleaned up old audit logs",
                deleted_count=deleted_count,
                retention_days=retention_days,
            )
            return deleted_count
        except Exception as e:
            logger.error("Failed to cleanup old audit logs", error=str(e))
            raise

    async def setup_ttl_index(self) -> None:
        """Setup TTL index for automatic cleanup (30 days)"""
        try:
            # Create TTL index on timestamp field (30 days = 30 * 24 * 60 * 60 seconds)
            await self.collection.create_index(
                "timestamp", expireAfterSeconds=30 * 24 * 60 * 60
            )
            logger.info("TTL index created for audit_logs collection")
        except Exception as e:
            logger.error("Failed to create TTL index", error=str(e))
            raise
