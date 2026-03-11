from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.config import settings
from app.core.database import get_database
from app.models.user import UserCreate, UserRole, UserUpdate
from app.services.user_service import UserService
from app.utils.slug import generate_unique_slug

logger = structlog.get_logger()
router = APIRouter()


def _get_svix_webhook_tools():
    from svix.webhooks import Webhook, WebhookVerificationError

    return Webhook, WebhookVerificationError


def _get_metadata(data: Dict[str, Any]) -> Dict[str, Any]:
    """Merge Clerk metadata dictionaries with public metadata precedence."""
    merged: Dict[str, Any] = {}

    unsafe_metadata = data.get("unsafe_metadata")
    public_metadata = data.get("public_metadata")

    if isinstance(unsafe_metadata, dict):
        merged.update(unsafe_metadata)
    if isinstance(public_metadata, dict):
        merged.update(public_metadata)

    return merged


def _collection_name_for_role(role: UserRole) -> str:
    if role in {UserRole.TUTOR, UserRole.SUPER_ADMIN}:
        return "tutors"
    if role == UserRole.STUDENT:
        return "students"
    return "parents"


def _extract_role(data: Dict[str, Any], fallback: UserRole) -> UserRole:
    metadata = _get_metadata(data)
    role_raw = metadata.get("role")

    if isinstance(role_raw, str) and role_raw.strip():
        normalized_role = role_raw.strip().lower()
        try:
            return UserRole(normalized_role)
        except ValueError:
            logger.warning(
                "Invalid role in Clerk webhook payload",
                role=role_raw,
                fallback_role=fallback.value,
                clerk_id=data.get("id"),
            )

    return fallback


def _extract_email(data: Dict[str, Any], fallback: Optional[str] = None) -> str:
    email_addresses = data.get("email_addresses")
    if not isinstance(email_addresses, list):
        email_addresses = []

    primary_email_id = data.get("primary_email_address_id")
    if isinstance(primary_email_id, str):
        for email_record in email_addresses:
            if not isinstance(email_record, dict):
                continue
            if email_record.get("id") == primary_email_id:
                email_address = email_record.get("email_address")
                if isinstance(email_address, str) and email_address:
                    return email_address

    for email_record in email_addresses:
        if not isinstance(email_record, dict):
            continue
        verification = email_record.get("verification")
        verification_status = (
            verification.get("status") if isinstance(verification, dict) else None
        )
        if verification_status == "verified":
            email_address = email_record.get("email_address")
            if isinstance(email_address, str) and email_address:
                return email_address

    for email_record in email_addresses:
        if not isinstance(email_record, dict):
            continue
        email_address = email_record.get("email_address")
        if isinstance(email_address, str) and email_address:
            return email_address

    if fallback:
        return fallback

    clerk_id = data.get("id")
    if isinstance(clerk_id, str) and clerk_id:
        return f"{clerk_id}@placeholder.local"

    return "unknown@placeholder.local"


def _extract_name(data: Dict[str, Any], fallback: Optional[str] = None) -> str:
    first_name = (
        data.get("first_name") if isinstance(data.get("first_name"), str) else ""
    )
    last_name = data.get("last_name") if isinstance(data.get("last_name"), str) else ""

    full_name = f"{first_name} {last_name}".strip()
    if full_name:
        return full_name

    username = data.get("username")
    if isinstance(username, str) and username.strip():
        return username.strip()

    if fallback:
        return fallback

    return "Unknown User"


def _extract_tutor_id(data: Dict[str, Any]) -> Optional[str]:
    metadata = _get_metadata(data)
    tutor_id_raw = metadata.get("tutor_id")

    if isinstance(tutor_id_raw, str) and tutor_id_raw.strip():
        return tutor_id_raw.strip()

    return None


async def _migrate_user_between_role_collections(
    db: AsyncIOMotorDatabase,
    clerk_id: str,
    existing_role: UserRole,
    target_role: UserRole,
    name: str,
    email: str,
    tutor_id_from_metadata: Optional[str],
    is_active_update: Optional[bool],
) -> None:
    """Move a user document between role collections when role changes."""
    source_collection_name = _collection_name_for_role(existing_role)
    target_collection_name = _collection_name_for_role(target_role)

    source_collection = db[source_collection_name]
    target_collection = db[target_collection_name]

    source_document = await source_collection.find_one({"clerk_id": clerk_id})
    if not source_document:
        # Data drift safety: fall back to whichever collection has the user
        for collection_name in ["tutors", "students", "parents"]:
            candidate = await db[collection_name].find_one({"clerk_id": clerk_id})
            if candidate:
                source_document = candidate
                source_collection_name = collection_name
                source_collection = db[source_collection_name]
                break

    if not source_document:
        raise ValueError("Cannot migrate user role: source user document not found")

    now = datetime.now(timezone.utc)
    migrated_document = {k: v for k, v in source_document.items() if k != "_id"}
    migrated_document.update(
        {
            "clerk_id": clerk_id,
            "email": email,
            "name": name,
            "role": target_role.value,
            "updated_at": now,
        }
    )

    if is_active_update is not None:
        migrated_document["is_active"] = is_active_update

    if target_role in {UserRole.TUTOR, UserRole.SUPER_ADMIN}:
        migrated_document["tutor_id"] = clerk_id
        migrated_document["tenant_id"] = clerk_id
        migrated_document.setdefault("tutor_subjects", [])
        migrated_document["is_super_admin"] = target_role == UserRole.SUPER_ADMIN
        if target_role != UserRole.SUPER_ADMIN:
            migrated_document["admin_permissions"] = []
    elif target_role == UserRole.STUDENT:
        if tutor_id_from_metadata:
            migrated_document["tutor_id"] = tutor_id_from_metadata
            migrated_document["tenant_id"] = tutor_id_from_metadata
        else:
            if migrated_document.get("tutor_id") == clerk_id:
                migrated_document["tutor_id"] = None
            if migrated_document.get("tenant_id") == clerk_id:
                migrated_document["tenant_id"] = migrated_document.get("tutor_id")
        migrated_document.setdefault("student_tutors", [])
        migrated_document["is_super_admin"] = False
        migrated_document["admin_permissions"] = []
    else:
        if tutor_id_from_metadata:
            migrated_document["tutor_id"] = tutor_id_from_metadata
            migrated_document["tenant_id"] = tutor_id_from_metadata
        else:
            if migrated_document.get("tutor_id") == clerk_id:
                migrated_document["tutor_id"] = None
            if migrated_document.get("tenant_id") == clerk_id:
                migrated_document["tenant_id"] = migrated_document.get("tutor_id")
        migrated_document.setdefault("parent_children", [])
        migrated_document.setdefault(
            "student_ids", migrated_document.get("parent_children", [])
        )
        migrated_document["is_super_admin"] = False
        migrated_document["admin_permissions"] = []

    should_regenerate_slug = (
        target_collection_name != source_collection_name
        or source_document.get("name") != name
        or not source_document.get("slug")
    )
    if should_regenerate_slug:
        target_existing = await target_collection.find_one({"clerk_id": clerk_id})
        exclude_id = target_existing.get("_id") if target_existing else None
        migrated_document["slug"] = await generate_unique_slug(
            db,
            target_collection_name,
            name,
            exclude_id=exclude_id,
        )

    await target_collection.update_one(
        {"clerk_id": clerk_id},
        {"$set": migrated_document},
        upsert=True,
    )

    if source_collection_name != target_collection_name:
        await source_collection.delete_one({"clerk_id": clerk_id})


async def _sync_user_from_clerk(
    db: AsyncIOMotorDatabase,
    user_service: UserService,
    data: Dict[str, Any],
) -> Tuple[str, UserRole]:
    clerk_id = data.get("id")
    if not isinstance(clerk_id, str) or not clerk_id:
        raise ValueError("Clerk webhook payload missing user id")

    existing_user = await user_service.get_user_by_clerk_id(clerk_id)
    fallback_role = existing_user.role if existing_user else UserRole.STUDENT

    role = _extract_role(data, fallback=fallback_role)
    email = _extract_email(
        data, fallback=existing_user.email if existing_user else None
    )
    name = _extract_name(data, fallback=existing_user.name if existing_user else None)
    tutor_id_from_metadata = _extract_tutor_id(data)

    is_active_update: Optional[bool] = None
    if "banned" in data:
        is_active_update = not bool(data.get("banned"))

    if not existing_user:
        tutor_id = (
            clerk_id
            if role in {UserRole.TUTOR, UserRole.SUPER_ADMIN}
            else tutor_id_from_metadata
        )
        tenant_id = (
            clerk_id if role in {UserRole.TUTOR, UserRole.SUPER_ADMIN} else tutor_id
        )

        await user_service.create_user(
            UserCreate(
                clerk_id=clerk_id,
                email=email,
                name=name,
                role=role,
                tutor_id=tutor_id,
                tenant_id=tenant_id,
                is_active=True if is_active_update is None else is_active_update,
            )
        )
        return ("created", role)

    if existing_user.role == role:
        user_update_payload = {
            "email": email,
            "name": name,
            "role": role,
            "updated_at": datetime.now(timezone.utc),
        }
        if is_active_update is not None:
            user_update_payload["is_active"] = is_active_update

        await user_service.update_user(
            existing_user.id,
            UserUpdate(**user_update_payload),
        )

        if role == UserRole.SUPER_ADMIN:
            await db.tutors.update_one(
                {"clerk_id": clerk_id},
                {"$set": {"is_super_admin": True}},
            )

        return ("updated", role)

    await _migrate_user_between_role_collections(
        db=db,
        clerk_id=clerk_id,
        existing_role=existing_user.role,
        target_role=role,
        name=name,
        email=email,
        tutor_id_from_metadata=tutor_id_from_metadata,
        is_active_update=is_active_update,
    )
    return ("migrated", role)


@router.post("/clerk")
async def clerk_webhook(
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Handle Clerk webhook events for user lifecycle updates."""

    webhook_secret = settings.CLERK_WEBHOOK_SECRET
    if not webhook_secret:
        logger.error("CLERK_WEBHOOK_SECRET is not configured")
        raise HTTPException(status_code=500, detail="Webhook secret is not configured")

    Webhook, WebhookVerificationError = _get_svix_webhook_tools()

    try:
        headers = request.headers
        payload = await request.body()

        svix_id = headers.get("svix-id")
        svix_timestamp = headers.get("svix-timestamp")
        svix_signature = headers.get("svix-signature")

        if not all([svix_id, svix_timestamp, svix_signature]):
            raise HTTPException(status_code=400, detail="Missing Svix headers")

        webhook = Webhook(webhook_secret)
        webhook_headers: Dict[str, str] = {key: value for key, value in headers.items()}
        event = webhook.verify(payload, webhook_headers)

    except WebhookVerificationError as exc:
        logger.error("Webhook verification failed", error=str(exc))
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to verify Clerk webhook", error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to verify webhook")

    event_type = event.get("type")
    data = event.get("data")
    if not isinstance(data, dict):
        data = {}

    user_service = UserService(db)

    try:
        if event_type in {"user.created", "user.updated"}:
            action, role = await _sync_user_from_clerk(db, user_service, data)
            logger.info(
                "Processed Clerk user webhook",
                event_type=event_type,
                action=action,
                clerk_id=data.get("id"),
                role=role.value,
            )
        else:
            logger.debug(
                "Ignoring unsupported Clerk webhook event", event_type=event_type
            )

        return {"status": "success", "message": f"Handled event: {event_type}"}

    except Exception as exc:
        logger.error(
            "Error handling Clerk webhook event",
            event_type=event_type,
            clerk_id=data.get("id"),
            error=str(exc),
        )
        # Return HTTP 200 to avoid endless retries for internal logic errors.
        return {"status": "error", "message": "Failed to process webhook event"}
