"""
Dependency injection for FastAPI endpoints
Provides singleton service instances to avoid per-request instantiation
"""

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database

logger = structlog.get_logger()


# Service factory functions with caching
# These create service instances that are reused across requests
class ServiceContainer:
    """
    Container for service instances.
    Services are lazily initialized and cached per database instance.
    """

    _instances: dict = {}

    @classmethod
    def get_service(cls, service_class, database: AsyncIOMotorDatabase):
        """Get or create a service instance"""
        key = (service_class.__name__, id(database))
        if key not in cls._instances:
            cls._instances[key] = service_class(database)
            logger.debug(f"Created new {service_class.__name__} instance")
        return cls._instances[key]

    @classmethod
    def clear(cls):
        """Clear all cached service instances (useful for testing)"""
        cls._instances.clear()


# Question Service Dependency
async def get_question_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get QuestionService instance"""
    from app.services.question_service import QuestionService

    return ServiceContainer.get_service(QuestionService, database)


# Assignment Service Dependency
async def get_assignment_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Dependency to get AssignmentService instance"""
    from app.services.assignment_service import AssignmentService

    return ServiceContainer.get_service(AssignmentService, database)


# Subject Service Dependency
async def get_subject_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get SubjectService instance"""
    from app.services.subject_service import SubjectService

    return ServiceContainer.get_service(SubjectService, database)


# User Service Dependency
async def get_user_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get UserService instance"""
    from app.services.user_service import UserService

    return ServiceContainer.get_service(UserService, database)


# Invitation Service Dependency
async def get_invitation_service(
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """Dependency to get InvitationService instance"""
    from app.services.invitation_service import InvitationService

    return ServiceContainer.get_service(InvitationService, database)


# Material Service Dependency
async def get_material_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get MaterialService instance"""
    from app.services.material_service import MaterialService

    return ServiceContainer.get_service(MaterialService, database)


# Message Service Dependency
async def get_message_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get MessageService instance"""
    from app.services.message_service import MessageService

    return ServiceContainer.get_service(MessageService, database)


# Progress Service Dependency
async def get_progress_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get ProgressService instance"""
    from app.services.progress_service import ProgressService

    return ServiceContainer.get_service(ProgressService, database)


# RAG Service Dependency (special case - may need API keys)
async def get_rag_service(database: AsyncIOMotorDatabase = Depends(get_database)):
    """Dependency to get RAGService instance"""
    from app.rag.services.rag_service import RAGService

    return ServiceContainer.get_service(RAGService, database)


# Type aliases for cleaner endpoint signatures
QuestionServiceDep = Annotated[object, Depends(get_question_service)]
AssignmentServiceDep = Annotated[object, Depends(get_assignment_service)]
SubjectServiceDep = Annotated[object, Depends(get_subject_service)]
UserServiceDep = Annotated[object, Depends(get_user_service)]
InvitationServiceDep = Annotated[object, Depends(get_invitation_service)]
MaterialServiceDep = Annotated[object, Depends(get_material_service)]
MessageServiceDep = Annotated[object, Depends(get_message_service)]
ProgressServiceDep = Annotated[object, Depends(get_progress_service)]
RAGServiceDep = Annotated[object, Depends(get_rag_service)]
