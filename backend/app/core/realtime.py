"""
Realtime delivery primitives shared between services and transport endpoints.

Services must not import from `app.api.v1.endpoints.*` — that inverts the
layering (routes depend on services, not the other way round) and breaks when
a service is invoked outside the FastAPI app lifecycle (e.g. background
workers, tests). This module owns the raw-WebSocket connection manager and
the `send_notification_via_websocket` helper so both the WebSocket route and
the notification service can import it from a neutral location.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

import structlog
from fastapi import WebSocket

logger = structlog.get_logger()


class ConnectionManager:
    """Tracks raw WebSocket connections keyed by user id."""

    def __init__(self) -> None:
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        logger.info(
            "WebSocket connected",
            user_id=user_id,
            total_connections=len(self.active_connections[user_id]),
        )

    def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info("WebSocket disconnected", user_id=user_id)

    async def send_personal_message(self, message: dict, user_id: str) -> None:
        if user_id not in self.active_connections:
            return
        disconnected: Set[WebSocket] = set()
        for connection in self.active_connections[user_id]:
            try:
                await connection.send_json(message)
            except Exception as exc:
                logger.error(
                    "Failed to send WebSocket message",
                    user_id=user_id,
                    error=str(exc),
                )
                disconnected.add(connection)
        for connection in disconnected:
            self.active_connections[user_id].discard(connection)

    async def broadcast(
        self, message: dict, user_ids: Optional[List[str]] = None
    ) -> None:
        target_users = user_ids if user_ids else list(self.active_connections.keys())
        for user_id in target_users:
            await self.send_personal_message(message, user_id)


connection_manager = ConnectionManager()


async def send_notification_via_websocket(user_id: str, notification: dict) -> None:
    """Deliver a notification payload to a user over raw WS and Socket.IO."""
    from app.websocket.socket_manager import sio
    from app.websocket.auth import get_user_room

    message = {
        "type": "notification",
        "data": notification,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await connection_manager.send_personal_message(message, user_id)
    await sio.emit("notification", message, room=get_user_room(user_id))
