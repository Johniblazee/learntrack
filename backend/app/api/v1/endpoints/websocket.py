"""
WebSocket endpoint for real-time notifications
"""
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
import json
from datetime import datetime, timezone

from app.core.database import get_database
from app.core.enhanced_auth import enhanced_clerk_bearer

logger = structlog.get_logger()
router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections"""
    
    def __init__(self):
        # Map of user_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str):
        """Accept and store a new WebSocket connection"""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        logger.info("WebSocket connected", user_id=user_id, total_connections=len(self.active_connections[user_id]))
    
    def disconnect(self, websocket: WebSocket, user_id: str):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info("WebSocket disconnected", user_id=user_id)
    
    async def send_personal_message(self, message: dict, user_id: str):
        """Send a message to a specific user (all their connections)"""
        if user_id in self.active_connections:
            disconnected = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error("Failed to send message", user_id=user_id, error=str(e))
                    disconnected.add(connection)
            
            # Clean up disconnected connections
            for connection in disconnected:
                self.active_connections[user_id].discard(connection)
    
    async def broadcast(self, message: dict, user_ids: list = None):
        """Broadcast a message to multiple users or all users"""
        target_users = user_ids if user_ids else list(self.active_connections.keys())
        
        for user_id in target_users:
            await self.send_personal_message(message, user_id)


# Global connection manager instance
manager = ConnectionManager()


# DEPRECATED: Use Socket.IO (/ws/socket.io) for new integrations.
# This raw WebSocket endpoint is kept for backward compatibility.
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(..., description="Clerk JWT token"),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """
    WebSocket endpoint for real-time notifications
    
    Client should connect with: ws://localhost:8000/api/v1/ws?token=<clerk_jwt_token>
    """
    user_context = None

    try:
        # Verify token and get user context
        user_context = await enhanced_clerk_bearer.verify_token(token)
        if not user_context:
            await websocket.close(code=1008, reason="Invalid token")
            return

        user_id = user_context.clerk_id
        
        # Accept connection
        await manager.connect(websocket, user_id)
        
        # Send welcome message
        await websocket.send_json({
            "type": "connection",
            "status": "connected",
            "user_id": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Receive message from client
                data = await websocket.receive_text()
                message = json.loads(data)
                
                # Handle different message types
                if message.get("type") == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                elif message.get("type") == "subscribe":
                    # Client wants to subscribe to specific channels
                    channels = message.get("channels", [])
                    logger.info("Client subscribed to channels", user_id=user_id, channels=channels)
                    await websocket.send_json({
                        "type": "subscribed",
                        "channels": channels,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                else:
                    logger.warning("Unknown message type", user_id=user_id, message_type=message.get("type"))
                    
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                logger.error("Invalid JSON received", user_id=user_id)
            except Exception as e:
                logger.error("Error processing message", user_id=user_id, error=str(e))
                break
    
    except Exception as e:
        logger.error("WebSocket error", error=str(e))
    
    finally:
        # Clean up connection
        if user_context:
            manager.disconnect(websocket, user_context.clerk_id)


# Helper function to send notifications via WebSocket
async def send_notification_via_websocket(user_id: str, notification: dict):
    """Send a notification to a user via WebSocket (raw WS) and Socket.IO."""
    from app.websocket.socket_manager import sio
    from app.websocket.auth import get_user_room

    message = {
        "type": "notification",
        "data": notification,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    # Raw WebSocket delivery (for clients connected via /api/v1/ws)
    await manager.send_personal_message(message, user_id)
    # Socket.IO delivery (for clients connected via /ws/socket.io)
    await sio.emit("notification", message, room=get_user_room(user_id))

