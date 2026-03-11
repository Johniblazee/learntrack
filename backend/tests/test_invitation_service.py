from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ValidationError
from app.models.invitation import (
    Invitation,
    InvitationRole,
    InvitationStatus,
    InvitationVerifyResponse,
)
from app.services.invitation_service import InvitationService
from tests.conftest import FakeCollection


def _make_database():
    return SimpleNamespace(
        invitations=FakeCollection(),
        tutors=FakeCollection(),
        students=FakeCollection(),
        parents=FakeCollection(),
        users=FakeCollection(),
    )


@pytest.mark.asyncio
async def test_parent_invitation_rejects_uninvited_student_linking():
    service = InvitationService(_make_database())
    service.collection = FakeCollection()
    service.user_service.upsert_invited_user = AsyncMock(
        return_value=SimpleNamespace(clerk_id="parent-1")
    )
    service.user_service.assign_child_to_parent = AsyncMock()
    service.verify_invitation = AsyncMock(
        return_value=InvitationVerifyResponse(
            valid=True,
            invitation=Invitation(
                id="invite-1",
                tutor_id="tutor-1",
                invitee_email="parent@example.com",
                invitee_name="Parent One",
                role=InvitationRole.PARENT,
                status=InvitationStatus.PENDING,
                token="token-1",
                student_ids=["student-1"],
                created_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            ),
        )
    )

    with pytest.raises(ValidationError, match="only link invited students"):
        await service.accept_invitation(
            token="token-1",
            clerk_id="clerk-parent-1",
            email="parent@example.com",
            name="Parent One",
            selected_student_ids=["student-2"],
        )

    service.user_service.upsert_invited_user.assert_not_called()
    service.user_service.assign_child_to_parent.assert_not_called()


@pytest.mark.asyncio
async def test_parent_invitation_links_only_allowed_students_when_selected():
    service = InvitationService(_make_database())
    service.collection = FakeCollection()
    service.collection.update_one = AsyncMock()
    service.user_service.upsert_invited_user = AsyncMock(
        return_value=SimpleNamespace(clerk_id="parent-1")
    )
    service.user_service.assign_child_to_parent = AsyncMock()
    service.verify_invitation = AsyncMock(
        return_value=InvitationVerifyResponse(
            valid=True,
            invitation=Invitation(
                id="invite-1",
                tutor_id="tutor-1",
                invitee_email="parent@example.com",
                invitee_name="Parent One",
                role=InvitationRole.PARENT,
                status=InvitationStatus.PENDING,
                token="token-1",
                student_ids=["student-1", "student-2"],
                created_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            ),
        )
    )

    accepted_user = await service.accept_invitation(
        token="token-1",
        clerk_id="clerk-parent-1",
        email="parent@example.com",
        name="Parent One",
        selected_student_ids=["student-2"],
    )

    assert accepted_user.clerk_id == "parent-1"
    service.user_service.upsert_invited_user.assert_awaited_once()
    service.user_service.assign_child_to_parent.assert_awaited_once_with(
        "student-2", "parent-1"
    )
