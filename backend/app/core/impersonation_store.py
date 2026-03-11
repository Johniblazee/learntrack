from datetime import datetime, timezone
from typing import List, Optional

from app.core.database import get_database
from app.models.admin import ImpersonationSession


COLLECTION_NAME = "impersonation_sessions"


def _session_from_doc(doc: Optional[dict]) -> Optional[ImpersonationSession]:
    if not doc:
        return None

    normalized = dict(doc)
    normalized.pop("_id", None)
    return ImpersonationSession(**normalized)


async def _get_collection():
    db = await get_database()
    if db is None:
        raise RuntimeError("Database is not available")
    return db[COLLECTION_NAME]


async def put_impersonation_session(session: ImpersonationSession) -> None:
    collection = await _get_collection()
    payload = session.model_dump(mode="python")
    await collection.replace_one(
        {"_id": session.session_id},
        {"_id": session.session_id, **payload},
        upsert=True,
    )


async def remove_impersonation_session(
    session_id: str,
) -> Optional[ImpersonationSession]:
    collection = await _get_collection()
    doc = await collection.find_one_and_delete({"_id": session_id})
    return _session_from_doc(doc)


async def get_impersonation_session(
    session_id: str,
) -> Optional[ImpersonationSession]:
    collection = await _get_collection()
    doc = await collection.find_one({"_id": session_id})
    session = _session_from_doc(doc)
    if not session:
        return None

    if datetime.now(timezone.utc) > session.expires_at:
        await collection.delete_one({"_id": session_id})
        return None

    return session


async def list_impersonation_sessions_for_admin(
    admin_clerk_id: str,
) -> List[ImpersonationSession]:
    collection = await _get_collection()
    now = datetime.now(timezone.utc)

    await collection.delete_many({"expires_at": {"$lte": now}})

    docs = await collection.find(
        {"admin_clerk_id": admin_clerk_id, "expires_at": {"$gt": now}}
    ).to_list(length=100)
    return [session for session in (_session_from_doc(doc) for doc in docs) if session]
