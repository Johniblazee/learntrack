from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.models.admin import ImpersonationSession

# In-memory store for active impersonation sessions.
# NOTE: Replace with Redis or database-backed storage for multi-instance deployments.
_active_sessions: Dict[str, ImpersonationSession] = {}


def put_impersonation_session(session: ImpersonationSession) -> None:
    _active_sessions[session.session_id] = session


def remove_impersonation_session(session_id: str) -> Optional[ImpersonationSession]:
    return _active_sessions.pop(session_id, None)


def get_impersonation_session(session_id: str) -> Optional[ImpersonationSession]:
    session = _active_sessions.get(session_id)
    if not session:
        return None

    if datetime.now(timezone.utc) > session.expires_at:
        _active_sessions.pop(session_id, None)
        return None

    return session


def list_impersonation_sessions_for_admin(
    admin_clerk_id: str,
) -> List[ImpersonationSession]:
    now = datetime.now(timezone.utc)
    active_sessions: List[ImpersonationSession] = []
    expired_session_ids: List[str] = []

    for session_id, session in _active_sessions.items():
        if now > session.expires_at:
            expired_session_ids.append(session_id)
            continue

        if session.admin_clerk_id == admin_clerk_id:
            active_sessions.append(session)

    for expired_session_id in expired_session_ids:
        _active_sessions.pop(expired_session_id, None)

    return active_sessions
