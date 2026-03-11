"""
API v1 router
"""

from fastapi import APIRouter

# Import working endpoints
from app.api.v1.endpoints import (
    questions,
    assignments,
    subjects,
    students,
    progress,
    webhooks,
    users,
    dashboard,
    topics,
    invitations,
    parents,
    conversations,
    messages,
    visibility,
    materials,
    notifications,
    activities,
    groups,
    websocket,
    assignment_templates,
    settings,
    documents,
    cost_tracking,
)

# Import admin router
from app.api.v1.admin import admin_router

api_router = APIRouter()

# Include all endpoint routers
api_router.include_router(questions.router, prefix="/questions", tags=["questions"])
api_router.include_router(
    assignments.router, prefix="/assignments", tags=["assignments"]
)
api_router.include_router(subjects.router, prefix="/subjects", tags=["subjects"])
api_router.include_router(students.router, prefix="/students", tags=["students"])
api_router.include_router(parents.router, prefix="/parents", tags=["parents"])
api_router.include_router(progress.router, prefix="/progress", tags=["progress"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(topics.router, prefix="/topics", tags=["topics"])
api_router.include_router(
    invitations.router, prefix="/invitations", tags=["invitations"]
)
api_router.include_router(
    conversations.router, prefix="/conversations", tags=["conversations"]
)
api_router.include_router(messages.router, prefix="/messages", tags=["messages"])
api_router.include_router(visibility.router, prefix="/visibility", tags=["visibility"])
api_router.include_router(materials.router, prefix="/materials", tags=["materials"])
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
api_router.include_router(activities.router, prefix="/activity", tags=["activity"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(
    assignment_templates.router,
    prefix="/assignment-templates",
    tags=["assignment-templates"],
)
api_router.include_router(websocket.router, tags=["websocket"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(
    cost_tracking.router, prefix="/cost-tracking", tags=["cost-tracking"]
)

# Admin router (super admin only)
api_router.include_router(admin_router)
