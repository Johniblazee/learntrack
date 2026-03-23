from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.v1.admin import tenants as tenant_admin
from app.core.enhanced_auth import ClerkUserContext
from tests.conftest import FakeCollection, make_super_admin_context


def _build_database():
    now = datetime.now(timezone.utc)

    return SimpleNamespace(
        tutors=FakeCollection(
            [
                {
                    "_id": "tenant-1",
                    "clerk_id": "tutor-1",
                    "email": "tutor1@example.com",
                    "name": "Tutor One",
                    "status": "active",
                    "subscription_tier": "pro",
                    "storage_used_mb": 128.5,
                    "storage_limit_mb": 512.0,
                    "created_at": now - timedelta(days=120),
                    "updated_at": now - timedelta(hours=2),
                    "last_login": now - timedelta(days=1),
                },
                {
                    "_id": "tenant-2",
                    "clerk_id": "tutor-2",
                    "email": "tutor2@example.com",
                    "name": "Tutor Two",
                    "status": "active",
                    "created_at": now - timedelta(days=60),
                    "updated_at": now - timedelta(days=2),
                },
            ]
        ),
        students=FakeCollection(
            [
                {
                    "_id": "student-doc-1",
                    "clerk_id": "student-1",
                    "name": "Ada Student",
                    "email": "ada@student.test",
                    "tutor_id": "tutor-1",
                    "grade": "10th",
                    "is_active": True,
                    "parent_ids": ["parent-1", "parent-2"],
                    "totalAssignments": 12,
                    "completedAssignments": 10,
                    "completionRate": 83.3,
                    "averageScore": 91.2,
                    "last_login": now - timedelta(hours=5),
                    "created_at": now - timedelta(days=90),
                    "updated_at": now - timedelta(hours=4),
                },
                {
                    "_id": "student-doc-2",
                    "clerk_id": "student-2",
                    "name": "Ben Student",
                    "email": "ben@student.test",
                    "tutor_id": "tutor-1",
                    "grade": "9th",
                    "is_active": False,
                    "parent_ids": ["parent-2"],
                    "totalAssignments": 6,
                    "completedAssignments": 2,
                    "completionRate": 33.3,
                    "averageScore": 72.0,
                    "created_at": now - timedelta(days=50),
                    "updated_at": now - timedelta(days=2),
                },
                {
                    "_id": "student-doc-3",
                    "clerk_id": "student-3",
                    "name": "Chris Other",
                    "email": "chris@student.test",
                    "tutor_id": "tutor-2",
                    "grade": "11th",
                    "is_active": True,
                },
            ]
        ),
        parents=FakeCollection(
            [
                {
                    "_id": "parent-doc-1",
                    "clerk_id": "parent-1",
                    "name": "Pat Parent",
                    "email": "pat@parent.test",
                    "tutor_id": "tutor-1",
                    "is_active": True,
                    "student_ids": ["student-1"],
                    "last_login": now - timedelta(days=3),
                    "created_at": now - timedelta(days=80),
                    "updated_at": now - timedelta(days=3),
                },
                {
                    "_id": "parent-doc-2",
                    "clerk_id": "parent-2",
                    "name": "Morgan Parent",
                    "email": "morgan@parent.test",
                    "tutor_id": "tutor-1",
                    "status": "active",
                    "student_ids": ["student-1", "student-2"],
                    "created_at": now - timedelta(days=70),
                    "updated_at": now - timedelta(days=1),
                },
                {
                    "_id": "parent-doc-3",
                    "clerk_id": "parent-3",
                    "name": "Outside Parent",
                    "email": "outside@parent.test",
                    "tutor_id": "tutor-2",
                    "student_ids": ["student-3"],
                },
            ]
        ),
        subjects=FakeCollection(
            [
                {"_id": "subject-1", "tutor_id": "tutor-1"},
                {"_id": "subject-2", "tutor_id": "tutor-1"},
            ]
        ),
        questions=FakeCollection(
            [
                {"_id": "question-1", "tutor_id": "tutor-1"},
                {"_id": "question-2", "tutor_id": "tutor-1"},
                {"_id": "question-3", "tutor_id": "tutor-1"},
            ]
        ),
        assignments=FakeCollection(
            [
                {"_id": "assignment-1", "tutor_id": "tutor-1"},
                {"_id": "assignment-2", "tutor_id": "tutor-1"},
            ]
        ),
        materials=FakeCollection(
            [
                {"_id": "material-1", "tutor_id": "tutor-1"},
                {"_id": "material-2", "tutor_id": "tutor-1"},
                {"_id": "material-3", "tutor_id": "tutor-1"},
            ]
        ),
        invitations=FakeCollection(
            [
                {"_id": "invite-1", "tutor_id": "tutor-1", "status": "pending"},
                {"_id": "invite-2", "tutor_id": "tutor-1", "status": "pending"},
                {"_id": "invite-3", "tutor_id": "tutor-1", "status": "accepted"},
            ]
        ),
        cost_tracking=FakeCollection(
            [
                {
                    "_id": "usage-1",
                    "tenant_id": "tutor-1",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "input_tokens": 100,
                    "output_tokens": 60,
                    "total_cost": 0.42,
                    "timestamp": now - timedelta(days=2),
                },
                {
                    "_id": "usage-2",
                    "tenant_id": "tutor-1",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "input_tokens": 220,
                    "output_tokens": 140,
                    "total_cost": 0.84,
                    "timestamp": now - timedelta(hours=8),
                },
                {
                    "_id": "usage-old",
                    "tenant_id": "tutor-1",
                    "provider": "groq",
                    "model": "llama-3.1-8b-instant",
                    "input_tokens": 500,
                    "output_tokens": 300,
                    "total_cost": 1.0,
                    "timestamp": now - timedelta(days=45),
                },
            ]
        ),
        cost_quotas=FakeCollection(
            [
                {
                    "_id": "quota-1",
                    "tenant_id": "tutor-1",
                    "tier": "pro",
                    "is_active": True,
                    "daily_limit": 5.0,
                    "current_daily_usage": 3.0,
                    "monthly_limit": 100.0,
                    "current_monthly_usage": 81.0,
                    "alert_threshold": 0.8,
                }
            ]
        ),
    )


@pytest.mark.asyncio
async def test_get_tenant_details_returns_tutor_workspace_summary(monkeypatch):
    database = _build_database()
    current_user = ClerkUserContext(**make_super_admin_context())
    audit_spy = AsyncMock()
    monkeypatch.setattr(tenant_admin, "_log_admin_action", audit_spy)

    result = await tenant_admin.get_tenant_details(
        tenant_id="tutor-1",
        current_user=current_user,
        database=database,
    )

    assert result.clerk_id == "tutor-1"
    assert result.students_count == 2
    assert result.parents_count == 2
    assert result.active_students_count == 1
    assert result.active_parents_count == 2
    assert result.materials_count == 3
    assert result.pending_invitations_count == 2
    assert result.usage_summary is not None
    assert result.usage_summary.total_requests == 2
    assert result.usage_summary.total_tokens == 520
    assert result.usage_summary.total_cost_usd == pytest.approx(1.26)
    assert result.usage_summary.top_provider == "openai"
    assert result.usage_summary.top_model == "gpt-4o-mini"
    assert result.quota_summary is not None
    assert result.quota_summary.tier == "pro"
    assert result.quota_summary.near_limit is True
    assert result.quota_summary.over_limit is False
    audit_spy.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_tenant_students_filters_to_tutor(monkeypatch):
    database = _build_database()
    current_user = ClerkUserContext(**make_super_admin_context())
    monkeypatch.setattr(tenant_admin, "_log_admin_action", AsyncMock())

    result = await tenant_admin.list_tenant_students(
        tenant_id="tutor-1",
        page=1,
        per_page=10,
        search=None,
        current_user=current_user,
        database=database,
    )

    assert result.total == 2
    assert [student.name for student in result.students] == [
        "Ada Student",
        "Ben Student",
    ]
    assert result.students[0].parents_count == 2
    assert result.students[0].grade == "10th"
    assert result.students[0].is_active is True
    assert all(student.clerk_id != "student-3" for student in result.students)


@pytest.mark.asyncio
async def test_list_tenant_parents_includes_child_names(monkeypatch):
    database = _build_database()
    current_user = ClerkUserContext(**make_super_admin_context())
    monkeypatch.setattr(tenant_admin, "_log_admin_action", AsyncMock())

    result = await tenant_admin.list_tenant_parents(
        tenant_id="tutor-1",
        page=1,
        per_page=10,
        search=None,
        current_user=current_user,
        database=database,
    )

    assert result.total == 2
    assert [parent.name for parent in result.parents] == ["Morgan Parent", "Pat Parent"]
    parent = result.parents[0]
    assert parent.name == "Morgan Parent"
    assert parent.children_count == 2
    assert parent.child_names == ["Ada Student", "Ben Student"]
    assert parent.is_active is True
