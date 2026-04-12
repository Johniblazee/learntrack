"""
Dependency injection for FastAPI endpoints.

Services are created per-request rather than cached. The previous implementation
keyed a class-name-only cache, which meant that once any test (or DB reconnect)
swapped the underlying `AsyncIOMotorDatabase` handle, subsequent requests kept
reusing the service bound to the old handle — a footgun that would not surface
until the first time two database contexts coexisted. Since services are thin
wrappers around the async Mongo driver, per-request construction is cheap and
makes lifetime explicit.
"""

from typing import Annotated

from fastapi import Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_database


async def get_question_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.question_service import QuestionService

    return QuestionService(database)


async def get_assignment_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.assignment_service import AssignmentService

    return AssignmentService(database)


async def get_subject_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.subject_service import SubjectService

    return SubjectService(database)


async def get_user_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.user_service import UserService

    return UserService(database)


async def get_invitation_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.invitation_service import InvitationService

    return InvitationService(database)


async def get_material_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.material_service import MaterialService

    return MaterialService(database)


async def get_message_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.message_service import MessageService

    return MessageService(database)


async def get_progress_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.progress_service import ProgressService

    return ProgressService(database)


async def get_notification_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.notification_service import NotificationService

    return NotificationService(database)


async def get_activity_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.services.activity_service import ActivityService

    return ActivityService(database)


async def get_rag_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    from app.rag.services.rag_service import RAGService

    return RAGService(database)


# Type aliases for cleaner endpoint signatures
QuestionServiceDep = Annotated[object, Depends(get_question_service)]
AssignmentServiceDep = Annotated[object, Depends(get_assignment_service)]
SubjectServiceDep = Annotated[object, Depends(get_subject_service)]
UserServiceDep = Annotated[object, Depends(get_user_service)]
InvitationServiceDep = Annotated[object, Depends(get_invitation_service)]
MaterialServiceDep = Annotated[object, Depends(get_material_service)]
MessageServiceDep = Annotated[object, Depends(get_message_service)]
ProgressServiceDep = Annotated[object, Depends(get_progress_service)]
NotificationServiceDep = Annotated[object, Depends(get_notification_service)]
ActivityServiceDep = Annotated[object, Depends(get_activity_service)]
RAGServiceDep = Annotated[object, Depends(get_rag_service)]
