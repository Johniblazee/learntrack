"""
Socket.IO manager for real-time chat
"""

import socketio
import structlog
from typing import Dict

from app.core.config import settings

logger = structlog.get_logger()

# Create Socket.IO server with CORS configuration
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.BACKEND_CORS_ORIGINS,
    logger=False,  # Disable socket.io logger to use structlog
    engineio_logger=False,
)

# Create ASGI app
socket_app = socketio.ASGIApp(sio, socketio_path="socket.io")

# Store connected users: {sid: {user_id, user_context}}
connected_users: Dict[str, Dict] = {}
_events_registered = False


def ensure_socket_events_registered() -> None:
    """Register Socket.IO handlers lazily."""
    global _events_registered
    if _events_registered:
        return

    from app.websocket import events  # noqa: F401

    _events_registered = True


def get_socket_app():
    """Get Socket.IO ASGI app"""
    ensure_socket_events_registered()
    return socket_app
