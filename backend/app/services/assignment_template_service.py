"""
Assignment template service for managing reusable assignment templates
"""

from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog

from app.models.assignment_template import (
    AssignmentTemplate,
    AssignmentTemplateCreate,
    AssignmentTemplateUpdate,
    AssignmentTemplateInDB,
    AssignmentTemplateListResponse,
    AssignmentTemplateStats,
    TemplateStatus,
)
from app.core.exceptions import NotFoundError, ValidationError
from app.core.utils import to_object_id
from app.models.question import QuestionStatus

logger = structlog.get_logger()


class AssignmentTemplateService:
    """Service for managing assignment templates"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.assignment_templates

    @staticmethod
    def _normalize_ids(values: List[str]) -> List[str]:
        return list(
            dict.fromkeys(str(value).strip() for value in values if str(value).strip())
        )

    async def _validate_question_ids(
        self,
        question_ids: List[str],
        tutor_id: str,
    ) -> List[str]:
        normalized_question_ids = self._normalize_ids(question_ids)
        if not normalized_question_ids:
            return []

        question_docs = await self.db.questions.find(
            {
                "_id": {
                    "$in": [
                        to_object_id(question_id)
                        for question_id in normalized_question_ids
                    ]
                },
                "tutor_id": tutor_id,
                "status": QuestionStatus.ACTIVE.value,
            },
            {"_id": 1},
        ).to_list(length=None)
        found_ids = {str(question_doc.get("_id")) for question_doc in question_docs}

        if len(found_ids) != len(normalized_question_ids):
            raise ValidationError(
                "One or more selected questions are unavailable or do not belong to you"
            )

        return normalized_question_ids

    async def _resolve_owned_template_ids(
        self,
        template_ids: List[str],
        tutor_id: str,
    ) -> tuple[List[str], List[str]]:
        normalized_ids = self._normalize_ids(template_ids)
        template_docs = await self.collection.find(
            {
                "_id": {
                    "$in": [to_object_id(template_id) for template_id in normalized_ids]
                },
                "tutor_id": tutor_id,
            },
            {"_id": 1},
        ).to_list(length=None)
        found_ids = {str(template_doc.get("_id")) for template_doc in template_docs}
        owned_ids = [
            template_id for template_id in normalized_ids if template_id in found_ids
        ]
        skipped_ids = [
            template_id
            for template_id in normalized_ids
            if template_id not in found_ids
        ]
        return owned_ids, skipped_ids

    @staticmethod
    def _bulk_summary(
        requested_ids: List[str], updated_ids: List[str], skipped_ids: List[str]
    ) -> Dict[str, Any]:
        return {
            "requested_count": len(requested_ids),
            "updated_count": len(updated_ids),
            "updated_template_ids": updated_ids,
            "skipped_count": len(skipped_ids),
            "skipped_template_ids": skipped_ids,
        }

    async def create_template(
        self, template_data: AssignmentTemplateCreate, tutor_id: str
    ) -> AssignmentTemplate:
        """Create a new assignment template"""
        try:
            # Create template document
            template_dict = template_data.model_dump()
            template_dict["question_ids"] = await self._validate_question_ids(
                template_dict.get("question_ids") or [],
                tutor_id,
            )
            template_dict.update(
                {
                    "tutor_id": tutor_id,
                    "tenant_id": tutor_id,
                    "status": template_dict.get("status", TemplateStatus.ACTIVE),
                    "usage_count": 0,
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "last_used_at": None,
                }
            )

            result = await self.collection.insert_one(template_dict)
            template_dict["_id"] = result.inserted_id

            return self._to_response_model(template_dict)

        except Exception as e:
            logger.error("Failed to create template", error=str(e))
            raise

    async def get_template(
        self, template_id: str, tutor_id: str
    ) -> Optional[AssignmentTemplate]:
        """Get a template by ID"""
        try:
            template = await self.collection.find_one(
                {"_id": to_object_id(template_id), "tutor_id": tutor_id}
            )

            if not template:
                return None

            return self._to_response_model(template)

        except Exception as e:
            logger.error("Failed to get template", error=str(e))
            raise

    async def list_templates(
        self,
        tutor_id: str,
        status_filter: Optional[TemplateStatus] = None,
        subject_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> AssignmentTemplateListResponse:
        """List templates for a tutor"""
        try:
            # Build query
            query: Dict[str, Any] = {"tutor_id": tutor_id}

            if status_filter:
                query["status"] = status_filter.value

            if subject_id:
                query["subject_id"] = subject_id

            # Get templates
            cursor = (
                self.collection.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(limit)
            )
            templates = await cursor.to_list(length=limit)

            # Get counts
            total = await self.collection.count_documents({"tutor_id": tutor_id})
            active = await self.collection.count_documents(
                {"tutor_id": tutor_id, "status": TemplateStatus.ACTIVE.value}
            )
            archived = await self.collection.count_documents(
                {"tutor_id": tutor_id, "status": TemplateStatus.ARCHIVED.value}
            )
            draft = await self.collection.count_documents(
                {"tutor_id": tutor_id, "status": TemplateStatus.DRAFT.value}
            )

            return AssignmentTemplateListResponse(
                templates=[self._to_response_model(t) for t in templates],
                total=total,
                active=active,
                archived=archived,
                draft=draft,
            )

        except Exception as e:
            logger.error("Failed to list templates", error=str(e))
            raise

    async def update_template(
        self, template_id: str, template_data: AssignmentTemplateUpdate, tutor_id: str
    ) -> AssignmentTemplate:
        """Update a template"""
        try:
            # Check if template exists
            existing = await self.collection.find_one(
                {"_id": to_object_id(template_id), "tutor_id": tutor_id}
            )

            if not existing:
                raise NotFoundError("Template not found")

            # Update template
            update_dict = template_data.model_dump(exclude_unset=True)
            if "question_ids" in update_dict:
                update_dict["question_ids"] = await self._validate_question_ids(
                    update_dict.get("question_ids") or [],
                    tutor_id,
                )
            update_dict["updated_at"] = datetime.now(timezone.utc)

            await self.collection.update_one(
                {"_id": to_object_id(template_id), "tutor_id": tutor_id},
                {"$set": update_dict},
            )

            # Get updated template
            updated = await self.collection.find_one(
                {"_id": to_object_id(template_id), "tutor_id": tutor_id}
            )
            return self._to_response_model(updated)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to update template", error=str(e))
            raise

    async def delete_template(self, template_id: str, tutor_id: str) -> None:
        """Delete a template"""
        try:
            result = await self.collection.delete_one(
                {"_id": to_object_id(template_id), "tutor_id": tutor_id}
            )

            if result.deleted_count == 0:
                raise NotFoundError("Template not found")

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to delete template", error=str(e))
            raise

    async def use_template(self, template_id: str, tutor_id: str) -> AssignmentTemplate:
        """Mark a template as used (increment usage count)"""
        try:
            result = await self.collection.find_one_and_update(
                {"_id": to_object_id(template_id), "tutor_id": tutor_id},
                {
                    "$inc": {"usage_count": 1},
                    "$set": {
                        "last_used_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    },
                },
                return_document=True,
            )

            if not result:
                raise NotFoundError("Template not found")

            return self._to_response_model(result)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to use template", error=str(e))
            raise

    async def get_stats(self, tutor_id: str) -> AssignmentTemplateStats:
        """Get statistics about templates"""
        try:
            total = await self.collection.count_documents({"tutor_id": tutor_id})
            active = await self.collection.count_documents(
                {"tutor_id": tutor_id, "status": TemplateStatus.ACTIVE.value}
            )
            archived = await self.collection.count_documents(
                {"tutor_id": tutor_id, "status": TemplateStatus.ARCHIVED.value}
            )
            draft = await self.collection.count_documents(
                {"tutor_id": tutor_id, "status": TemplateStatus.DRAFT.value}
            )

            # Get total usage
            pipeline = [
                {"$match": {"tutor_id": tutor_id}},
                {"$group": {"_id": None, "total_usage": {"$sum": "$usage_count"}}},
            ]
            usage_result = await self.collection.aggregate(pipeline).to_list(1)
            total_usage = usage_result[0]["total_usage"] if usage_result else 0

            # Get most used template
            most_used = await self.collection.find_one(
                {"tutor_id": tutor_id}, sort=[("usage_count", -1)]
            )

            return AssignmentTemplateStats(
                total_templates=total,
                active=active,
                archived=archived,
                draft=draft,
                total_usage=total_usage,
                most_used_template=self._to_response_model(most_used)
                if most_used
                else None,
            )

        except Exception as e:
            logger.error("Failed to get template stats", error=str(e))
            raise

    async def bulk_update_status(
        self,
        template_ids: List[str],
        tutor_id: str,
        status: TemplateStatus,
    ) -> Dict[str, Any]:
        """Update status for multiple templates owned by a tutor."""
        try:
            normalized_ids = self._normalize_ids(template_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one template")

            owned_ids, skipped_ids = await self._resolve_owned_template_ids(
                normalized_ids,
                tutor_id,
            )
            updated_ids: List[str] = []

            if owned_ids:
                result = await self.collection.update_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(template_id) for template_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                    },
                    {
                        "$set": {
                            "status": status.value,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                if result.modified_count:
                    updated_ids = owned_ids

            return self._bulk_summary(normalized_ids, updated_ids, skipped_ids)
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to bulk update template status", error=str(e))
            raise

    async def bulk_delete_templates(
        self,
        template_ids: List[str],
        tutor_id: str,
    ) -> Dict[str, Any]:
        """Delete multiple templates owned by a tutor."""
        try:
            normalized_ids = self._normalize_ids(template_ids)
            if not normalized_ids:
                raise ValidationError("Select at least one template")

            owned_ids, skipped_ids = await self._resolve_owned_template_ids(
                normalized_ids,
                tutor_id,
            )
            deleted_ids: List[str] = []

            if owned_ids:
                result = await self.collection.delete_many(
                    {
                        "_id": {
                            "$in": [
                                to_object_id(template_id) for template_id in owned_ids
                            ]
                        },
                        "tutor_id": tutor_id,
                    }
                )
                if result.deleted_count:
                    deleted_ids = owned_ids

            return self._bulk_summary(normalized_ids, deleted_ids, skipped_ids)
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to bulk delete templates", error=str(e))
            raise

    def _to_response_model(self, template_dict: Dict[str, Any]) -> AssignmentTemplate:
        """Convert database document to response model"""
        template_dict["id"] = str(template_dict.pop("_id"))
        return AssignmentTemplate(**template_dict)
