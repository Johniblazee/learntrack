"""
MongoDB database connection and configuration
"""

import asyncio
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
import structlog

from app.core.config import settings

logger = structlog.get_logger()


class Database:
    """MongoDB database manager"""

    def __init__(self):
        self.client: Optional[AsyncIOMotorClient] = None
        self.database: Optional[AsyncIOMotorDatabase] = None

    async def connect_to_database(self):
        """Create database connection"""
        try:
            logger.info("Connecting to MongoDB", url=settings.MONGODB_URL)
            self.client = AsyncIOMotorClient(settings.MONGODB_URL)
            self.database = self.client[settings.DATABASE_NAME]

            # Test the connection
            await self.client.admin.command("ping")
            logger.info("Successfully connected to MongoDB")

            # Create indexes
            await self._create_indexes()

        except Exception as e:
            logger.error("Failed to connect to MongoDB", error=str(e))
            raise

    async def close_database_connection(self):
        """Close database connection"""
        if self.client:
            logger.info("Closing MongoDB connection")
            self.client.close()

    async def _create_indexes(self):
        """Create database indexes for better performance"""
        try:
            # Tutors collection indexes
            await self.database.tutors.create_index("clerk_id", unique=True)
            await self.database.tutors.create_index("email", unique=True)
            await self.database.tutors.create_index("slug", unique=True)
            await self.database.tutors.create_index("tenant_id")

            # Students collection indexes
            await self.database.students.create_index("clerk_id", unique=True)
            await self.database.students.create_index("email", unique=True)
            await self.database.students.create_index("slug", unique=True)
            await self.database.students.create_index("tutor_id")
            await self.database.students.create_index("tenant_id")
            await self.database.students.create_index(
                [("tutor_id", 1), ("is_active", 1)]
            )

            # Parents collection indexes
            await self.database.parents.create_index("clerk_id", unique=True)
            await self.database.parents.create_index("email", unique=True)
            await self.database.parents.create_index("slug", unique=True)
            await self.database.parents.create_index("tutor_id")
            await self.database.parents.create_index("tenant_id")
            await self.database.parents.create_index("student_ids")
            await self.database.parents.create_index("parent_children")
            await self.database.parents.create_index(
                [("tutor_id", 1), ("student_ids", 1)]
            )
            await self.database.parents.create_index(
                [("tutor_id", 1), ("parent_children", 1)]
            )

            # Subjects collection indexes
            await self.database.subjects.create_index("tutor_id")
            await self.database.subjects.create_index(
                [("tutor_id", 1), ("name", 1)], unique=True
            )

            # Questions collection indexes
            await self.database.questions.create_index("subject_id")
            await self.database.questions.create_index("tutor_id")
            await self.database.questions.create_index(
                [("subject_id", 1), ("topic", 1)]
            )

            # Assignments collection indexes
            await self.database.assignments.create_index("tutor_id")
            await self.database.assignments.create_index("student_ids")
            await self.database.assignments.create_index("due_date")
            await self.database.assignments.create_index("status")

            # Progress collection indexes
            await self.database.progress.create_index(
                [("student_id", 1), ("assignment_id", 1)], unique=True
            )
            await self.database.progress.create_index("student_id")
            await self.database.progress.create_index("assignment_id")
            await self.database.progress.create_index(
                "submitted_at"
            )  # For monthly score queries
            await self.database.progress.create_index(
                [("student_id", 1), ("submitted_at", -1)]
            )  # Compound index for analytics

            # Student groups collection indexes
            await self.database.student_groups.create_index("tutor_id")
            await self.database.student_groups.create_index(
                "studentIds"
            )  # For filtering groups by student
            await self.database.student_groups.create_index(
                [("tutor_id", 1), ("studentIds", 1)]
            )  # Compound index for filtered queries

            # Files collection indexes (with tenant isolation)
            await self.database.files.create_index("userId")
            await self.database.files.create_index("uploadthingUrl")
            await self.database.files.create_index("tutor_id")
            await self.database.files.create_index("uploaded_by")
            await self.database.files.create_index([("tutor_id", 1), ("status", 1)])
            await self.database.files.create_index(
                [("tutor_id", 1), ("created_at", -1)]
            )

            # Topics collection indexes (with tenant isolation)
            await self.database.topics.create_index("tutor_id")
            await self.database.topics.create_index("subject_id")
            await self.database.topics.create_index(
                [("tutor_id", 1), ("subject_id", 1)]
            )
            await self.database.topics.create_index([("tutor_id", 1), ("name", 1)])

            # Activities collection indexes (with tenant isolation)
            await self.database.activities.create_index("tutor_id")
            await self.database.activities.create_index("user_id")
            await self.database.activities.create_index("student_id")
            await self.database.activities.create_index(
                [("tutor_id", 1), ("created_at", -1)]
            )
            await self.database.activities.create_index(
                [("student_id", 1), ("created_at", -1)]
            )

            # Student performance collection indexes
            await self.database.student_performance.create_index("student_id")
            await self.database.student_performance.create_index("subject")

            # Conversations collection indexes
            await self.database.conversations.create_index("tutor_id")
            await self.database.conversations.create_index("participants")
            await self.database.conversations.create_index(
                [("tutor_id", 1), ("updated_at", -1)]
            )

            # Messages collection indexes
            await self.database.messages.create_index("conversation_id")
            await self.database.messages.create_index("tutor_id")
            await self.database.messages.create_index(
                [("conversation_id", 1), ("created_at", -1)]
            )
            await self.database.messages.create_index("sender_id")

            # Materials collection indexes
            await self.database.materials.create_index("tutor_id")
            await self.database.materials.create_index("subject_id")
            await self.database.materials.create_index("material_type")
            await self.database.materials.create_index("status")
            await self.database.materials.create_index(
                [("tutor_id", 1), ("created_at", -1)]
            )
            await self.database.materials.create_index(
                [("tutor_id", 1), ("subject_id", 1)]
            )

            # Invitations collection indexes
            await self.database.invitations.create_index("tutor_id")
            await self.database.invitations.create_index("token", unique=True)
            await self.database.invitations.create_index("invitee_email")
            await self.database.invitations.create_index("status")
            await self.database.invitations.create_index("expires_at")
            await self.database.invitations.create_index(
                [("tutor_id", 1), ("status", 1)]
            )
            await self.database.invitations.create_index(
                [("tutor_id", 1), ("created_at", -1)]
            )

            # Assignment templates collection indexes
            await self.database.assignment_templates.create_index("tutor_id")
            await self.database.assignment_templates.create_index("tenant_id")
            await self.database.assignment_templates.create_index("subject_id")
            await self.database.assignment_templates.create_index("status")
            await self.database.assignment_templates.create_index("tags")
            await self.database.assignment_templates.create_index(
                [("tutor_id", 1), ("status", 1)]
            )
            await self.database.assignment_templates.create_index(
                [("tutor_id", 1), ("usage_count", -1)]
            )
            await self.database.assignment_templates.create_index(
                [("tutor_id", 1), ("created_at", -1)]
            )

            logger.info("Database indexes created successfully")

        except Exception as e:
            logger.warning("Failed to create some indexes", error=str(e))


# Global database instance
database = Database()


async def get_database() -> AsyncIOMotorDatabase:
    """Dependency to get database instance"""
    return database.database


async def get_database_sync() -> AsyncIOMotorDatabase:
    """Get database instance synchronously (for WebSocket handlers)"""
    return database.database
