"""
Admin API endpoints for super admin functionality
"""

from fastapi import APIRouter

from app.api.v1.admin import (
    dashboard,
    tenants,
    users,
    settings as admin_settings,
    impersonation,
)
from app.api.v1.admin import tenant_ai_config, activity, ai_models

admin_router = APIRouter(prefix="/admin")

# Include all admin endpoint routers
admin_router.include_router(
    dashboard.router, prefix="/dashboard", tags=["admin-dashboard"]
)
admin_router.include_router(tenants.router, prefix="/tenants", tags=["admin-tenants"])
admin_router.include_router(users.router, prefix="/users", tags=["admin-users"])
admin_router.include_router(
    admin_settings.router, prefix="/settings", tags=["admin-settings"]
)
admin_router.include_router(
    impersonation.router, prefix="/impersonation", tags=["admin-impersonation"]
)
admin_router.include_router(
    tenant_ai_config.router, prefix="/tenant-ai-config", tags=["admin-tenant-ai-config"]
)
admin_router.include_router(
    activity.router, prefix="/activity", tags=["admin-activity"]
)
admin_router.include_router(
    ai_models.router, prefix="/ai-models", tags=["admin-ai-models"]
)
