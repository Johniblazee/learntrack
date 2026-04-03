from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.core.exceptions import ValidationError
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


@pytest.mark.asyncio
async def test_delete_question_raises_validation_error_when_used_in_assignments():
    question_id = ObjectId()
    assignments = SimpleNamespace(count_documents=AsyncMock(return_value=1))
    service = QuestionService(
        SimpleNamespace(
            questions=FakeCollection(
                [
                    {
                        "_id": question_id,
                        "question_text": "What is ATP?",
                        "question_type": QuestionType.MULTIPLE_CHOICE.value,
                        "subject_id": "subject-1",
                        "topic": "Cells",
                        "difficulty": "medium",
                        "points": 1,
                        "tutor_id": "tutor-1",
                        "options": [
                            {"text": "Energy", "is_correct": True},
                            {"text": "Protein", "is_correct": False},
                        ],
                        "correct_answer": "Energy",
                        "tags": [],
                        "status": QuestionStatus.ACTIVE.value,
                        "created_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                ]
            ),
            assignments=assignments,
        )
    )

    with pytest.raises(
        ValidationError, match="Cannot delete question that is used in assignments"
    ):
        await service.delete_question(str(question_id), "tutor-1")
