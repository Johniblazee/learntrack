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
        self._client_lock = asyncio.Lock()
        self._ping_lock = asyncio.Lock()
        self._index_lock = asyncio.Lock()
        self._connection_verified = False
        self._indexes_ready = False

    async def init_client(self) -> AsyncIOMotorDatabase:
        """Create the Mongo client without blocking on network work."""
        if self.client is not None and self.database is not None:
            return self.database

        async with self._client_lock:
            if self.client is None or self.database is None:
                logger.info("Initializing MongoDB client", url=settings.MONGODB_URL)
                self.client = AsyncIOMotorClient(
                    settings.MONGODB_URL,
                    serverSelectionTimeoutMS=settings.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
                    connectTimeoutMS=settings.MONGODB_CONNECT_TIMEOUT_MS,
                    socketTimeoutMS=settings.MONGODB_SOCKET_TIMEOUT_MS,
                )
                self.database = self.client[settings.DATABASE_NAME]
                self._connection_verified = False
                self._indexes_ready = False

        assert self.database is not None
        return self.database

    async def ensure_connected(self) -> AsyncIOMotorDatabase:
        """Verify MongoDB connectivity when needed."""
        database = await self.init_client()
        if self._connection_verified:
            return database

        async with self._ping_lock:
            if not self._connection_verified:
                assert self.client is not None
                await self.client.admin.command("ping")
                self._connection_verified = True
                logger.info("Successfully connected to MongoDB")

        return database

    async def connect_to_database(self, ensure_indexes: bool = True):
        """Create database connection and optionally ensure indexes."""
        try:
            await self.init_client()
            await self.ensure_connected()
            if ensure_indexes:
                await self.ensure_indexes()

        except Exception as e:
            logger.error("Failed to connect to MongoDB", error=str(e))
            raise

    async def close_database_connection(self):
        """Close database connection"""
        if self.client:
            logger.info("Closing MongoDB connection")
            self.client.close()
            self.client = None
            self.database = None
            self._connection_verified = False
            self._indexes_ready = False

    async def ensure_indexes(self, force: bool = False):
        """Create database indexes for better performance."""
        try:
            await self.init_client()
            if self._indexes_ready and not force:
                return

            async with self._index_lock:
                if self._indexes_ready and not force:
                    return

                await self._create_indexes()
                self._indexes_ready = True
                logger.info("Database indexes created successfully")

        except Exception as e:
            logger.warning("Failed to create some indexes", error=str(e))

    async def _create_indexes(self):
        """Create database indexes for better performance."""
        if self.database is None:
            raise RuntimeError("Database is not initialized")

        db = self.database

        try:
            # Tutors collection indexes
            await db.tutors.create_index("clerk_id", unique=True)
            await db.tutors.create_index("email", unique=True)
            await db.tutors.create_index("slug", unique=True)
            await db.tutors.create_index("tenant_id")

            # Students collection indexes
            await db.students.create_index("clerk_id", unique=True)
            await db.students.create_index("email", unique=True)
            await db.students.create_index("slug", unique=True)
            await db.students.create_index("tutor_id")
            await db.students.create_index("tenant_id")
            await db.students.create_index("parent_ids")
            await db.students.create_index([("tutor_id", 1), ("is_active", 1)])

            # Parents collection indexes
            await db.parents.create_index("clerk_id", unique=True)
            await db.parents.create_index("email", unique=True)
            await db.parents.create_index("slug", unique=True)
            await db.parents.create_index("tutor_id")
            await db.parents.create_index("tenant_id")
            await db.parents.create_index("student_ids")
            await db.parents.create_index("parent_children")
            await db.parents.create_index([("tutor_id", 1), ("student_ids", 1)])
            await db.parents.create_index([("tutor_id", 1), ("parent_children", 1)])

            # Subjects collection indexes
            await db.subjects.create_index("tutor_id")
            await db.subjects.create_index([("tutor_id", 1), ("name", 1)], unique=True)

            # Questions collection indexes
            await db.questions.create_index("subject_id")
            await db.questions.create_index("tutor_id")
            await db.questions.create_index([("subject_id", 1), ("topic", 1)])

            # Assignments collection indexes
            await db.assignments.create_index("tutor_id")
            await db.assignments.create_index("student_ids")
            await db.assignments.create_index("due_date")
            await db.assignments.create_index("status")
            await db.assignments.create_index([("tutor_id", 1), ("status", 1)])
            await db.assignments.create_index([("tutor_id", 1), ("created_at", -1)])

            # Progress collection indexes
            await db.progress.create_index(
                [("student_id", 1), ("assignment_id", 1)], unique=True
            )
            await db.progress.create_index("student_id")
            await db.progress.create_index("assignment_id")
            await db.progress.create_index("submitted_at")  # For monthly score queries
            await db.progress.create_index(
                [("student_id", 1), ("submitted_at", -1)]
            )  # Compound index for analytics

            # Student groups collection indexes
            await db.student_groups.create_index("tutor_id")
            await db.student_groups.create_index(
                "studentIds"
            )  # For filtering groups by student
            await db.student_groups.create_index(
                [("tutor_id", 1), ("studentIds", 1)]
            )  # Compound index for filtered queries

            # Files collection indexes (with tenant isolation)
            await db.files.create_index("userId")
            await db.files.create_index("uploadthingUrl")
            await db.files.create_index("tutor_id")
            await db.files.create_index("uploaded_by")
            await db.files.create_index([("tutor_id", 1), ("status", 1)])
            await db.files.create_index([("tutor_id", 1), ("created_at", -1)])
            await db.files.create_index("uploadthing_key", unique=True)
            await db.files.create_index([("tutor_id", 1), ("embedding_status", 1)])
            await db.files.create_index([("tutor_id", 1), ("sync_status", 1)])

            # Topics collection indexes (with tenant isolation)
            await db.topics.create_index("tutor_id")
            await db.topics.create_index("subject_id")
            await db.topics.create_index([("tutor_id", 1), ("subject_id", 1)])
            await db.topics.create_index([("tutor_id", 1), ("name", 1)])

            # Activities collection indexes (with tenant isolation)
            await db.activities.create_index("tutor_id")
            await db.activities.create_index("user_id")
            await db.activities.create_index("student_id")
            await db.activities.create_index([("tutor_id", 1), ("created_at", -1)])
            await db.activities.create_index([("student_id", 1), ("created_at", -1)])

            # Student performance collection indexes
            await db.student_performance.create_index("student_id")
            await db.student_performance.create_index("subject")

            # Conversations collection indexes
            await db.conversations.create_index("tutor_id")
            await db.conversations.create_index("participants")
            await db.conversations.create_index([("tutor_id", 1), ("updated_at", -1)])

            # Messages collection indexes
            await db.messages.create_index("conversation_id")
            await db.messages.create_index("tutor_id")
            await db.messages.create_index([("conversation_id", 1), ("created_at", -1)])
            await db.messages.create_index("sender_id")

            # Materials collection indexes
            await db.materials.create_index("tutor_id")
            await db.materials.create_index("subject_id")
            await db.materials.create_index("material_type")
            await db.materials.create_index("status")
            await db.materials.create_index([("tutor_id", 1), ("created_at", -1)])
            await db.materials.create_index([("tutor_id", 1), ("subject_id", 1)])
            await db.materials.create_index([("tutor_id", 1), ("file_id", 1)])

            # Material folders collection indexes
            await db.material_folders.create_index("tutor_id")
            await db.material_folders.create_index("parent_id")
            await db.material_folders.create_index(
                [("tutor_id", 1), ("parent_id", 1), ("name", 1)], unique=True
            )

            # Invitations collection indexes
            await db.invitations.create_index("tutor_id")
            await db.invitations.create_index("token", unique=True)
            await db.invitations.create_index("invitee_email")
            await db.invitations.create_index("status")
            await db.invitations.create_index("expires_at")
            await db.invitations.create_index([("tutor_id", 1), ("status", 1)])
            await db.invitations.create_index([("tutor_id", 1), ("created_at", -1)])

            # Notifications collection indexes
            await db.notifications.create_index("recipient_id")
            await db.notifications.create_index("is_read")
            await db.notifications.create_index([("recipient_id", 1), ("is_read", 1)])
            await db.notifications.create_index(
                [("recipient_id", 1), ("created_at", -1)]
            )

            # User settings collection indexes
            await db.user_settings.create_index("user_id", unique=True)

            # Generation sessions collection indexes
            await db.generation_sessions.create_index("user_id")
            await db.generation_sessions.create_index("tenant_id")
            await db.generation_sessions.create_index(
                [("user_id", 1), ("tenant_id", 1), ("updated_at", -1)]
            )

            # Impersonation session indexes
            await db.impersonation_sessions.create_index("admin_clerk_id")
            await db.impersonation_sessions.create_index(
                "expires_at",
                expireAfterSeconds=0,
            )

            # Text search indexes
            await db.questions.create_index(
                [("question_text", "text"), ("topic", "text")]
            )
            await db.materials.create_index(
                [("title", "text"), ("description", "text")]
            )

            # Assignment templates collection indexes
            await db.assignment_templates.create_index("tutor_id")
            await db.assignment_templates.create_index("tenant_id")
            await db.assignment_templates.create_index("subject_id")
            await db.assignment_templates.create_index("status")
            await db.assignment_templates.create_index("tags")
            await db.assignment_templates.create_index([("tutor_id", 1), ("status", 1)])
            await db.assignment_templates.create_index(
                [("tutor_id", 1), ("usage_count", -1)]
            )
            await db.assignment_templates.create_index(
                [("tutor_id", 1), ("created_at", -1)]
            )

        except Exception as e:
            raise e


# Global database instance
database = Database()


async def get_database() -> AsyncIOMotorDatabase:
    """Dependency to get database instance"""
    if database.database is None:
        await database.init_client()
    assert database.database is not None
    db = database.database
    return db


async def get_database_sync() -> AsyncIOMotorDatabase:
    """Get database instance synchronously (for WebSocket handlers)"""
    if database.database is None:
        await database.init_client()
    assert database.database is not None
    db = database.database
    return db
