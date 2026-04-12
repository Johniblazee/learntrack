"""
WebSocket endpoint for real-time notifications.

Delivery primitives (ConnectionManager, send_notification_via_websocket) now
live in `app.core.realtime` so services can dispatch realtime events without
importing from the routes layer. This module is just the transport adapter.
"""

import json
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_database
from app.core.enhanced_auth import enhanced_clerk_bearer
from app.core.realtime import (
    connection_manager as manager,
    send_notification_via_websocket,
)

logger = structlog.get_logger()
router = APIRouter()

__all__ = ["router", "manager", "send_notification_via_websocket"]


# DEPRECATED: Use Socket.IO (/ws/socket.io) for new integrations.
# This raw WebSocket endpoint is kept for backward compatibility.
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(..., description="Clerk JWT token"),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    WebSocket endpoint for real-time notifications.

    Client should connect with: ws://localhost:8000/api/v1/ws?token=<clerk_jwt_token>
    """
    user_context = None

    try:
        user_context = await enhanced_clerk_bearer.verify_token(token)
        if not user_context:
            await websocket.close(code=1008, reason="Invalid token")
            return

        user_id = user_context.clerk_id

        await manager.connect(websocket, user_id)

        await websocket.send_json(
            {
                "type": "connection",
                "status": "connected",
                "user_id": user_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)

                if message.get("type") == "ping":
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                elif message.get("type") == "subscribe":
                    channels = message.get("channels", [])
                    logger.info(
                        "Client subscribed to channels",
                        user_id=user_id,
                        channels=channels,
                    )
                    await websocket.send_json(
                        {
                            "type": "subscribed",
                            "channels": channels,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                else:
                    logger.warning(
                        "Unknown message type",
                        user_id=user_id,
                        message_type=message.get("type"),
                    )

            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                logger.error("Invalid JSON received", user_id=user_id)
            except Exception as exc:
                logger.error(
                    "Error processing message", user_id=user_id, error=str(exc)
                )
                break

    except Exception as exc:
        logger.error("WebSocket error", error=str(exc))

    finally:
        if user_context:
            manager.disconnect(websocket, user_context.clerk_id)
