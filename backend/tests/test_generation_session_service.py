from datetime import datetime, timezone

import pytest

from app.models.generation_session import QuestionStatus
from app.core.exceptions import ValidationError
from app.services.generation_session_service import GenerationSessionService
from tests.conftest import FakeCollection


def _build_session_doc() -> dict:
    now = datetime.now(timezone.utc)
    return {
        "_id": "session-1",
        "session_id": "session-1",
        "user_id": "user-1",
        "tenant_id": "tenant-1",
        "original_prompt": "Generate a biology quiz",
        "config": {"subject": "Biology", "topic": "Cells"},
        "material_ids": ["mat-1"],
        "questions": [
            {
                "question_id": "q1",
                "type": "multiple-choice",
                "difficulty": "medium",
                "blooms_level": "UNDERSTAND",
                "question_text": "What is the powerhouse of the cell?",
                "options": ["A) Nucleus", "B) Mitochondria"],
                "correct_answer": "B",
                "explanation": "Mitochondria generate ATP.",
                "source_citations": [{"material_id": "mat-1", "excerpt": "ATP"}],
                "source_ids": ["mat-1"],
                "tags": ["cells"],
                "quality_score": 0.91,
                "status": "approved",
                "review_comments": "Looks good",
                "reviewed_by": "user-1",
                "reviewed_at": now,
                "published_question_id": "bank-1",
                "published_at": now,
                "edit_history": [],
            }
        ],
        "chat_messages": [],
        "status": "completed",
        "current_question_index": 1,
        "total_questions": 1,
        "thinking_steps": [],
        "created_at": now,
        "updated_at": now,
        "completed_at": now,
    }


@pytest.mark.asyncio
async def test_update_question_content_resets_review_state_and_preserves_published_link():
    collection = FakeCollection([_build_session_doc()])
    service = GenerationSessionService(
        {GenerationSessionService.COLLECTION: collection}  # type: ignore[arg-type]
    )

    success = await service.update_question_content(
        session_id="session-1",
        user_id="user-1",
        question_id="q1",
        update_data={"question_text": "Updated question text"},
    )

    assert success is True
    updated_question = collection.documents[0]["questions"][0]
    assert updated_question["question_text"] == "Updated question text"
    assert updated_question["status"] == QuestionStatus.PENDING.value
    assert updated_question.get("review_comments") is None
    assert updated_question.get("published_question_id") == "bank-1"
    assert updated_question.get("published_at") is not None
    assert len(updated_question["edit_history"]) == 1
    assert (
        updated_question["edit_history"][0]["previous"]["question_text"]
        == "What is the powerhouse of the cell?"
    )


@pytest.mark.asyncio
async def test_mark_questions_published_records_bank_question_id():
    session_doc = _build_session_doc()
    session_doc["questions"][0]["published_question_id"] = None
    session_doc["questions"][0]["published_at"] = None

    collection = FakeCollection([session_doc])
    service = GenerationSessionService(
        {GenerationSessionService.COLLECTION: collection}  # type: ignore[arg-type]
    )

    success = await service.mark_questions_published(
        session_id="session-1",
        user_id="user-1",
        published_map={"q1": "bank-22"},
    )

    assert success is True
    updated_question = collection.documents[0]["questions"][0]
    assert updated_question["published_question_id"] == "bank-22"
    assert updated_question["published_at"] is not None


@pytest.mark.asyncio
async def test_update_question_status_rejects_invalid_transition():
    collection = FakeCollection([_build_session_doc()])
    service = GenerationSessionService(
        {GenerationSessionService.COLLECTION: collection}  # type: ignore[arg-type]
    )

    with pytest.raises(ValidationError, match="Only pending questions can be rejected"):
        await service.update_question_status(
            session_id="session-1",
            user_id="user-1",
            question_id="q1",
            status=QuestionStatus.REJECTED,
            review_comments="Needs work",
        )
