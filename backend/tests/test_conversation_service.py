from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import AuthorizationError
from app.models.conversation import ConversationCreate
from app.models.user import UserRole
from app.services.conversation_service import ConversationService
from tests.conftest import FakeCollection


@pytest.mark.asyncio
async def test_create_conversation_blocks_cross_tenant_participants():
    database = SimpleNamespace(conversations=FakeCollection())
    service = ConversationService(database)
    service.validate_conversation_participants = AsyncMock(return_value=True)

    async def fake_get_user_profile(clerk_id: str):
        if clerk_id == "student-1":
            return {
                "clerk_id": "student-1",
                "name": "Student One",
                "role": "student",
                "tutor_id": "tenant-2",
            }
        return {
            "clerk_id": "tutor-1",
            "name": "Tutor One",
            "role": "tutor",
            "tutor_id": "tenant-1",
        }

    service._get_user_profile_by_clerk_id = fake_get_user_profile

    with pytest.raises(AuthorizationError, match="outside your tenant visibility"):
        await service.create_conversation(
            conversation_data=ConversationCreate(participant_ids=["student-1"]),
            current_user_id="tutor-1",
            tutor_id="tenant-1",
            current_user_role=UserRole.TUTOR,
        )
