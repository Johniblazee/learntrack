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
    async_mode='asgi',
    cors_allowed_origins=settings.BACKEND_CORS_ORIGINS,
    logger=False,  # Disable socket.io logger to use structlog
    engineio_logger=False
)

# Create ASGI app
socket_app = socketio.ASGIApp(
    sio,
    socketio_path='socket.io'
)

# Store connected users: {sid: {user_id, user_context}}
connected_users: Dict[str, Dict] = {}


def get_socket_app():
    """Get Socket.IO ASGI app"""
    return socket_app


# Import event handlers after sio is created to avoid circular imports
from app.websocket import events  # noqa: E402, F401

