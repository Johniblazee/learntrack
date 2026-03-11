from datetime import datetime, timezone

import pytest

from app.models.question import (
    QuestionCreate,
    QuestionOption,
    QuestionStatus,
    QuestionType,
)
from app.services.question_service import QuestionService
from tests.conftest import FakeCollection


@pytest.mark.asyncio
async def test_create_question_allows_published_ai_metadata_overrides():
    service = QuestionService(FakeCollection())

    created = await service.create_question(
        question_data=QuestionCreate(
            question_text="Which organelle produces ATP?",
            question_type=QuestionType.MULTIPLE_CHOICE,
            subject_id="subject-1",
            topic="Cells",
            options=[
                QuestionOption(text="Nucleus", is_correct=False),
                QuestionOption(text="Mitochondria", is_correct=True),
            ],
            correct_answer="Mitochondria",
        ),
        tutor_id="tutor-1",
        ai_generated=True,
        generation_id="session-1",
        extra_fields={
            "status": QuestionStatus.ACTIVE.value,
            "ai_generated": True,
            "approved_by": "tutor-1",
            "approved_at": datetime(2026, 3, 12, tzinfo=timezone.utc),
        },
    )

    assert created.ai_generated is True
    assert created.status == QuestionStatus.ACTIVE
    assert created.generation_id == "session-1"
    assert created.approved_by == "tutor-1"
