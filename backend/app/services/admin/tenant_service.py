"""
Tenant Service for cross-tenant operations
"""
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.admin import TenantInfo, TenantStatus, AuditAction
from app.core.admin_context import SuperAdminContext
from app.core.utils import escape_regex

logger = structlog.get_logger()


class TenantService:
    """Service for tenant (tutor) management operations"""
    
    def __init__(self, database: AsyncIOMotorDatabase, admin_context: Optional[SuperAdminContext] = None):
        self.db = database
        self.admin_context = admin_context
    
    async def get_tenant_by_id(self, tenant_id: str) -> Optional[Dict[str, Any]]:
        """Get a tenant by clerk_id or _id"""
        tutor = await self.db.tutors.find_one({"clerk_id": tenant_id})
        if not tutor:
            try:
                tutor = await self.db.tutors.find_one({"_id": ObjectId(tenant_id)})
            except Exception:
                pass
        return tutor
    
    async def get_tenant_statistics(self, tutor_id: str) -> Dict[str, int]:
        """Get statistics for a specific tenant"""
        return {
            "students_count": await self.db.students.count_documents({"tutor_id": tutor_id}),
            "parents_count": await self.db.parents.count_documents({"tutor_id": tutor_id}),
            "subjects_count": await self.db.subjects.count_documents({"tutor_id": tutor_id}),
            "questions_count": await self.db.questions.count_documents({"tutor_id": tutor_id}),
            "assignments_count": await self.db.assignments.count_documents({"tutor_id": tutor_id}),
            "materials_count": await self.db.materials.count_documents({"tutor_id": tutor_id})
        }
    
    async def list_tenants(
        self,
        page: int = 1,
        per_page: int = 20,
        status_filter: Optional[TenantStatus] = None,
        search: Optional[str] = None
    ) -> Dict[str, Any]:
        """List all tenants with pagination and filtering"""
        query = {}
        
        if status_filter:
            query["status"] = status_filter.value
        
        if search:
            query["$or"] = [
                {"name": {"$regex": escape_regex(search), "$options": "i"}},
                {"email": {"$regex": escape_regex(search), "$options": "i"}}
            ]
        
        skip = (page - 1) * per_page
        total = await self.db.tutors.count_documents(query)
        
        cursor = self.db.tutors.find(query).sort("created_at", -1).skip(skip).limit(per_page)
        tutors = await cursor.to_list(length=per_page)
        
        # Enrich with statistics
        enriched_tenants = []
        for tutor in tutors:
            tutor_id = tutor.get("clerk_id")
            stats = await self.get_tenant_statistics(tutor_id)
            
            enriched_tenants.append({
                "_id": str(tutor["_id"]),
                "clerk_id": tutor_id,
                "email": tutor.get("email", ""),
                "name": tutor.get("name", "Unknown"),
                "status": tutor.get("status", "active"),
                "created_at": tutor.get("created_at"),
                "updated_at": tutor.get("updated_at"),
                "last_login": tutor.get("last_login"),
                **stats
            })
        
        return {
            "tenants": enriched_tenants,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page
        }
    
    async def suspend_tenant(self, tenant_id: str, reason: str) -> bool:
        """Suspend a tenant account"""
        result = await self.db.tutors.update_one(
            {"clerk_id": tenant_id},
            {
                "$set": {
                    "status": TenantStatus.SUSPENDED.value,
                    "suspended_at": datetime.now(timezone.utc),
                    "suspension_reason": reason,
                    "updated_at": datetime.now(timezone.utc)
                }
            }
        )
        
        if result.matched_count > 0:
            logger.info("Tenant suspended", tenant_id=tenant_id, reason=reason)
            return True
        return False
    
    async def activate_tenant(self, tenant_id: str) -> bool:
        """Activate a suspended tenant account"""
        result = await self.db.tutors.update_one(
            {"clerk_id": tenant_id},
            {
                "$set": {
                    "status": TenantStatus.ACTIVE.value,
                    "activated_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc)
                },
                "$unset": {
                    "suspended_at": "",
                    "suspension_reason": ""
                }
            }
        )
        
        if result.matched_count > 0:
            logger.info("Tenant activated", tenant_id=tenant_id)
            return True
        return False
    
    async def get_tenant_data_summary(self, tenant_id: str) -> Dict[str, Any]:
        """Get a comprehensive data summary for a tenant"""
        stats = await self.get_tenant_statistics(tenant_id)
        
        # Get recent activity
        recent_questions = await self.db.questions.find(
            {"tutor_id": tenant_id}
        ).sort("created_at", -1).limit(5).to_list(length=5)
        
        recent_assignments = await self.db.assignments.find(
            {"tutor_id": tenant_id}
        ).sort("created_at", -1).limit(5).to_list(length=5)
        
        # Convert ObjectIds
        for q in recent_questions:
            q["_id"] = str(q["_id"])
        for a in recent_assignments:
            a["_id"] = str(a["_id"])
        
        return {
            "statistics": stats,
            "recent_questions": recent_questions,
            "recent_assignments": recent_assignments,
            "generated_at": datetime.now(timezone.utc).isoformat()
        }

