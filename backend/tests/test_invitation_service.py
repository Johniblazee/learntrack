from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.core.exceptions import ValidationError
from app.models.invitation import (
    Invitation,
    InvitationCreate,
    InvitationRole,
    InvitationStatus,
    InvitationVerifyResponse,
)
from app.models.user import AccountStatus
from app.services.invitation_service import InvitationService
from tests.conftest import FakeCollection


def _make_database():
    return SimpleNamespace(
        invitations=FakeCollection(),
        tutors=FakeCollection(
            [{"clerk_id": "tutor-1", "name": "Tutor One", "email": "tutor@example.com"}]
        ),
        students=FakeCollection(),
        parents=FakeCollection(),
        users=FakeCollection(),
    )


@pytest.mark.asyncio
async def test_create_parent_invitation_normalizes_student_ids_to_clerk_ids():
    database = _make_database()
    database.students = FakeCollection(
        [
            {
                "_id": ObjectId("507f1f77bcf86cd799439011"),
                "clerk_id": "student-clerk-1",
                "email": "student@example.com",
                "name": "Student One",
                "role": "student",
                "tutor_id": "tutor-1",
                "is_active": True,
            }
        ]
    )
    service = InvitationService(database)

    invitation = await service.create_invitation(
        InvitationCreate(
            invitee_email="parent@example.com",
            role=InvitationRole.PARENT,
            student_ids=["507f1f77bcf86cd799439011"],
        ),
        "tutor-1",
    )

    assert invitation.student_ids == ["student-clerk-1"]


@pytest.mark.asyncio
async def test_create_student_invitation_reuses_provisioned_student_and_marks_invited():
    database = _make_database()
    database.students = FakeCollection(
        [
            {
                "_id": ObjectId("507f1f77bcf86cd799439099"),
                "email": "student@example.com",
                "name": "Student One",
                "role": "student",
                "tutor_id": "tutor-1",
                "tenant_id": "tutor-1",
                "is_active": True,
                "account_status": AccountStatus.PROVISIONED.value,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        ]
    )
    service = InvitationService(database)

    invitation = await service.create_invitation(
        InvitationCreate(
            invitee_email="student@example.com",
            role=InvitationRole.STUDENT,
        ),
        "tutor-1",
    )

    assert invitation.invitee_email == "student@example.com"
    stored_student = await database.students.find_one({"email": "student@example.com"})
    assert stored_student["account_status"] == AccountStatus.INVITED.value


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


@pytest.mark.asyncio
async def test_bulk_revoke_invitations_reports_partial_success():
    service = InvitationService(_make_database())
    service.collection = FakeCollection(
        [
            {
                "_id": ObjectId("507f1f77bcf86cd799439011"),
                "tutor_id": "tutor-1",
                "invitee_email": "pending@example.com",
                "role": InvitationRole.STUDENT.value,
                "status": InvitationStatus.PENDING.value,
                "token": "token-1",
                "student_ids": [],
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            },
            {
                "_id": ObjectId("507f1f77bcf86cd799439012"),
                "tutor_id": "tutor-1",
                "invitee_email": "accepted@example.com",
                "role": InvitationRole.STUDENT.value,
                "status": InvitationStatus.ACCEPTED.value,
                "token": "token-2",
                "student_ids": [],
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            },
        ]
    )

    result = await service.bulk_revoke_invitations(
        ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012", "missing"],
        "tutor-1",
    )

    assert result["updated_count"] == 1
    assert result["skipped_count"] == 2


@pytest.mark.asyncio
async def test_bulk_resend_invitations_reports_partial_success():
    service = InvitationService(_make_database())
    service.collection = FakeCollection(
        [
            {
                "_id": ObjectId("507f1f77bcf86cd799439021"),
                "tutor_id": "tutor-1",
                "invitee_email": "pending@example.com",
                "role": InvitationRole.STUDENT.value,
                "status": InvitationStatus.PENDING.value,
                "token": "token-1",
                "student_ids": [],
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            },
            {
                "_id": ObjectId("507f1f77bcf86cd799439022"),
                "tutor_id": "tutor-1",
                "invitee_email": "revoked@example.com",
                "role": InvitationRole.STUDENT.value,
                "status": InvitationStatus.REVOKED.value,
                "token": "token-2",
                "student_ids": [],
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            },
        ]
    )

    result = await service.bulk_resend_invitations(
        ["507f1f77bcf86cd799439021", "507f1f77bcf86cd799439022"],
        "tutor-1",
    )

    assert result["updated_count"] == 1
    assert result["skipped_count"] == 1
