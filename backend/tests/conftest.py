from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional
from unittest.mock import AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Query matching helpers
# ---------------------------------------------------------------------------


def _resolve_nested(document: Dict[str, Any], key: str) -> Any:
    """Resolve dot-notation keys like 'metadata.role'."""
    parts = key.split(".")
    current = document
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _match_operator(actual: Any, operator: str, expected: Any) -> bool:
    """Evaluate a single MongoDB comparison operator."""
    if operator == "$eq":
        return actual == expected
    if operator == "$ne":
        return actual != expected
    if operator == "$in":
        if isinstance(actual, list):
            return any(item in expected for item in actual)
        return actual in expected
    if operator == "$nin":
        if isinstance(actual, list):
            return all(item not in expected for item in actual)
        return actual not in expected
    if operator == "$gt":
        return actual is not None and actual > expected
    if operator == "$gte":
        return actual is not None and actual >= expected
    if operator == "$lt":
        return actual is not None and actual < expected
    if operator == "$lte":
        return actual is not None and actual <= expected
    if operator == "$exists":
        return (actual is not None) == bool(expected)
    if operator == "$regex":
        flags = 0
        return bool(re.search(expected, str(actual or ""), flags))
    return False


def _matches(document: Dict[str, Any], query: Optional[Dict[str, Any]]) -> bool:
    """Check if *document* satisfies the Mongo-style *query* filter."""
    if not query:
        return True

    for key, expected in query.items():
        # Logical operators
        if key == "$or":
            if not any(_matches(document, sub) for sub in expected):
                return False
            continue
        if key == "$and":
            if not all(_matches(document, sub) for sub in expected):
                return False
            continue

        actual = _resolve_nested(document, key)

        # Operator dict: {"$gt": 5, "$lt": 10}
        if isinstance(expected, dict):
            for op, val in expected.items():
                if not _match_operator(actual, op, val):
                    return False
            continue

        # Exact match
        if isinstance(actual, list):
            if expected not in actual:
                return False
            continue

        if actual != expected:
            return False

    return True


def _project(
    document: Dict[str, Any], projection: Optional[Dict[str, int]]
) -> Dict[str, Any]:
    if not projection:
        return deepcopy(document)

    included_keys = {key for key, value in projection.items() if value}
    if not included_keys:
        return deepcopy(document)

    projected = {
        key: deepcopy(value) for key, value in document.items() if key in included_keys
    }
    if "_id" in document and projection.get("_id", 1):
        projected.setdefault("_id", deepcopy(document["_id"]))
    return projected


def _apply_update(document: Dict[str, Any], update: Dict[str, Any]) -> None:
    """Apply MongoDB update operators in-place."""
    if "$set" in update:
        document.update(deepcopy(update["$set"]))
    if "$unset" in update:
        for key in update["$unset"]:
            document.pop(key, None)
    if "$inc" in update:
        for key, val in update["$inc"].items():
            document[key] = document.get(key, 0) + val
    if "$push" in update:
        for key, val in update["$push"].items():
            lst = document.setdefault(key, [])
            if isinstance(val, dict) and "$each" in val:
                lst.extend(deepcopy(val["$each"]))
            else:
                lst.append(deepcopy(val))
    if "$pull" in update:
        for key, val in update["$pull"].items():
            lst = document.get(key, [])
            document[key] = [item for item in lst if item != val]
    if "$addToSet" in update:
        for key, val in update["$addToSet"].items():
            lst = document.setdefault(key, [])
            if val not in lst:
                lst.append(deepcopy(val))


# ---------------------------------------------------------------------------
# FakeCursor
# ---------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, documents: Iterable[Dict[str, Any]]):
        self._documents = [deepcopy(document) for document in documents]
        self._skip_n = 0

    def sort(self, key_or_list, direction: int = 1):
        if isinstance(key_or_list, list):
            # List of (key, direction) tuples — apply in reverse order
            for sort_key, sort_dir in reversed(key_or_list):
                reverse = sort_dir < 0
                self._documents.sort(
                    key=lambda item: item.get(sort_key) or "", reverse=reverse
                )
        else:
            reverse = direction < 0
            self._documents.sort(
                key=lambda item: item.get(key_or_list) or "", reverse=reverse
            )
        return self

    def skip(self, n: int):
        self._skip_n = n
        return self

    def limit(self, limit: int):
        docs = self._documents[self._skip_n :]
        self._documents = docs[:limit]
        self._skip_n = 0
        return self

    async def to_list(self, length: Optional[int] = None):
        docs = self._documents[self._skip_n :]
        if length is not None:
            docs = docs[:length]
        return deepcopy(docs)

    def __aiter__(self):
        self._iter_index = 0
        return self

    async def __anext__(self):
        if self._iter_index >= len(self._documents):
            raise StopAsyncIteration
        doc = deepcopy(self._documents[self._iter_index])
        self._iter_index += 1
        return doc


# ---------------------------------------------------------------------------
# FakeCollection — enhanced with operator support
# ---------------------------------------------------------------------------


class FakeCollection:
    def __init__(
        self,
        documents: Optional[Iterable[Dict[str, Any]]] = None,
        name: Optional[str] = None,
    ):
        self.documents = [deepcopy(document) for document in documents or []]
        # Motor collections expose `.name`; the user service uses it to decide
        # whether the source and target collections differ during a role
        # migration. Default to a unique sentinel so unnamed fakes still compare
        # as distinct instances.
        self.name = name or f"fake_collection_{id(self)}"

    def find(
        self,
        query: Optional[Dict[str, Any]] = None,
        projection: Optional[Dict[str, int]] = None,
    ):
        return FakeCursor(
            [
                _project(document, projection)
                for document in self.documents
                if _matches(document, query)
            ]
        )

    async def find_one(
        self, query: Dict[str, Any], projection: Optional[Dict[str, int]] = None
    ):
        for document in self.documents:
            if _matches(document, query):
                return _project(document, projection)
        return None

    async def update_one(self, query: Dict[str, Any], update, upsert: bool = False):
        # Support aggregation pipeline updates (list of stages)
        if isinstance(update, list):
            for document in self.documents:
                if _matches(document, query):
                    # Simplified: just apply $set stages
                    for stage in update:
                        if "$set" in stage:
                            document.update(deepcopy(stage["$set"]))
                    return SimpleNamespace(matched_count=1, modified_count=1)
            return SimpleNamespace(matched_count=0, modified_count=0)

        for document in self.documents:
            if _matches(document, query):
                _apply_update(document, update)
                return SimpleNamespace(matched_count=1, modified_count=1)

        if upsert:
            new_document = deepcopy(query)
            new_document.update(deepcopy(update.get("$setOnInsert", {})))
            _apply_update(new_document, update)
            self.documents.append(new_document)
            return SimpleNamespace(
                matched_count=0, modified_count=0, upserted_id=new_document.get("_id")
            )

        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query: Dict[str, Any], update: Dict[str, Any]):
        count = 0
        for document in self.documents:
            if _matches(document, query):
                _apply_update(document, update)
                count += 1
        return SimpleNamespace(matched_count=count, modified_count=count)

    async def replace_one(
        self, query: Dict[str, Any], replacement: Dict[str, Any], upsert: bool = False
    ):
        for index, document in enumerate(self.documents):
            if _matches(document, query):
                self.documents[index] = deepcopy(replacement)
                return SimpleNamespace(matched_count=1, modified_count=1)

        if upsert:
            self.documents.append(deepcopy(replacement))
            return SimpleNamespace(
                matched_count=0, modified_count=0, upserted_id=replacement.get("_id")
            )

        return SimpleNamespace(matched_count=0, modified_count=0)

    async def find_one_and_delete(self, query: Dict[str, Any]):
        for index, document in enumerate(self.documents):
            if _matches(document, query):
                return self.documents.pop(index)
        return None

    async def find_one_and_update(
        self,
        query: Dict[str, Any],
        update: Dict[str, Any],
        return_document: bool = False,
        upsert: bool = False,
        **_: Any,
    ):
        for document in self.documents:
            if _matches(document, query):
                _apply_update(document, update)
                return deepcopy(document)

        if upsert:
            new_document: Dict[str, Any] = {}
            for key, value in query.items():
                if isinstance(key, str) and not key.startswith("$") and not isinstance(
                    value, dict
                ):
                    new_document[key] = deepcopy(value)
            new_document.update(deepcopy(update.get("$setOnInsert", {})))
            _apply_update(new_document, update)
            self.documents.append(new_document)
            return deepcopy(new_document)

        return None

    async def insert_one(self, document: Dict[str, Any]):
        payload = deepcopy(document)
        self.documents.append(payload)
        return SimpleNamespace(
            inserted_id=payload.get("_id", payload.get("id", "inserted-id"))
        )

    async def insert_many(self, documents: List[Dict[str, Any]]):
        ids = []
        for doc in documents:
            payload = deepcopy(doc)
            self.documents.append(payload)
            ids.append(payload.get("_id", payload.get("id", "inserted-id")))
        return SimpleNamespace(inserted_ids=ids)

    async def count_documents(self, query: Optional[Dict[str, Any]] = None) -> int:
        return sum(1 for d in self.documents if _matches(d, query))

    async def delete_one(self, query: Dict[str, Any]):
        for index, document in enumerate(self.documents):
            if _matches(document, query):
                self.documents.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query: Dict[str, Any]):
        remaining = [
            document for document in self.documents if not _matches(document, query)
        ]
        deleted_count = len(self.documents) - len(remaining)
        self.documents = remaining
        return SimpleNamespace(deleted_count=deleted_count)

    async def aggregate(self, pipeline: List[Dict[str, Any]]):
        """Minimal aggregate stub — returns matching documents."""
        docs = deepcopy(self.documents)
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if _matches(d, stage["$match"])]
            elif "$sort" in stage:
                for key, direction in reversed(list(stage["$sort"].items())):
                    docs.sort(
                        key=lambda item: item.get(key) or "",
                        reverse=direction < 0,
                    )
            elif "$limit" in stage:
                docs = docs[: stage["$limit"]]
            elif "$skip" in stage:
                docs = docs[stage["$skip"] :]
        return FakeCursor(docs)

    async def create_index(self, *args, **kwargs):
        pass

    async def drop_index(self, *args, **kwargs):
        pass


# ---------------------------------------------------------------------------
# FakeDatabase — dict-like container that auto-creates FakeCollections
# ---------------------------------------------------------------------------


class FakeDatabase(dict):
    """Dict subclass that auto-creates FakeCollection for any key access.

    Supports both dict-style (db["tutors"]) and attribute-style (db.tutors)
    access, matching Motor's AsyncIOMotorDatabase interface.
    """

    def __missing__(self, key):
        collection = FakeCollection(name=key)
        self[key] = collection
        return collection

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


# ---------------------------------------------------------------------------
# Auth fixtures — reusable user contexts for tests
# ---------------------------------------------------------------------------


def make_tutor_context(
    clerk_id: str = "tutor_clerk_001",
    email: str = "tutor@test.com",
    name: str = "Test Tutor",
    **overrides,
):
    """Factory for creating a tutor ClerkUserContext-like dict."""
    from app.models.user import UserRole, AdminPermission

    defaults = dict(
        user_id=clerk_id,
        clerk_id=clerk_id,
        email=email,
        name=name,
        role=UserRole.TUTOR,
        roles=[UserRole.TUTOR],
        permissions=["read", "write", "create", "delete", "manage_students"],
        session_id="test_session",
        organization_id=None,
        created_at=datetime.now(timezone.utc),
        last_sign_in=datetime.now(timezone.utc),
        tutor_id=clerk_id,
        student_ids=[],
        is_super_admin=False,
        admin_permissions=[],
    )
    defaults.update(overrides)
    return defaults


def make_student_context(
    clerk_id: str = "student_clerk_001",
    tutor_id: str = "tutor_clerk_001",
    email: str = "student@test.com",
    name: str = "Test Student",
    **overrides,
):
    from app.models.user import UserRole

    defaults = dict(
        user_id=clerk_id,
        clerk_id=clerk_id,
        email=email,
        name=name,
        role=UserRole.STUDENT,
        roles=[UserRole.STUDENT],
        permissions=["read", "write_own", "submit"],
        session_id="test_session",
        organization_id=None,
        created_at=datetime.now(timezone.utc),
        last_sign_in=datetime.now(timezone.utc),
        tutor_id=tutor_id,
        student_ids=[],
        is_super_admin=False,
        admin_permissions=[],
    )
    defaults.update(overrides)
    return defaults


def make_super_admin_context(
    clerk_id: str = "admin_clerk_001",
    email: str = "admin@test.com",
    name: str = "Super Admin",
    **overrides,
):
    from app.models.user import UserRole, AdminPermission

    defaults = dict(
        user_id=clerk_id,
        clerk_id=clerk_id,
        email=email,
        name=name,
        role=UserRole.SUPER_ADMIN,
        roles=[UserRole.SUPER_ADMIN],
        permissions=[
            "read",
            "write",
            "create",
            "delete",
            "manage_students",
            "admin",
            "manage_system",
        ],
        session_id="test_session",
        organization_id=None,
        created_at=datetime.now(timezone.utc),
        last_sign_in=datetime.now(timezone.utc),
        tutor_id=clerk_id,
        student_ids=[],
        is_super_admin=True,
        admin_permissions=[AdminPermission.FULL_ACCESS],
    )
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_db():
    """Return a FakeDatabase instance with auto-creating collections."""
    return FakeDatabase()


@pytest.fixture
def tutor_context():
    """Return a tutor user context dict."""
    return make_tutor_context()


@pytest.fixture
def student_context():
    """Return a student user context dict."""
    return make_student_context()


@pytest.fixture
def admin_context():
    """Return a super admin user context dict."""
    return make_super_admin_context()
