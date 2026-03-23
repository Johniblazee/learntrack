"""
Admin API endpoints for Tenant AI Configuration Management
Allows admins to configure AI providers and models per tenant
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.dependencies import get_database
from app.core.enhanced_auth import (
    ClerkUserContext,
    require_admin_permission,
)
from app.models.user import AdminPermission
from app.models.tenant_ai_config import (
    TenantAIConfig,
    TenantAIConfigCreate,
    TenantAIConfigUpdate,
    TenantAIConfigResponse,
    ProviderAvailability,
    BulkModelOperation,
)
from app.services.tenant_ai_config_service import TenantAIConfigService
from app.core.exceptions import NotFoundError, ValidationError

logger = structlog.get_logger()

router = APIRouter()
_perm = require_admin_permission(AdminPermission.MANAGE_AI_PROVIDERS)


async def get_service(
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> TenantAIConfigService:
    """Dependency to get TenantAIConfigService instance"""
    return TenantAIConfigService(db)


@router.get("/", response_model=dict)
async def list_tenant_configs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """List all tenant AI configurations with pagination"""
    configs, total = await service.list_configs(page, per_page, search)
    return {
        "items": [c.model_dump() for c in configs],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@router.get("/providers", response_model=List[ProviderAvailability])
async def get_available_providers(
    tenant_id: str = Query(..., description="Tenant ID to get providers for"),
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Get all available AI providers and their models for a tenant"""
    return await service.get_available_providers(tenant_id)


@router.get("/{tenant_id}", response_model=TenantAIConfigResponse)
async def get_tenant_config(
    tenant_id: str,
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Get AI configuration for a specific tenant"""
    config = await service.get_or_create_default(tenant_id)
    providers = await service.get_available_providers(tenant_id)
    embedding_providers = await service.get_embedding_providers()
    return TenantAIConfigResponse(
        config=config, providers=providers, embedding_providers=embedding_providers
    )


@router.post("/", response_model=TenantAIConfig, status_code=status.HTTP_201_CREATED)
async def create_tenant_config(
    config_data: TenantAIConfigCreate,
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Create a new tenant AI configuration"""
    try:
        return await service.create_config(config_data, admin_id=current_user.clerk_id)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{tenant_id}", response_model=TenantAIConfig)
async def update_tenant_config(
    tenant_id: str,
    update_data: TenantAIConfigUpdate,
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Update tenant AI configuration"""
    try:
        return await service.update_config(
            tenant_id,
            update_data,
            admin_id=current_user.clerk_id,
            admin_email=current_user.email or "",
        )
    except NotFoundError:
        raise HTTPException(
            status_code=404, detail=f"Config not found for tenant {tenant_id}"
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{tenant_id}/bulk-operation", response_model=TenantAIConfig)
async def bulk_model_operation(
    tenant_id: str,
    operation: BulkModelOperation,
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Perform bulk operations on model configuration"""
    try:
        return await service.bulk_operation(
            tenant_id,
            operation.operation,
            operation.provider_id,
            admin_id=current_user.clerk_id,
            admin_email=current_user.email or "",
        )
    except NotFoundError:
        raise HTTPException(
            status_code=404, detail=f"Config not found for tenant {tenant_id}"
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant_config(
    tenant_id: str,
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Delete tenant AI configuration"""
    deleted = await service.delete_config(
        tenant_id, admin_id=current_user.clerk_id, admin_email=current_user.email or ""
    )
    if not deleted:
        raise HTTPException(
            status_code=404, detail=f"Config not found for tenant {tenant_id}"
        )


@router.get("/{tenant_id}/audit-logs", response_model=dict)
async def get_audit_logs(
    tenant_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    service: TenantAIConfigService = Depends(get_service),
    current_user: ClerkUserContext = Depends(_perm),
):
    """Get audit logs for a tenant's AI configuration changes"""
    logs, total = await service.get_audit_logs(tenant_id, page, per_page)
    return {"items": logs, "total": total, "page": page, "per_page": per_page}
