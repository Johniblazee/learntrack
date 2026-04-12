"""
Notification service for managing notifications
"""

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.notification import (
    Notification,
    NotificationCreate,
    NotificationUpdate,
    NotificationInDB,
    NotificationType,
)

logger = structlog.get_logger()


class NotificationService:
    """Service for managing notifications"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.notifications

    async def _is_notification_enabled(
        self,
        recipient_id: str,
        notification_type: NotificationType,
    ) -> bool:
        user_settings = await self.db.user_settings.find_one({"user_id": recipient_id})
        if not user_settings:
            return True

        preferences = user_settings.get("notifications", {}) or {}
        message_notifications = preferences.get("message_notifications", True)
        assignment_reminders = preferences.get("assignment_reminders", True)

        if (
            notification_type == NotificationType.MESSAGE_RECEIVED
            and not message_notifications
        ):
            return False

        if (
            notification_type
            in {
                NotificationType.ASSIGNMENT_SUBMITTED,
                NotificationType.ASSIGNMENT_GRADED,
                NotificationType.ASSIGNMENT_DUE_SOON,
                NotificationType.ASSIGNMENT_OVERDUE,
            }
            and not assignment_reminders
        ):
            return False

        return True

    async def create_notification(
        self, notification_data: NotificationCreate
    ) -> Optional[Notification]:
        """Create a new notification"""
        try:
            if not await self._is_notification_enabled(
                notification_data.recipient_id,
                notification_data.notification_type,
            ):
                logger.info(
                    "Notification suppressed by recipient preferences",
                    recipient_id=notification_data.recipient_id,
                    notification_type=notification_data.notification_type.value,
                )
                return None

            notification_dict: Dict[str, Any] = notification_data.model_dump()
            notification_dict["is_read"] = False
            notification_dict["created_at"] = datetime.now(timezone.utc)
            notification_dict["read_at"] = None

            result = await self.collection.insert_one(notification_dict)
            notification_dict["_id"] = str(result.inserted_id)

            notification = Notification(**notification_dict)

            # Send notification via WebSocket
            try:
                from app.core.realtime import send_notification_via_websocket

                await send_notification_via_websocket(
                    notification_data.recipient_id, notification.model_dump()
                )
            except Exception as ws_error:
                # Don't fail notification creation if WebSocket fails
                logger.warning(
                    "Failed to send WebSocket notification", error=str(ws_error)
                )

            return notification
        except Exception as e:
            logger.error("Failed to create notification", error=str(e))
            raise

    async def bulk_create_notifications(
        self, notifications_data: List[NotificationCreate]
    ) -> int:
        """Create multiple notifications in a single DB round-trip using insert_many."""
        if not notifications_data:
            return 0
        try:
            now = datetime.now(timezone.utc)
            docs: List[Dict[str, Any]] = []
            for notification_data in notifications_data:
                if not await self._is_notification_enabled(
                    notification_data.recipient_id,
                    notification_data.notification_type,
                ):
                    continue
                doc: Dict[str, Any] = notification_data.model_dump()
                doc["is_read"] = False
                doc["created_at"] = now
                doc["read_at"] = None
                docs.append(doc)

            if not docs:
                return 0

            result = await self.collection.insert_many(docs, ordered=False)
            inserted_count = len(result.inserted_ids)

            # Fire WebSocket notifications concurrently (best-effort)
            try:
                from app.core.realtime import send_notification_via_websocket
                import asyncio

                ws_tasks = []
                for doc, inserted_id in zip(docs, result.inserted_ids):
                    doc_copy = dict(doc)
                    doc_copy["_id"] = str(inserted_id)
                    ws_tasks.append(
                        send_notification_via_websocket(doc["recipient_id"], doc_copy)
                    )
                await asyncio.gather(*ws_tasks, return_exceptions=True)
            except Exception as ws_error:
                logger.warning(
                    "Failed to send bulk WebSocket notifications", error=str(ws_error)
                )

            return inserted_count
        except Exception as e:
            logger.error("Failed to bulk create notifications", error=str(e))
            raise

    async def get_user_notifications(
        self, user_id: str, limit: int = 50, unread_only: bool = False
    ) -> List[Notification]:
        """Get notifications for a user"""
        try:
            query = {"recipient_id": user_id}
            if unread_only:
                query["is_read"] = False

            cursor = self.collection.find(query).sort("created_at", -1).limit(limit)
            notifications_data = await cursor.to_list(length=limit)

            notifications = []
            for notif_data in notifications_data:
                notif_data["_id"] = str(notif_data["_id"])
                notifications.append(Notification(**notif_data))

            return notifications
        except Exception as e:
            logger.error("Failed to get user notifications", error=str(e))
            raise

    async def mark_as_read(
        self, notification_id: str, user_id: str
    ) -> Optional[Notification]:
        """Mark a notification as read"""
        try:
            result = await self.collection.find_one_and_update(
                {"_id": ObjectId(notification_id), "recipient_id": user_id},
                {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc)}},
                return_document=True,
            )

            if result:
                result["_id"] = str(result["_id"])
                return Notification(**result)
            return None
        except Exception as e:
            logger.error("Failed to mark notification as read", error=str(e))
            raise

    async def mark_all_as_read(self, user_id: str) -> int:
        """Mark all notifications as read for a user"""
        try:
            result = await self.collection.update_many(
                {"recipient_id": user_id, "is_read": False},
                {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc)}},
            )
            return result.modified_count
        except Exception as e:
            logger.error("Failed to mark all notifications as read", error=str(e))
            raise

    async def delete_notification(self, notification_id: str, user_id: str) -> bool:
        """Delete a notification"""
        try:
            result = await self.collection.delete_one(
                {"_id": ObjectId(notification_id), "recipient_id": user_id}
            )
            return result.deleted_count > 0
        except Exception as e:
            logger.error("Failed to delete notification", error=str(e))
            raise

    async def get_unread_count(self, user_id: str) -> int:
        """Get count of unread notifications for a user"""
        try:
            count = await self.collection.count_documents(
                {"recipient_id": user_id, "is_read": False}
            )
            return count
        except Exception as e:
            logger.error("Failed to get unread count", error=str(e))
            raise

    async def get_notifications_count(
        self, user_id: str, unread_only: bool = False
    ) -> int:
        """Get total count of notifications for a user"""
        try:
            query = {"recipient_id": user_id}
            if unread_only:
                query["is_read"] = False

            count = await self.collection.count_documents(query)
            return count
        except Exception as e:
            logger.error("Failed to get notifications count", error=str(e))
            raise

    async def get_user_notifications_paginated(
        self, user_id: str, skip: int = 0, limit: int = 10, unread_only: bool = False
    ) -> List[Notification]:
        """Get paginated notifications for a user"""
        try:
            query = {"recipient_id": user_id}
            if unread_only:
                query["is_read"] = False

            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(limit)
            )
            notifications_data = await cursor.to_list(length=limit)

            notifications = []
            for notif_data in notifications_data:
                notif_data["_id"] = str(notif_data["_id"])
                notifications.append(Notification(**notif_data))

            return notifications
        except Exception as e:
            logger.error("Failed to get paginated notifications", error=str(e))
            raise
