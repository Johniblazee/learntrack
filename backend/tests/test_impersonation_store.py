from datetime import datetime, timezone

from app.core.impersonation_store import _session_from_doc


def test_session_from_doc_normalizes_naive_datetimes_to_utc():
    session = _session_from_doc(
        {
            "_id": "session-1",
            "session_id": "session-1",
            "admin_clerk_id": "admin-1",
            "admin_email": "admin@example.com",
            "target_user_id": "target-user",
            "target_clerk_id": "student-1",
            "target_email": "student@example.com",
            "target_name": "Student One",
            "target_role": "student",
            "target_tutor_id": "tutor-1",
            "started_at": datetime(2026, 3, 11, 8, 0, 0),
            "expires_at": datetime(2026, 3, 11, 9, 0, 0),
        }
    )

    assert session is not None
    assert session.started_at.tzinfo == timezone.utc
    assert session.expires_at.tzinfo == timezone.utc
