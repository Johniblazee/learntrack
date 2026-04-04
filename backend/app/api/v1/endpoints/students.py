"""
Student management endpoints, operating on the role-specific "students" collection.
A "student" is a user with the role "student".
"""

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId
import structlog
from pydantic import BaseModel

from app.core.database import get_database
from app.core.enhanced_auth import require_tutor, ClerkUserContext
from app.models.user import User, UserCreate, UserUpdate, UserRole
from app.services.user_service import UserService
from app.utils.pagination import PaginationParams, PaginatedResponse, paginate

logger = structlog.get_logger()
router = APIRouter()


class BulkStudentDeleteRequest(BaseModel):
    student_ids: List[str]


async def _resolve_student_for_tutor(
    student_identifier: str,
    current_user: ClerkUserContext,
    user_service: UserService,
    db: AsyncIOMotorDatabase,
) -> User:
    """Resolve a student by Clerk ID or ObjectId and enforce tutor ownership."""
    student = await user_service.get_user_by_clerk_id(student_identifier)

    if not student:
        try:
            object_id = ObjectId(student_identifier)
            student_doc = await db.students.find_one({"_id": object_id})
            if student_doc:
                student = User(**student_doc)
        except Exception:
            student = None

    if not student or student.role != UserRole.STUDENT:
        raise HTTPException(status_code=404, detail="Student not found")

    if student.is_active is False:
        raise HTTPException(status_code=404, detail="Student not found")

    if student.tutor_id != current_user.clerk_id:
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: Student does not belong to this tutor.",
        )

    return student


def _expand_student_identifier_values(student_identifiers: List[str]) -> List[Any]:
    """Expand student identifiers to include both string and ObjectId variants."""
    values: List[Any] = []
    seen: set[str] = set()

    for identifier in student_identifiers:
        normalized = str(identifier or "").strip()
        if not normalized:
            continue

        string_key = f"str:{normalized}"
        if string_key not in seen:
            values.append(normalized)
            seen.add(string_key)

        try:
            object_id = ObjectId(normalized)
            object_key = f"oid:{str(object_id)}"
            if object_key not in seen:
                values.append(object_id)
                seen.add(object_key)
        except Exception:
            continue

    return values


def _build_parent_link_criteria(student_identifiers: List[str]) -> List[Dict[str, Any]]:
    """Build robust parent lookup criteria for legacy and current schemas."""
    criteria: List[Dict[str, Any]] = []
    for identifier in _expand_student_identifier_values(student_identifiers):
        criteria.append({"student_ids": identifier})
        criteria.append({"parent_children": identifier})
    return criteria


@router.get("/")
async def list_students_for_tutor(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Items per page"),
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get paginated students assigned to the currently authenticated tutor.
    Includes linked parent information for each student.
    """
    try:
        user_service = UserService(db)

        # Create pagination params
        pagination = PaginationParams(page=page, per_page=per_page)

        # Get total count
        total = await user_service.get_students_count_for_tutor(current_user.clerk_id)

        # Get paginated students
        students = await user_service.get_students_for_tutor_paginated(
            tutor_id=current_user.clerk_id, skip=pagination.skip, limit=pagination.limit
        )

        # Batch-fetch parents for all students with a single $in query (avoids N+1)
        student_identifier_map: Dict[str, set] = {}
        for student in students:
            identifiers = {
                s for s in (str(student.clerk_id or ""), str(student.id or "")) if s
            }
            student_identifier_map[str(student.id)] = identifiers

        # Collect all expanded values across all students for a single query
        all_expanded: List[Any] = []
        seen_keys: set = set()
        for identifiers in student_identifier_map.values():
            for val in _expand_student_identifier_values(list(identifiers)):
                key = str(val)
                if key not in seen_keys:
                    all_expanded.append(val)
                    seen_keys.add(key)

        parents_by_student: Dict[str, List[Dict[str, Any]]] = {
            str(s.id): [] for s in students
        }
        if all_expanded:
            parent_cursor = db.parents.find(
                {
                    "$or": [
                        {"student_ids": {"$in": all_expanded}},
                        {"parent_children": {"$in": all_expanded}},
                    ],
                    "tutor_id": current_user.clerk_id,
                    "is_active": {"$ne": False},
                }
            )
            all_parents = await parent_cursor.to_list(length=None)
            seen_parent_ids: Dict[str, set] = {str(s.id): set() for s in students}
            for parent in all_parents:
                parent_id = str(parent.get("_id", ""))
                parent_refs = {
                    str(sid)
                    for sid in parent.get("student_ids", [])
                    + parent.get("parent_children", [])
                    if sid
                }
                for student in students:
                    student_id_str = str(student.id)
                    if student_identifier_map[student_id_str] & parent_refs:
                        if parent_id not in seen_parent_ids[student_id_str]:
                            seen_parent_ids[student_id_str].add(parent_id)
                            parents_by_student[student_id_str].append(parent)

        enriched_students = []
        for student in students:
            student_dict = student.model_dump()
            parents = parents_by_student[str(student.id)]
            if parents:
                parent_names = [p.get("name", "Unknown") for p in parents]
                student_dict["parent_name"] = ", ".join(parent_names)
                student_dict["parent_ids"] = [p.get("clerk_id") for p in parents]
            else:
                student_dict["parent_name"] = None
                student_dict["parent_ids"] = []
            enriched_students.append(student_dict)

        # Return paginated response
        return paginate(
            items=enriched_students, page=page, per_page=per_page, total=total
        )
    except Exception as e:
        logger.error("Failed to list students for tutor", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve students")


@router.post("/", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_student_for_tutor(
    payload: UserCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Create a new student and assign them to the current tutor.
    """
    try:
        user_service = UserService(db)

        # Ensure the role is 'student' and assign tutor_id
        payload.role = UserRole.STUDENT
        payload.tutor_id = current_user.clerk_id

        student = await user_service.create_user(payload)
        return student
    except Exception as e:
        logger.error("Failed to create student", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create student")


@router.post("/bulk-delete", response_model=dict)
async def bulk_delete_students(
    payload: BulkStudentDeleteRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Soft-delete multiple tutor-owned students."""
    try:
        user_service = UserService(db)
        return await user_service.bulk_delete_students(
            payload.student_ids,
            current_user.clerk_id,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to bulk delete students", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to delete students")


@router.get("/by-slug/{slug}", response_model=User)
async def get_student_by_slug(
    slug: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get a specific student by slug, ensuring they belong to the current tutor.
    """
    try:
        user_service = UserService(db)
        student = await user_service.get_user_by_slug(slug)

        if (
            not student
            or student.role != UserRole.STUDENT
            or student.is_active is False
        ):
            raise HTTPException(status_code=404, detail="Student not found")

        # Security Check: Ensure the student belongs to the requesting tutor
        if student.tutor_id != current_user.clerk_id:
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Student does not belong to this tutor.",
            )

        return student
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get student by slug", slug=slug, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve student")


@router.get("/{student_clerk_id}", response_model=User)
async def get_student(
    student_clerk_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get a specific student, ensuring they belong to the current tutor.
    """
    try:
        user_service = UserService(db)
        student = await _resolve_student_for_tutor(
            student_clerk_id,
            current_user,
            user_service,
            db,
        )
        return student
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get student", student_clerk_id=student_clerk_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve student")


@router.put("/{student_clerk_id}", response_model=User)
async def update_student(
    student_clerk_id: str,
    payload: UserUpdate,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Update a student's profile, ensuring they belong to the current tutor.
    """
    try:
        user_service = UserService(db)
        # First, verify the student exists and belongs to the tutor
        student_to_update = await _resolve_student_for_tutor(
            student_clerk_id,
            current_user,
            user_service,
            db,
        )

        # Prevent role changes via this endpoint
        if (
            hasattr(payload, "role")
            and payload.role
            and payload.role != UserRole.STUDENT
        ):
            raise HTTPException(
                status_code=400, detail="Cannot change user role via this endpoint."
            )

        updated_student = await user_service.update_user(student_to_update.id, payload)
        return updated_student
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to update student", student_clerk_id=student_clerk_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to update student")


@router.delete("/{student_clerk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(
    student_clerk_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Delete a student, ensuring they belong to the current tutor.
    """
    try:
        user_service = UserService(db)

        # First, verify the student exists and belongs to the tutor
        student = await _resolve_student_for_tutor(
            student_clerk_id,
            current_user,
            user_service,
            db,
        )

        # Delete the student
        await user_service.delete_user(student.id)
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to delete student", student_clerk_id=student_clerk_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail="Failed to delete student")


# ============ Parent-Student Relationship Management ============


@router.get("/{student_clerk_id}/parents", response_model=List[User])
async def get_student_parents(
    student_clerk_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get all parents linked to a specific student.
    """
    try:
        user_service = UserService(db)

        # Verify the student exists and belongs to the tutor
        student = await _resolve_student_for_tutor(
            student_clerk_id,
            current_user,
            user_service,
            db,
        )

        # Use a stable identifier from the actual student record (fallback to ObjectId string for legacy docs)
        actual_student_identifier = str(student.clerk_id or student.id)

        logger.info(
            "Fetching parents for student",
            url_student_id=student_clerk_id,
            actual_student_id=actual_student_identifier,
            tutor_id=current_user.clerk_id,
        )

        student_identifiers = list(
            {
                str(student_clerk_id or ""),
                str(actual_student_identifier or ""),
                str(student.id or ""),
            }
        )
        parent_link_criteria = _build_parent_link_criteria(student_identifiers)

        if not parent_link_criteria:
            return []

        # Find parents linked to this student - search for both the URL param and actual clerk_id
        # This handles cases where the student_ids might have been stored with a different ID format
        parent_cursor = db.parents.find(
            {
                "$or": parent_link_criteria,
                "tutor_id": current_user.clerk_id,
                "is_active": {"$ne": False},
            }
        )
        parents = await parent_cursor.to_list(length=50)

        logger.info(
            "Found parents for student",
            count=len(parents),
            student_id=actual_student_identifier,
        )

        # Convert to Pydantic models for proper ObjectId serialization
        return [User(**parent) for parent in parents]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get student parents",
            student_clerk_id=student_clerk_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to retrieve parents")


from pydantic import BaseModel, EmailStr


class LinkParentRequest(BaseModel):
    parent_email: EmailStr
    parent_name: str


@router.post("/{student_clerk_id}/parents", status_code=status.HTTP_201_CREATED)
async def link_parent_to_student(
    student_clerk_id: str,
    payload: LinkParentRequest,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Link a parent to a student. Creates the parent if they don't exist.
    """
    try:
        user_service = UserService(db)

        # Verify the student exists and belongs to the tutor
        student = await _resolve_student_for_tutor(
            student_clerk_id,
            current_user,
            user_service,
            db,
        )

        # Use a stable student identifier from the student record (fallback to ObjectId string for legacy docs)
        actual_student_id = str(student.clerk_id or student.id)

        logger.info(
            "Linking parent to student",
            url_student_id=student_clerk_id,
            actual_student_id=actual_student_id,
            parent_email="<redacted>",
        )

        # Check if parent already exists by email
        existing_parent = await db.parents.find_one(
            {"email": payload.parent_email, "tutor_id": current_user.clerk_id}
        )

        if existing_parent:
            # Check if already linked (check both URL param and actual ID for robustness)
            existing_student_ids = {
                str(student_id)
                for student_id in [
                    *existing_parent.get("student_ids", []),
                    *existing_parent.get("parent_children", []),
                ]
                if student_id
            }

            candidate_student_ids = {
                str(candidate)
                for candidate in [actual_student_id, student_clerk_id, str(student.id)]
                if candidate
            }

            if (
                existing_student_ids
                and candidate_student_ids
                and existing_student_ids.intersection(candidate_student_ids)
            ):
                raise HTTPException(
                    status_code=400, detail="Parent is already linked to this student"
                )

            # Add student to existing parent's relation fields
            await db.parents.update_one(
                {"_id": existing_parent["_id"]},
                {
                    "$addToSet": {
                        "student_ids": actual_student_id,
                        "parent_children": actual_student_id,
                    },
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            return {
                "message": "Parent linked successfully",
                "parent_id": str(existing_parent["_id"]),
            }
        else:
            # Create new parent record
            new_parent = {
                "clerk_id": f"parent_{uuid.uuid4().hex[:12]}",  # Temporary ID until they sign up
                "name": payload.parent_name,
                "email": payload.parent_email,
                "role": "parent",
                "tutor_id": current_user.clerk_id,
                "student_ids": [
                    actual_student_id
                ],  # Use actual clerk_id for consistency
                "parent_children": [actual_student_id],
                "is_active": True,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }

            result = await db.parents.insert_one(new_parent)

            return {
                "message": "Parent created and linked successfully",
                "parent_id": str(result.inserted_id),
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to link parent to student",
            student_clerk_id=student_clerk_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to link parent")


@router.delete(
    "/{student_clerk_id}/parents/{parent_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def unlink_parent_from_student(
    student_clerk_id: str,
    parent_id: str,
    current_user: ClerkUserContext = Depends(require_tutor),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Unlink a parent from a student.
    """
    try:
        user_service = UserService(db)

        # Verify the student exists and belongs to the tutor
        student = await _resolve_student_for_tutor(
            student_clerk_id,
            current_user,
            user_service,
            db,
        )

        # Use a stable student identifier from the student record (fallback to ObjectId string for legacy docs)
        actual_student_id = str(student.clerk_id or student.id)

        # Find the parent by clerk_id or _id (convert to ObjectId if valid)
        parent_id_criteria: List[Dict[str, Any]] = [{"clerk_id": parent_id}]

        # Try to convert parent_id to ObjectId for _id match
        try:
            object_id = ObjectId(parent_id)
            parent_id_criteria.append({"_id": object_id})
        except Exception:
            # parent_id is not a valid ObjectId, skip _id match
            pass

        parent_query: Dict[str, Any] = {"$or": parent_id_criteria}

        parent = await db.parents.find_one(
            {
                **parent_query,
                "tutor_id": current_user.clerk_id,
            }
        )

        if not parent:
            raise HTTPException(status_code=404, detail="Parent not found")

        # Remove student from parent's relation fields (supports string/ObjectId legacy values)
        student_identifier_values = _expand_student_identifier_values(
            [student_clerk_id, actual_student_id, str(student.id)]
        )

        await db.parents.update_one(
            {"_id": parent["_id"]},
            {
                "$pull": {
                    "student_ids": {"$in": student_identifier_values},
                    "parent_children": {"$in": student_identifier_values},
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )

        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to unlink parent from student",
            student_clerk_id=student_clerk_id,
            parent_id=parent_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to unlink parent")
