from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from bson import ObjectId

from app.services.progress_service import ProgressService
from app.models.progress import ProgressCreate
from tests.conftest import FakeCollection


@pytest.mark.asyncio
async def test_get_progress_reports_uses_dynamic_subject_scores():
    math_id = ObjectId()
    history_id = ObjectId()
    assignment_math_id = ObjectId()
    assignment_history_id = ObjectId()
    now = datetime.now(timezone.utc)

    database = SimpleNamespace(
        progress=FakeCollection(
            [
                {
                    "student_id": "student-1",
                    "assignment_id": str(assignment_math_id),
                    "tutor_id": "tutor-1",
                    "status": "graded",
                    "score": 92,
                    "created_at": now - timedelta(days=6),
                },
                {
                    "student_id": "student-1",
                    "assignment_id": str(assignment_history_id),
                    "tutor_id": "tutor-1",
                    "status": "submitted",
                    "score": 84,
                    "created_at": now - timedelta(days=2),
                },
            ]
        ),
        student_performance=FakeCollection(),
        students=FakeCollection(
            [
                {
                    "clerk_id": "student-1",
                    "name": "Alice Johnson",
                    "tutor_id": "tutor-1",
                    "is_active": True,
                }
            ]
        ),
        assignments=FakeCollection(
            [
                {
                    "_id": assignment_math_id,
                    "subject_id": math_id,
                    "student_ids": ["student-1"],
                    "tutor_id": "tutor-1",
                },
                {
                    "_id": assignment_history_id,
                    "subject_id": history_id,
                    "student_ids": ["student-1"],
                    "tutor_id": "tutor-1",
                },
            ]
        ),
        subjects=FakeCollection(
            [
                {"_id": math_id, "name": "Mathematics"},
                {"_id": history_id, "name": "History"},
            ]
        ),
    )

    service = ProgressService(database)
    report = await service.get_progress_reports("tutor-1")

    assert len(report.student_performance) == 1
    student_row = report.student_performance[0]
    assert student_row.name == "Alice Johnson"
    assert student_row.completed_assignments == 2
    assert student_row.subject_scores == {"History": 84, "Mathematics": 92}
    assert student_row.overall == 88
    assert len(report.weekly_progress) == 4


@pytest.mark.asyncio
async def test_create_progress_reuses_existing_row_without_tutor_id():
    assignment_id = str(ObjectId())
    existing_progress_id = ObjectId()
    database = SimpleNamespace(
        progress=FakeCollection(
            [
                {
                    "_id": existing_progress_id,
                    "student_id": "student-1",
                    "assignment_id": assignment_id,
                    "status": "in_progress",
                    "answers": [],
                    "started_at": datetime.now(timezone.utc),
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "points_earned": 0.0,
                    "points_possible": 0.0,
                }
            ]
        ),
        student_performance=FakeCollection(),
    )

    service = ProgressService(database)
    progress = await service.create_progress(
        ProgressCreate(
            assignment_id=assignment_id,
            student_id="student-1",
            tutor_id="tutor-1",
        )
    )

    assert str(progress.id) == str(existing_progress_id)
    assert progress.tutor_id == "tutor-1"
    assert len(database.progress.documents) == 1


@pytest.mark.asyncio
async def test_get_student_assignment_progress_finds_legacy_row_without_tutor_id():
    assignment_id = str(ObjectId())
    existing_progress_id = ObjectId()
    database = SimpleNamespace(
        progress=FakeCollection(
            [
                {
                    "_id": existing_progress_id,
                    "student_id": "student-1",
                    "assignment_id": assignment_id,
                    "status": "submitted",
                    "answers": [],
                    "started_at": datetime.now(timezone.utc),
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "submitted_at": datetime.now(timezone.utc),
                    "points_earned": 0.0,
                    "points_possible": 0.0,
                }
            ]
        ),
        student_performance=FakeCollection(),
    )

    service = ProgressService(database)
    progress = await service.get_student_assignment_progress(
        "student-1",
        assignment_id,
        tutor_id="tutor-1",
    )

    assert progress is not None
    assert str(progress.id) == str(existing_progress_id)
    assert progress.tutor_id == "tutor-1"
