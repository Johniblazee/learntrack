"""
WebSocket event handlers for real-time chat
"""

import structlog
from datetime import datetime
from typing import Dict

from app.websocket.socket_manager import sio, connected_users
from app.websocket.auth import authenticate_socket, get_user_room, get_conversation_room
from app.core.database import get_database as get_database_sync
from app.models.activity import ActivityCreate, ActivityType
from app.services.message_service import MessageService
from app.services.conversation_service import ConversationService
from app.models.message import MessageCreate, MessageType
from app.models.notification import NotificationCreate, NotificationType
from app.services.activity_service import ActivityService
from app.services.notification_service import NotificationService
from bson import ObjectId

logger = structlog.get_logger()


@sio.event
async def connect(sid, environ, auth):
    """
    Handle client connection

    Args:
        sid: Socket ID
        environ: WSGI environment
        auth: Authentication data (should contain 'token')
    """
    logger.info("Client attempting to connect", sid=sid)

    # Authenticate user
    if not auth or "token" not in auth:
        logger.warning("Connection rejected: No token provided", sid=sid)
        return False

    user_context = await authenticate_socket(auth["token"])
    if not user_context:
        logger.warning("Connection rejected: Invalid token", sid=sid)
        return False

    # Store user connection
    connected_users[sid] = {
        "user_id": user_context.clerk_id,
        "user_context": user_context,
    }

    # Join user's personal room
    user_room = get_user_room(user_context.clerk_id)
    await sio.enter_room(sid, user_room)

    logger.info(
        "Client connected",
        sid=sid,
        user_id=user_context.clerk_id,
        role=user_context.role,
    )

    # Emit connection success
    await sio.emit(
        "connected",
        {
            "user_id": user_context.clerk_id,
            "name": user_context.name,
            "role": user_context.role.value,
        },
        room=sid,
    )

    return True


@sio.event
async def disconnect(sid):
    """
    Handle client disconnection

    Args:
        sid: Socket ID
    """
    user_data = connected_users.pop(sid, None)
    if user_data:
        logger.info("Client disconnected", sid=sid, user_id=user_data["user_id"])
    else:
        logger.info("Unknown client disconnected", sid=sid)


@sio.event
async def join_conversation(sid, data):
    """
    Join a conversation room

    Args:
        sid: Socket ID
        data: {conversation_id: str}
    """
    user_data = connected_users.get(sid)
    if not user_data:
        logger.warning("Unauthorized join_conversation attempt", sid=sid)
        return {"error": "Unauthorized"}

    conversation_id = data.get("conversation_id")
    if not conversation_id:
        return {"error": "conversation_id required"}

    user_context = user_data["user_context"]

    # Verify user is participant in conversation
    db = await get_database_sync()
    conversation = await db.conversations.find_one(
        {
            "_id": ObjectId(conversation_id),
            "tutor_id": user_context.tutor_id,
            "participants": user_context.clerk_id,
        }
    )

    if not conversation:
        logger.warning(
            "Unauthorized conversation access", sid=sid, conversation_id=conversation_id
        )
        return {"error": "Conversation not found or access denied"}

    # Join conversation room
    room = get_conversation_room(conversation_id)
    await sio.enter_room(sid, room)

    logger.info(
        "User joined conversation",
        sid=sid,
        user_id=user_context.clerk_id,
        conversation_id=conversation_id,
    )

    return {"success": True, "conversation_id": conversation_id}


@sio.event
async def leave_conversation(sid, data):
    """
    Leave a conversation room

    Args:
        sid: Socket ID
        data: {conversation_id: str}
    """
    user_data = connected_users.get(sid)
    if not user_data:
        return {"error": "Unauthorized"}

    conversation_id = data.get("conversation_id")
    if not conversation_id:
        return {"error": "conversation_id required"}

    # Leave conversation room
    room = get_conversation_room(conversation_id)
    await sio.leave_room(sid, room)

    logger.info("User left conversation", sid=sid, conversation_id=conversation_id)

    return {"success": True}


@sio.event
async def send_message(sid, data):
    """
    Send a message in a conversation

    Args:
        sid: Socket ID
        data: {conversation_id: str, content: str, message_type: str}
    """
    user_data = connected_users.get(sid)
    if not user_data:
        logger.warning("Unauthorized send_message attempt", sid=sid)
        return {"error": "Unauthorized"}

    user_context = user_data["user_context"]

    # Validate data
    conversation_id = data.get("conversation_id")
    content = data.get("content")
    message_type = data.get("message_type", "text")

    if not conversation_id or not content:
        return {"error": "conversation_id and content required"}

    try:
        tenant_id = user_context.tutor_id or user_context.clerk_id
        sender_name = user_context.name or "Unknown User"

        # Create message
        db = await get_database_sync()
        message_service = MessageService(db)

        message_data = MessageCreate(
            conversation_id=conversation_id,
            content=content,
            message_type=MessageType(message_type),
        )

        message = await message_service.create_message(
            message_data=message_data,
            sender_id=user_context.clerk_id,
            sender_name=sender_name,
            sender_role=user_context.role,
            tutor_id=tenant_id,
        )

        # Update conversation's last message
        conversation_service = ConversationService(db)
        await conversation_service.update_last_message(
            conversation_id=conversation_id,
            message_content=content,
            sender_id=user_context.clerk_id,
        )

        preview = " ".join((content or "").split())
        if len(preview) > 120:
            preview = f"{preview[:117].rstrip()}..."

        conversation = await db.conversations.find_one(
            {
                "_id": ObjectId(conversation_id),
                "tutor_id": tenant_id,
            }
        )

        try:
            activity_service = ActivityService(db)
            await activity_service.create_activity(
                activity_data=ActivityCreate(
                    activity_type=ActivityType.MESSAGE_SENT,
                    user_id=user_context.clerk_id,
                    tutor_id=tenant_id,
                    description=f"Sent a message: {preview}",
                    related_entity_id=conversation_id,
                    related_entity_type="conversation",
                    metadata={
                        "delivery_method": "chat",
                    },
                ),
                user_id=user_context.clerk_id,
                tutor_id=tenant_id,
            )
        except Exception as event_error:
            logger.warning(
                "Failed to record websocket message activity",
                sender_id=user_context.clerk_id,
                conversation_id=conversation_id,
                error=str(event_error),
            )

        participant_ids = [
            participant
            for participant in (conversation or {}).get("participants", [])
            if isinstance(participant, str)
        ]
        notification_service = NotificationService(db)
        for recipient_id in participant_ids:
            if recipient_id == user_context.clerk_id:
                continue
            try:
                await notification_service.create_notification(
                    NotificationCreate(
                        title=f"New message from {sender_name}",
                        message=preview,
                        notification_type=NotificationType.MESSAGE_RECEIVED,
                        recipient_id=recipient_id,
                        tutor_id=tenant_id,
                        related_entity_id=conversation_id,
                        related_entity_type="conversation",
                        action_url="/dashboard/messages?mode=chat",
                    )
                )
            except Exception as event_error:
                logger.warning(
                    "Failed to create websocket message notification",
                    sender_id=user_context.clerk_id,
                    recipient_id=recipient_id,
                    conversation_id=conversation_id,
                    error=str(event_error),
                )

        # Broadcast message to conversation room
        room = get_conversation_room(conversation_id)
        message_dict = message.model_dump(by_alias=True)

        await sio.emit("new_message", message_dict, room=room)

        logger.info(
            "Message sent",
            message_id=message.id,
            conversation_id=conversation_id,
            sender=user_context.clerk_id,
        )

        return {"success": True, "message": message_dict}

    except Exception as e:
        logger.error("Failed to send message", error=str(e), sid=sid)
        return {"error": str(e)}


@sio.event
async def typing_start(sid, data):
    """
    User started typing

    Args:
        sid: Socket ID
        data: {conversation_id: str}
    """
    user_data = connected_users.get(sid)
    if not user_data:
        return {"error": "Unauthorized"}

    conversation_id = data.get("conversation_id")
    if not conversation_id:
        return {"error": "conversation_id required"}

    user_context = user_data["user_context"]

    # Broadcast typing indicator to conversation room (except sender)
    room = get_conversation_room(conversation_id)
    await sio.emit(
        "user_typing",
        {
            "user_id": user_context.clerk_id,
            "user_name": user_context.name,
            "conversation_id": conversation_id,
            "typing": True,
        },
        room=room,
        skip_sid=sid,
    )

    return {"success": True}


@sio.event
async def typing_stop(sid, data):
    """
    User stopped typing

    Args:
        sid: Socket ID
        data: {conversation_id: str}
    """
    user_data = connected_users.get(sid)
    if not user_data:
        return {"error": "Unauthorized"}

    conversation_id = data.get("conversation_id")
    if not conversation_id:
        return {"error": "conversation_id required"}

    user_context = user_data["user_context"]

    # Broadcast typing stopped to conversation room (except sender)
    room = get_conversation_room(conversation_id)
    await sio.emit(
        "user_typing",
        {
            "user_id": user_context.clerk_id,
            "user_name": user_context.name,
            "conversation_id": conversation_id,
            "typing": False,
        },
        room=room,
        skip_sid=sid,
    )

    return {"success": True}


@sio.event
async def message_read(sid, data):
    """
    Mark message as read

    Args:
        sid: Socket ID
        data: {message_id: str, conversation_id: str}
    """
    user_data = connected_users.get(sid)
    if not user_data:
        return {"error": "Unauthorized"}

    message_id = data.get("message_id")
    conversation_id = data.get("conversation_id")

    if not message_id:
        return {"error": "message_id required"}

    user_context = user_data["user_context"]

    try:
        # Mark message as read
        db = await get_database_sync()
        message_service = MessageService(db)

        await message_service.mark_as_read(
            message_id=message_id,
            user_id=user_context.clerk_id,
            tutor_id=user_context.tutor_id,
        )

        # Broadcast read receipt to conversation room
        if conversation_id:
            room = get_conversation_room(conversation_id)
            await sio.emit(
                "message_read_receipt",
                {
                    "message_id": message_id,
                    "user_id": user_context.clerk_id,
                    "conversation_id": conversation_id,
                },
                room=room,
            )

        return {"success": True}

    except Exception as e:
        logger.error(
            "Failed to mark message as read", error=str(e), message_id=message_id
        )
        return {"error": str(e)}
