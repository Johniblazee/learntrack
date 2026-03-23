"""
Admin Tenant Management API endpoints
Provides tenant (tutor) management for super admins
"""

import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.enhanced_auth import (
    ClerkUserContext,
    require_admin_permission,
)
from app.core.database import get_database
from app.core.utils import escape_regex
from app.models.admin import (
    AuditAction,
    BatchOperationResponse,
    BatchOperationResult,
    BatchOperationType,
    BatchTenantOperationRequest,
    TenantActivateRequest,
    TenantDetailsResponse,
    TenantInfo,
    TenantListResponse,
    TenantParentListResponse,
    TenantParentSummary,
    TenantQuotaSummary,
    TenantStatus,
    TenantStudentListResponse,
    TenantStudentSummary,
    TenantSuspendRequest,
    TenantUsageSummary,
)
from app.models.user import AdminPermission
from app.api.v1.admin.audit_utils import log_admin_action as _log_admin_action

logger = structlog.get_logger()
router = APIRouter()


async def _get_tenant_tutor(
    database: AsyncIOMotorDatabase, tenant_id: str
) -> Optional[dict]:
    tutor = await database.tutors.find_one({"clerk_id": tenant_id})
    if tutor:
        return tutor

    try:
        return await database.tutors.find_one({"_id": ObjectId(tenant_id)})
    except Exception:
        return None


def _to_float(value) -> float:
    if value is None:
        return 0.0

    if hasattr(value, "to_decimal"):
        value = value.to_decimal()

    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _member_status(document: dict) -> str:
    raw_status = str(document.get("status") or "").strip().lower()
    if raw_status:
        return raw_status
    return "active" if document.get("is_active", True) else "inactive"


def _member_is_active(document: dict) -> bool:
    if "is_active" in document:
        return bool(document.get("is_active", True))
    return _member_status(document) not in {"inactive", "suspended", "deleted"}


async def _build_tenant_usage_summary(
    database: AsyncIOMotorDatabase, tenant_id: str, days: int = 30
) -> TenantUsageSummary:
    period_start = datetime.now(timezone.utc) - timedelta(days=days)
    docs = (
        await database.cost_tracking.find(
            {"tenant_id": tenant_id, "timestamp": {"$gte": period_start}}
        )
        .sort("timestamp", -1)
        .to_list(length=5000)
    )

    if not docs:
        return TenantUsageSummary(period_days=days)

    provider_counts: Counter[str] = Counter()
    model_counts: Counter[str] = Counter()
    total_tokens = 0
    total_cost = 0.0
    last_request_at = None

    for doc in docs:
        input_tokens = int(doc.get("input_tokens", 0) or 0)
        output_tokens = int(doc.get("output_tokens", 0) or 0)
        total_tokens += input_tokens + output_tokens
        total_cost += _to_float(doc.get("total_cost"))

        provider = str(doc.get("provider") or "").strip()
        model = str(doc.get("model") or "").strip()
        if provider:
            provider_counts[provider] += 1
        if model:
            model_counts[model] += 1

        timestamp = doc.get("timestamp")
        if last_request_at is None and timestamp is not None:
            last_request_at = timestamp

    top_provider = provider_counts.most_common(1)[0][0] if provider_counts else None
    top_model = model_counts.most_common(1)[0][0] if model_counts else None

    return TenantUsageSummary(
        period_days=days,
        total_requests=len(docs),
        total_tokens=total_tokens,
        total_cost_usd=round(total_cost, 4),
        last_request_at=last_request_at,
        top_provider=top_provider,
        top_model=top_model,
    )


async def _build_tenant_quota_summary(
    database: AsyncIOMotorDatabase, tenant_id: str
) -> Optional[TenantQuotaSummary]:
    quota_doc = await database.cost_quotas.find_one({"tenant_id": tenant_id})
    if not quota_doc:
        return None

    daily_limit = _to_float(quota_doc.get("daily_limit"))
    daily_usage = _to_float(quota_doc.get("current_daily_usage"))
    monthly_limit = _to_float(quota_doc.get("monthly_limit"))
    monthly_usage = _to_float(quota_doc.get("current_monthly_usage"))
    alert_threshold = _to_float(quota_doc.get("alert_threshold")) or 0.8

    daily_ratio = (daily_usage / daily_limit) if daily_limit > 0 else 0.0
    monthly_ratio = (monthly_usage / monthly_limit) if monthly_limit > 0 else 0.0

    return TenantQuotaSummary(
        tier=str(quota_doc.get("tier") or "free"),
        is_active=bool(quota_doc.get("is_active", True)),
        daily_limit_usd=daily_limit,
        daily_usage_usd=daily_usage,
        monthly_limit_usd=monthly_limit,
        monthly_usage_usd=monthly_usage,
        alert_threshold=alert_threshold,
        near_limit=(daily_ratio >= alert_threshold or monthly_ratio >= alert_threshold),
        over_limit=(daily_ratio >= 1.0 or monthly_ratio >= 1.0),
    )


def _build_tenant_student_summary(student: dict) -> TenantStudentSummary:
    return TenantStudentSummary(
        _id=str(student.get("_id", "")),
        clerk_id=str(student.get("clerk_id") or ""),
        name=student.get("name", "Unknown Student"),
        email=student.get("email", ""),
        status=_member_status(student),
        is_active=_member_is_active(student),
        grade=student.get("grade"),
        parents_count=len(student.get("parent_ids") or []),
        total_assignments=int(student.get("totalAssignments", 0) or 0),
        completed_assignments=int(student.get("completedAssignments", 0) or 0),
        completion_rate=float(student.get("completionRate", 0.0) or 0.0),
        average_score=float(student.get("averageScore", 0.0) or 0.0),
        last_login=student.get("last_login") or student.get("lastActivity"),
        created_at=student.get("created_at") or student.get("enrollmentDate"),
        updated_at=student.get("updated_at"),
    )


def _build_tenant_parent_summary(
    parent: dict, student_lookup: dict[str, str]
) -> TenantParentSummary:
    child_names: List[str] = []
    seen_names = set()

    child_ids = parent.get("student_ids") or parent.get("parent_children") or []
    for child_id in child_ids:
        child_name = student_lookup.get(str(child_id))
        if child_name and child_name not in seen_names:
            seen_names.add(child_name)
            child_names.append(child_name)

    return TenantParentSummary(
        _id=str(parent.get("_id", "")),
        clerk_id=str(parent.get("clerk_id") or ""),
        name=parent.get("name", "Unknown Parent"),
        email=parent.get("email", ""),
        status=_member_status(parent),
        is_active=_member_is_active(parent),
        children_count=len(child_ids),
        child_names=child_names,
        last_login=parent.get("last_login"),
        created_at=parent.get("created_at"),
        updated_at=parent.get("updated_at"),
    )


@router.get("/", response_model=TenantListResponse)
async def list_tenants(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[TenantStatus] = Query(None),
    search: Optional[str] = Query(None, description="Search by name or email"),
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_ALL_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """List all tenants (tutors) with statistics"""
    try:
        skip = (page - 1) * per_page
        query = {}

        if status_filter:
            query["status"] = status_filter.value

        if search:
            query["$or"] = [
                {"name": {"$regex": escape_regex(search), "$options": "i"}},
                {"email": {"$regex": escape_regex(search), "$options": "i"}},
            ]

        # Get total count
        total = await database.tutors.count_documents(query)

        # Get tutors with pagination
        cursor = (
            database.tutors.find(query)
            .sort("created_at", -1)
            .skip(skip)
            .limit(per_page)
        )
        tutors = await cursor.to_list(length=per_page)

        # Enrich with statistics
        tenant_infos = []
        for tutor in tutors:
            tutor_id = tutor.get("clerk_id")

            # Get counts for this tutor's tenant
            students_count = await database.students.count_documents(
                {"tutor_id": tutor_id}
            )
            parents_count = await database.parents.count_documents(
                {"tutor_id": tutor_id}
            )
            subjects_count = await database.subjects.count_documents(
                {"tutor_id": tutor_id}
            )
            questions_count = await database.questions.count_documents(
                {"tutor_id": tutor_id}
            )
            assignments_count = await database.assignments.count_documents(
                {"tutor_id": tutor_id}
            )

            tenant_info = TenantInfo(
                _id=str(tutor["_id"]),
                clerk_id=tutor_id,
                email=tutor.get("email", ""),
                name=tutor.get("name", "Unknown"),
                status=TenantStatus(tutor.get("status", "active")),
                created_at=tutor.get("created_at", datetime.now(timezone.utc)),
                updated_at=tutor.get("updated_at", datetime.now(timezone.utc)),
                last_login=tutor.get("last_login"),
                students_count=students_count,
                parents_count=parents_count,
                subjects_count=subjects_count,
                questions_count=questions_count,
                assignments_count=assignments_count,
                subscription_tier=tutor.get("subscription_tier", "free"),
                storage_used_mb=tutor.get("storage_used_mb", 0.0),
                storage_limit_mb=tutor.get("storage_limit_mb", 500.0),
            )
            tenant_infos.append(tenant_info)

        total_pages = (total + per_page - 1) // per_page

        return TenantListResponse(
            tenants=tenant_infos,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )
    except Exception as e:
        logger.error("Failed to list tenants", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to list tenants: {str(e)}")


@router.get("/{tenant_id}", response_model=TenantDetailsResponse)
async def get_tenant_details(
    tenant_id: str,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_ALL_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get detailed information about a specific tenant"""
    try:
        tutor = await _get_tenant_tutor(database, tenant_id)
        if not tutor:
            raise HTTPException(status_code=404, detail="Tenant not found")

        tutor_id = tutor.get("clerk_id")

        (
            students_count,
            parents_count,
            active_students_count,
            active_parents_count,
            subjects_count,
            questions_count,
            assignments_count,
            materials_count,
            pending_invitations_count,
            usage_summary,
            quota_summary,
        ) = await asyncio.gather(
            database.students.count_documents({"tutor_id": tutor_id}),
            database.parents.count_documents({"tutor_id": tutor_id}),
            database.students.count_documents(
                {"tutor_id": tutor_id, "is_active": {"$ne": False}}
            ),
            database.parents.count_documents(
                {"tutor_id": tutor_id, "is_active": {"$ne": False}}
            ),
            database.subjects.count_documents({"tutor_id": tutor_id}),
            database.questions.count_documents({"tutor_id": tutor_id}),
            database.assignments.count_documents({"tutor_id": tutor_id}),
            database.materials.count_documents({"tutor_id": tutor_id}),
            database.invitations.count_documents(
                {"tutor_id": tutor_id, "status": "pending"}
            ),
            _build_tenant_usage_summary(database, tutor_id),
            _build_tenant_quota_summary(database, tutor_id),
        )

        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            AuditAction.TENANT_VIEWED,
            "tenant",
            tutor_id,
        )

        return TenantDetailsResponse(
            _id=str(tutor["_id"]),
            clerk_id=tutor_id,
            email=tutor.get("email", ""),
            name=tutor.get("name", "Unknown"),
            status=TenantStatus(tutor.get("status", "active")),
            created_at=tutor.get("created_at", datetime.now(timezone.utc)),
            updated_at=tutor.get("updated_at", datetime.now(timezone.utc)),
            last_login=tutor.get("last_login"),
            students_count=students_count,
            parents_count=parents_count,
            subjects_count=subjects_count,
            questions_count=questions_count,
            assignments_count=assignments_count,
            subscription_tier=tutor.get("subscription_tier", "free"),
            storage_used_mb=tutor.get("storage_used_mb", 0.0),
            storage_limit_mb=tutor.get("storage_limit_mb", 500.0),
            active_students_count=active_students_count,
            active_parents_count=active_parents_count,
            materials_count=materials_count,
            pending_invitations_count=pending_invitations_count,
            usage_summary=usage_summary,
            quota_summary=quota_summary,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get tenant details", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get tenant: {str(e)}")


@router.get("/{tenant_id}/students", response_model=TenantStudentListResponse)
async def list_tenant_students(
    tenant_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by name, email, or grade"),
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_ALL_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get the student roster for a tutor-backed tenant"""
    try:
        tutor = await _get_tenant_tutor(database, tenant_id)
        if not tutor:
            raise HTTPException(status_code=404, detail="Tenant not found")

        tutor_id = tutor.get("clerk_id")
        query = {"tutor_id": tutor_id}
        if search:
            query["$or"] = [
                {"name": {"$regex": escape_regex(search), "$options": "i"}},
                {"email": {"$regex": escape_regex(search), "$options": "i"}},
                {"grade": {"$regex": escape_regex(search), "$options": "i"}},
            ]

        total = await database.students.count_documents(query)
        skip = (page - 1) * per_page
        students = (
            await database.students.find(query)
            .sort([("name", 1), ("created_at", -1)])
            .skip(skip)
            .limit(per_page)
            .to_list(length=per_page)
        )

        total_pages = (total + per_page - 1) // per_page
        return TenantStudentListResponse(
            students=[_build_tenant_student_summary(student) for student in students],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to list tenant students", tenant_id=tenant_id, error=str(e)
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve tenant students: {str(e)}"
        )


@router.get("/{tenant_id}/parents", response_model=TenantParentListResponse)
async def list_tenant_parents(
    tenant_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by name or email"),
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.VIEW_ALL_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Get the parent roster for a tutor-backed tenant"""
    try:
        tutor = await _get_tenant_tutor(database, tenant_id)
        if not tutor:
            raise HTTPException(status_code=404, detail="Tenant not found")

        tutor_id = tutor.get("clerk_id")
        query = {"tutor_id": tutor_id}
        if search:
            query["$or"] = [
                {"name": {"$regex": escape_regex(search), "$options": "i"}},
                {"email": {"$regex": escape_regex(search), "$options": "i"}},
            ]

        total = await database.parents.count_documents(query)
        skip = (page - 1) * per_page
        parents = (
            await database.parents.find(query)
            .sort([("name", 1), ("created_at", -1)])
            .skip(skip)
            .limit(per_page)
            .to_list(length=per_page)
        )

        tenant_students = await database.students.find({"tutor_id": tutor_id}).to_list(
            length=5000
        )
        student_lookup: dict[str, str] = {}
        for student in tenant_students:
            student_name = student.get("name", "Unknown Student")
            student_clerk_id = student.get("clerk_id")
            if student_clerk_id:
                student_lookup[str(student_clerk_id)] = student_name
            if student.get("_id") is not None:
                student_lookup[str(student.get("_id"))] = student_name

        total_pages = (total + per_page - 1) // per_page
        return TenantParentListResponse(
            parents=[
                _build_tenant_parent_summary(parent, student_lookup)
                for parent in parents
            ],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to list tenant parents", tenant_id=tenant_id, error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve tenant parents: {str(e)}"
        )


@router.post("/{tenant_id}/suspend")
async def suspend_tenant(
    tenant_id: str,
    request: TenantSuspendRequest,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.SUSPEND_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Suspend a tenant (tutor) account"""
    try:
        # Find and update tutor
        result = await database.tutors.update_one(
            {"clerk_id": tenant_id},
            {
                "$set": {
                    "status": TenantStatus.SUSPENDED.value,
                    "suspended_at": datetime.now(timezone.utc),
                    "suspension_reason": request.reason,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Tenant not found")

        # Log the action
        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            AuditAction.TENANT_SUSPENDED,
            "tenant",
            tenant_id,
            {"reason": request.reason, "notify_users": request.notify_users},
        )

        logger.info("Tenant suspended", tenant_id=tenant_id, admin=current_user.email)

        return {
            "status": "suspended",
            "tenant_id": tenant_id,
            "message": "Tenant has been suspended",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to suspend tenant", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to suspend tenant: {str(e)}"
        )


@router.post("/{tenant_id}/activate")
async def activate_tenant(
    tenant_id: str,
    request: TenantActivateRequest,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.MANAGE_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Activate a suspended tenant account"""
    try:
        # Find and update tutor
        result = await database.tutors.update_one(
            {"clerk_id": tenant_id},
            {
                "$set": {
                    "status": TenantStatus.ACTIVE.value,
                    "activated_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                },
                "$unset": {"suspended_at": "", "suspension_reason": ""},
            },
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Tenant not found")

        # Log the action
        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            AuditAction.TENANT_ACTIVATED,
            "tenant",
            tenant_id,
            {"reason": request.reason, "notify_users": request.notify_users},
        )

        logger.info("Tenant activated", tenant_id=tenant_id, admin=current_user.email)

        return {
            "status": "active",
            "tenant_id": tenant_id,
            "message": "Tenant has been activated",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to activate tenant", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to activate tenant: {str(e)}"
        )


@router.post("/batch", response_model=BatchOperationResponse)
async def batch_tenant_operations(
    request: BatchTenantOperationRequest,
    current_user: ClerkUserContext = Depends(
        require_admin_permission(AdminPermission.SUSPEND_TENANTS)
    ),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Perform batch operations on multiple tenants.
    Supports: suspend, activate
    """
    try:
        results: List[BatchOperationResult] = []
        successful = 0
        failed = 0

        # Validate operation type for tenants
        if request.operation not in [
            BatchOperationType.SUSPEND,
            BatchOperationType.ACTIVATE,
        ]:
            raise HTTPException(
                status_code=400,
                detail="Invalid operation for tenants. Supported: suspend, activate",
            )

        for tenant_id in request.tenant_ids:
            try:
                # Find tenant
                tutor = await database.tutors.find_one({"clerk_id": tenant_id})
                if not tutor:
                    try:
                        tutor = await database.tutors.find_one(
                            {"_id": ObjectId(tenant_id)}
                        )
                    except Exception:
                        pass

                if not tutor:
                    results.append(
                        BatchOperationResult(
                            id=tenant_id, success=False, error="Tenant not found"
                        )
                    )
                    failed += 1
                    continue

                # Prevent operations on super admins
                if tutor.get("is_super_admin", False):
                    results.append(
                        BatchOperationResult(
                            id=tenant_id,
                            success=False,
                            error="Cannot modify super admin tenant",
                        )
                    )
                    failed += 1
                    continue

                # Perform the operation
                now = datetime.now(timezone.utc)

                if request.operation == BatchOperationType.SUSPEND:
                    await database.tutors.update_one(
                        {"_id": tutor["_id"]},
                        {
                            "$set": {
                                "status": TenantStatus.SUSPENDED.value,
                                "suspended_at": now,
                                "suspension_reason": request.reason
                                or "Batch suspension",
                                "updated_at": now,
                            }
                        },
                    )
                elif request.operation == BatchOperationType.ACTIVATE:
                    await database.tutors.update_one(
                        {"_id": tutor["_id"]},
                        {
                            "$set": {
                                "status": TenantStatus.ACTIVE.value,
                                "activated_at": now,
                                "updated_at": now,
                            },
                            "$unset": {"suspended_at": "", "suspension_reason": ""},
                        },
                    )

                results.append(BatchOperationResult(id=tenant_id, success=True))
                successful += 1

            except Exception as e:
                results.append(
                    BatchOperationResult(id=tenant_id, success=False, error=str(e))
                )
                failed += 1

        # Log the batch operation
        audit_action = {
            BatchOperationType.SUSPEND: AuditAction.BATCH_TENANTS_SUSPENDED,
            BatchOperationType.ACTIVATE: AuditAction.BATCH_TENANTS_ACTIVATED,
        }.get(request.operation, AuditAction.TENANT_ACTIVATED)

        await _log_admin_action(
            database,
            current_user.clerk_id,
            current_user.email,
            audit_action,
            "tenants",
            None,
            {
                "operation": request.operation.value,
                "total_requested": len(request.tenant_ids),
                "successful": successful,
                "failed": failed,
                "reason": request.reason,
            },
        )

        logger.info(
            "Batch tenant operation completed",
            operation=request.operation.value,
            successful=successful,
            failed=failed,
            admin=current_user.email,
        )

        return BatchOperationResponse(
            operation=request.operation,
            total_requested=len(request.tenant_ids),
            successful=successful,
            failed=failed,
            results=results,
            message=f"Batch {request.operation.value} completed: {successful} successful, {failed} failed",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to perform batch tenant operation", error=str(e))
        raise HTTPException(
            status_code=500, detail=f"Failed to perform batch operation: {str(e)}"
        )
