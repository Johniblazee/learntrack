from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional


def _matches(document: Dict[str, Any], query: Optional[Dict[str, Any]]) -> bool:
    if not query:
        return True

    for key, expected in query.items():
        actual = document.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
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


class FakeCursor:
    def __init__(self, documents: Iterable[Dict[str, Any]]):
        self._documents = [deepcopy(document) for document in documents]

    def sort(self, key: str, direction: int):
        reverse = direction < 0
        self._documents.sort(key=lambda item: item.get(key), reverse=reverse)
        return self

    def limit(self, limit: int):
        self._documents = self._documents[:limit]
        return self

    async def to_list(self, length: Optional[int] = None):
        if length is None:
            return deepcopy(self._documents)
        return deepcopy(self._documents[:length])


class FakeCollection:
    def __init__(self, documents: Optional[Iterable[Dict[str, Any]]] = None):
        self.documents = [deepcopy(document) for document in documents or []]

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

    async def update_one(
        self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False
    ):
        for document in self.documents:
            if _matches(document, query):
                document.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)

        if upsert:
            new_document = deepcopy(query)
            new_document.update(deepcopy(update.get("$setOnInsert", {})))
            new_document.update(deepcopy(update.get("$set", {})))
            self.documents.append(new_document)
            return SimpleNamespace(
                matched_count=0, modified_count=0, upserted_id=new_document.get("_id")
            )

        return SimpleNamespace(matched_count=0, modified_count=0)

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

    async def insert_one(self, document: Dict[str, Any]):
        payload = deepcopy(document)
        self.documents.append(payload)
        return SimpleNamespace(
            inserted_id=payload.get("_id", payload.get("id", "inserted-id"))
        )

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
