"""
Topics endpoints with tenant isolation
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from datetime import datetime, timezone
from bson import ObjectId

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from pydantic import BaseModel, Field

logger = structlog.get_logger()
router = APIRouter()


class TopicBase(BaseModel):
    """Base topic model"""
    name: str
    subject_id: str
    difficulty: str = "intermediate"


class TopicCreate(TopicBase):
    """Topic creation model"""
    pass


class Topic(TopicBase):
    """Topic response model"""
    id: str = Field(alias="_id")
    tutor_id: Optional[str] = None
    subject_name: str
    question_count: int = 0
    assignment_count: int = 0
    completion_rate: float = 0.0
    created_at: datetime
    updated_at: datetime

    class Config:
        populate_by_name = True


@router.get("/", response_model=List[Topic])
async def get_topics(
    subject_id: Optional[str] = Query(None, description="Filter by subject ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Get all topics for the authenticated tutor, optionally filtered by subject"""
    try:
        # Always filter by tutor_id for tenant isolation
        query = {"tutor_id": current_user.clerk_id}
        if subject_id:
            query["subject_id"] = subject_id

        topics = await database.topics.find(query).to_list(length=100)

        # Convert ObjectId to string
        for topic in topics:
            topic["_id"] = str(topic["_id"])

        return topics
    except Exception as e:
        logger.error("Failed to get topics", error=str(e), tutor_id=current_user.clerk_id)
        raise HTTPException(status_code=500, detail=f"Failed to get topics: {str(e)}")


@router.post("/", response_model=Topic, status_code=status.HTTP_201_CREATED)
async def create_topic(
    topic_data: TopicCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Create a new topic (with tenant isolation)"""
    try:
        # Get subject to get subject name - must belong to current tutor
        subject = await database.subjects.find_one({
            "_id": ObjectId(topic_data.subject_id),
            "tutor_id": current_user.clerk_id  # Verify subject ownership
        })
        if not subject:
            raise HTTPException(status_code=404, detail="Subject not found or access denied")

        topic_dict = topic_data.model_dump()
        topic_dict["tutor_id"] = current_user.clerk_id  # Set tutor_id for tenant isolation
        topic_dict["subject_name"] = subject["name"]
        topic_dict["question_count"] = 0
        topic_dict["assignment_count"] = 0
        topic_dict["completion_rate"] = 0.0
        now = datetime.now(timezone.utc)
        topic_dict["created_at"] = now
        topic_dict["updated_at"] = now

        result = await database.topics.insert_one(topic_dict)
        topic_dict["_id"] = str(result.inserted_id)

        logger.info("Topic created", topic_id=str(result.inserted_id), tutor_id=current_user.clerk_id)
        return topic_dict
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create topic", error=str(e), tutor_id=current_user.clerk_id)
        raise HTTPException(status_code=500, detail=f"Failed to create topic: {str(e)}")


@router.get("/{topic_id}", response_model=Topic)
async def get_topic(
    topic_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Get a specific topic (only if owned by authenticated tutor)"""
    try:
        # Filter by tutor_id for tenant isolation
        topic = await database.topics.find_one({
            "_id": ObjectId(topic_id),
            "tutor_id": current_user.clerk_id
        })
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found or access denied")

        topic["_id"] = str(topic["_id"])
        return topic
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get topic", error=str(e), tutor_id=current_user.clerk_id)
        raise HTTPException(status_code=500, detail=f"Failed to get topic: {str(e)}")


@router.put("/{topic_id}", response_model=Topic)
async def update_topic(
    topic_id: str,
    topic_data: TopicCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Update a topic (only if owned by authenticated tutor)"""
    try:
        update_dict = topic_data.model_dump()
        update_dict["updated_at"] = datetime.now(timezone.utc)

        # Filter by tutor_id for tenant isolation
        result = await database.topics.update_one(
            {"_id": ObjectId(topic_id), "tutor_id": current_user.clerk_id},
            {"$set": update_dict}
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Topic not found or access denied")

        topic = await database.topics.find_one({
            "_id": ObjectId(topic_id),
            "tutor_id": current_user.clerk_id
        })
        topic["_id"] = str(topic["_id"])

        logger.info("Topic updated", topic_id=topic_id, tutor_id=current_user.clerk_id)
        return topic
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update topic", error=str(e), tutor_id=current_user.clerk_id)
        raise HTTPException(status_code=500, detail=f"Failed to update topic: {str(e)}")


@router.delete("/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(
    topic_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database)
):
    """Delete a topic (only if owned by authenticated tutor)"""
    try:
        # Filter by tutor_id for tenant isolation
        result = await database.topics.delete_one({
            "_id": ObjectId(topic_id),
            "tutor_id": current_user.clerk_id
        })

        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Topic not found or access denied")

        logger.info("Topic deleted", topic_id=topic_id, tutor_id=current_user.clerk_id)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete topic", error=str(e), tutor_id=current_user.clerk_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete topic: {str(e)}")

