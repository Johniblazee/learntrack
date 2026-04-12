"""
User service for database operations
"""

import asyncio
import re
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
from pymongo import ReturnDocument
from bson import ObjectId

from app.models.user import (
    AccountStatus,
    StudentProfileData,
    User,
    UserRole,
    UserCreate,
    UserUpdate,
)
from app.core.exceptions import NotFoundError, DatabaseException, ValidationError
from app.core.utils import to_object_id
from app.utils.slug import generate_unique_slug

logger = structlog.get_logger()


class UserService:
    """User service for database operations with role-specific collections"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        # Role-specific collections
        self.tutors_collection = database.tutors
        self.students_collection = database.students
        self.parents_collection = database.parents

    def _get_collection_for_role(self, role: UserRole):
        """Get the appropriate collection based on user role"""
        if role == UserRole.TUTOR:
            return self.tutors_collection
        elif role == UserRole.STUDENT:
            return self.students_collection
        elif role == UserRole.PARENT:
            return self.parents_collection
        elif role == UserRole.SUPER_ADMIN:
            # Super admins are stored in the tutors collection (they function as top-level users)
            return self.tutors_collection
        else:
            raise ValueError(f"Unknown role: {role}")

    async def _mark_unclaimed_student_status(
        self,
        *,
        email: str,
        tutor_id: str,
        status: AccountStatus,
        invited_at: Optional[datetime] = None,
        claimed_at: Optional[datetime] = None,
    ) -> None:
        update_data: Dict[str, Any] = {
            "account_status": status.value,
            "updated_at": datetime.now(timezone.utc),
        }
        if invited_at is not None:
            update_data["last_invited_at"] = invited_at
        if claimed_at is not None:
            update_data["claimed_at"] = claimed_at

        update_operations: Dict[str, Any] = {"$set": update_data}
        if invited_at is not None:
            update_operations["$inc"] = {"invitation_sent_count": 1}

        await self.students_collection.update_one(
            {
                "email": email,
                "tutor_id": tutor_id,
                "role": UserRole.STUDENT.value,
                "$or": [
                    {"clerk_id": None},
                    {"clerk_id": {"$exists": False}},
                ],
            },
            update_operations,
        )

    async def sync_student_account_status_from_invitations(
        self, *, email: str, tutor_id: str
    ) -> None:
        student = await self.students_collection.find_one(
            {
                "email": email,
                "tutor_id": tutor_id,
                "role": UserRole.STUDENT.value,
                "$or": [
                    {"clerk_id": None},
                    {"clerk_id": {"$exists": False}},
                ],
            },
            {"_id": 1},
        )
        if not student:
            return

        pending_invitation = await self.db.invitations.find_one(
            {
                "invitee_email": email,
                "tutor_id": tutor_id,
                "role": UserRole.STUDENT.value,
                "status": "pending",
            },
            {"created_at": 1},
        )

        if pending_invitation:
            await self._mark_unclaimed_student_status(
                email=email,
                tutor_id=tutor_id,
                status=AccountStatus.INVITED,
                invited_at=pending_invitation.get("created_at")
                or datetime.now(timezone.utc),
            )
            return

        await self.students_collection.update_one(
            {
                "email": email,
                "tutor_id": tutor_id,
                "role": UserRole.STUDENT.value,
                "$or": [
                    {"clerk_id": None},
                    {"clerk_id": {"$exists": False}},
                ],
            },
            {
                "$set": {
                    "account_status": AccountStatus.PROVISIONED.value,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def create_provisioned_student(
        self,
        *,
        name: str,
        email: str,
        tutor_id: str,
        grade: Optional[str] = None,
        phone: Optional[str] = None,
        parent_name: Optional[str] = None,
        parent_email: Optional[str] = None,
        notes: Optional[str] = None,
        interests: Optional[List[str]] = None,
    ) -> User:
        try:
            existing_user = await self.get_user_by_email(email)
            if existing_user:
                if (
                    existing_user.role == UserRole.STUDENT
                    and existing_user.tutor_id == tutor_id
                    and not existing_user.clerk_id
                ):
                    raise ValidationError(
                        f"A provisioned student with email {email} already exists"
                    )

                raise ValidationError(f"User with email {email} already exists")

            now = datetime.now(timezone.utc)
            student_document: Dict[str, Any] = {
                "email": email,
                "name": name,
                "role": UserRole.STUDENT.value,
                "is_active": True,
                "tutor_id": tutor_id,
                "tenant_id": tutor_id,
                "student_tutors": [tutor_id],
                "account_status": AccountStatus.PROVISIONED.value,
                "claimed_at": None,
                "last_invited_at": None,
                "invitation_sent_count": 0,
                "student_profile": StudentProfileData(
                    phone=phone,
                    grade=grade,
                    parentName=parent_name,
                    parentEmail=parent_email,
                    notes=notes,
                    interests=interests or [],
                ).model_dump(exclude_none=True),
                "created_at": now,
                "updated_at": now,
            }
            if hasattr(self.db, "__getitem__"):
                student_document["slug"] = await generate_unique_slug(
                    self.db,
                    getattr(self.students_collection, "name", "students"),
                    name,
                )
            else:
                fallback_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
                student_document["slug"] = fallback_slug or "student"

            result = await self.students_collection.insert_one(student_document)
            student_document["_id"] = result.inserted_id

            logger.info(
                "Provisioned student created",
                student_id=str(result.inserted_id),
                tutor_id=tutor_id,
                email=email,
            )
            return User(**student_document)
        except ValidationError:
            raise
        except Exception as e:
            logger.error("Failed to create provisioned student", error=str(e))
            raise DatabaseException(f"Failed to create provisioned student: {str(e)}")

    async def create_user(self, user_data: UserCreate) -> User:
        """Create a new user with tenant support in role-specific collection"""
        collection = self._get_collection_for_role(user_data.role)
        try:
            if (
                user_data.role in {UserRole.TUTOR, UserRole.SUPER_ADMIN}
                and not user_data.clerk_id
            ):
                raise ValidationError("clerk_id is required for tutor accounts")

            # Check if user already exists by clerk_id
            if user_data.clerk_id:
                existing_user = await collection.find_one(
                    {"clerk_id": user_data.clerk_id}
                )
                if existing_user:
                    return User(**existing_user)

            # Check if user already exists by email (for duplicate key prevention)
            existing_email_user = await collection.find_one({"email": user_data.email})
            if existing_email_user:
                logger.warning(
                    "User with email already exists",
                    email=user_data.email,
                    existing_clerk_id=existing_email_user.get("clerk_id"),
                )
                return User(**existing_email_user)

            # Create new user
            user_dict = user_data.model_dump()
            user_dict["created_at"] = datetime.now(timezone.utc)
            user_dict["updated_at"] = datetime.now(timezone.utc)

            # Generate unique slug from name in the appropriate role collection
            user_dict["slug"] = await generate_unique_slug(
                self.db, collection.name, user_data.name
            )

            # Set tenant_id based on role
            if user_data.role == UserRole.TUTOR:
                # Tutors are their own tenant
                user_dict["tenant_id"] = user_data.clerk_id
                user_dict["tutor_subjects"] = []
            elif user_data.role == UserRole.SUPER_ADMIN:
                # Super admins are their own tenant (similar to tutors but with system-wide access)
                user_dict["tenant_id"] = user_data.clerk_id
                user_dict["is_super_admin"] = True
            elif user_data.role in [UserRole.STUDENT, UserRole.PARENT]:
                # Students and parents need to be assigned to a tutor's tenant
                # For now, set to provided tenant_id or None (will be set during assignment)
                user_dict["tenant_id"] = user_data.tenant_id
                if user_data.role == UserRole.STUDENT:
                    user_dict["student_tutors"] = []
                    user_dict.setdefault(
                        "account_status",
                        AccountStatus.CLAIMED.value
                        if user_data.clerk_id
                        else AccountStatus.PROVISIONED.value,
                    )
                    user_dict.setdefault(
                        "claimed_at",
                        datetime.now(timezone.utc) if user_data.clerk_id else None,
                    )
                    user_dict.setdefault("last_invited_at", None)
                    user_dict.setdefault("invitation_sent_count", 0)
                elif user_data.role == UserRole.PARENT:
                    user_dict["parent_children"] = []
                    user_dict["student_ids"] = []

            result = await collection.insert_one(user_dict)
            user_dict["_id"] = result.inserted_id

            logger.info(
                "User created",
                user_id=str(result.inserted_id),
                role=user_data.role,
                tenant_id=user_dict.get("tenant_id"),
                collection=collection.name,
            )
            return User(**user_dict)

        except Exception as e:
            # Handle duplicate key errors specifically
            if "E11000" in str(e) and "email" in str(e):
                logger.warning(
                    "Duplicate email detected, attempting to find existing user",
                    email=user_data.email,
                )
                existing_user = await collection.find_one({"email": user_data.email})
                if existing_user:
                    return User(**existing_user)

            logger.error("Failed to create user", error=str(e))
            raise DatabaseException(f"Failed to create user: {str(e)}")

    async def get_user_by_id(self, user_id: str) -> User:
        """Get user by ID - searches across all role collections in parallel"""
        try:
            oid = to_object_id(user_id)
            # Query all collections in parallel
            results = await asyncio.gather(
                self.tutors_collection.find_one({"_id": oid}),
                self.students_collection.find_one({"_id": oid}),
                self.parents_collection.find_one({"_id": oid}),
                return_exceptions=True,
            )

            # Return the first non-None result
            for result in results:
                if result is not None and not isinstance(result, Exception):
                    return User(**result)
            raise NotFoundError("User", user_id)
        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to get user by ID", user_id=user_id, error=str(e))
            raise DatabaseException(f"Failed to get user: {str(e)}")

    async def get_user_by_clerk_id(self, clerk_id: str) -> Optional[User]:
        """Get user by Clerk ID - searches across all role collections in parallel"""
        try:
            # Query all collections in parallel for better performance
            results = await asyncio.gather(
                self.tutors_collection.find_one({"clerk_id": clerk_id}),
                self.students_collection.find_one({"clerk_id": clerk_id}),
                self.parents_collection.find_one({"clerk_id": clerk_id}),
                return_exceptions=True,
            )

            # Return the first non-None result
            for result in results:
                if result is not None and not isinstance(result, Exception):
                    return User(**result)
            return None
        except Exception as e:
            logger.error(
                "Failed to get user by Clerk ID", clerk_id=clerk_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get user: {str(e)}")

    async def get_user_by_slug(self, slug: str) -> Optional[User]:
        """Get user by slug - searches across all role collections in parallel"""
        try:
            # Query all collections in parallel
            results = await asyncio.gather(
                self.tutors_collection.find_one({"slug": slug}),
                self.students_collection.find_one({"slug": slug}),
                self.parents_collection.find_one({"slug": slug}),
                return_exceptions=True,
            )

            # Return the first non-None result
            for result in results:
                if result is not None and not isinstance(result, Exception):
                    return User(**result)
            return None
        except Exception as e:
            logger.error("Failed to get user by slug", slug=slug, error=str(e))
            raise DatabaseException(f"Failed to get user: {str(e)}")

    async def update_user_role(
        self,
        clerk_id: str,
        new_role: UserRole,
        *,
        mark_onboarding_complete: bool = False,
    ) -> Optional[User]:
        """Update a user's role, moving records across role collections when needed."""
        try:
            source_collection = None
            source_doc = None

            for collection in [
                self.tutors_collection,
                self.students_collection,
                self.parents_collection,
            ]:
                doc = await collection.find_one({"clerk_id": clerk_id})
                if doc:
                    source_collection = collection
                    source_doc = doc
                    break

            if not source_doc:
                return None

            current_role = UserRole(source_doc.get("role", UserRole.STUDENT.value))
            if current_role == new_role:
                if mark_onboarding_complete and not source_doc.get(
                    "onboarding_completed"
                ):
                    await source_collection.update_one(
                        {"_id": source_doc["_id"]},
                        {
                            "$set": {
                                "onboarding_completed": True,
                                "updated_at": datetime.now(timezone.utc),
                            }
                        },
                    )
                    source_doc["onboarding_completed"] = True
                return User(**source_doc)

            now = datetime.now(timezone.utc)
            target_collection = self._get_collection_for_role(new_role)

            migrated_doc = {k: v for k, v in source_doc.items() if k != "_id"}
            migrated_doc["role"] = new_role.value
            migrated_doc["updated_at"] = now
            if mark_onboarding_complete:
                migrated_doc["onboarding_completed"] = True

            if new_role == UserRole.TUTOR:
                migrated_doc["tutor_id"] = clerk_id
                migrated_doc.setdefault("tenant_id", clerk_id)
            elif new_role in [UserRole.STUDENT, UserRole.PARENT]:
                migrated_doc["tutor_id"] = migrated_doc.get(
                    "tutor_id"
                ) or migrated_doc.get("tenant_id")

            updated_doc = await target_collection.find_one_and_update(
                {"clerk_id": clerk_id},
                {
                    "$set": migrated_doc,
                    "$setOnInsert": {
                        "created_at": source_doc.get("created_at", now),
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )

            if source_collection and source_collection.name != target_collection.name:
                await source_collection.delete_one({"_id": source_doc["_id"]})

            return User(**updated_doc) if updated_doc else None
        except Exception as e:
            logger.error("Failed to update user role", clerk_id=clerk_id, error=str(e))
            raise DatabaseException(f"Failed to update user role: {str(e)}")

    async def create_user_from_clerk(self, user_context) -> User:
        """Create a new user from Clerk user context"""
        try:
            from app.models.user import UserCreate, UserRole

            # Check if user already exists by clerk_id
            existing_user = await self.get_user_by_clerk_id(user_context.clerk_id)
            if existing_user:
                logger.info(
                    "User already exists, returning existing user",
                    clerk_id=user_context.clerk_id,
                )
                return existing_user

            # For non-tutor roles: try to find an existing doc created by the tutor
            # (tutor-created student docs have name+email but no clerk_id field yet)
            if user_context.role == UserRole.STUDENT and user_context.email:
                unlinked = await self.students_collection.find_one(
                    {
                        "email": user_context.email,
                        "$or": [
                            {"clerk_id": {"$exists": False}},
                            {"clerk_id": None},
                        ],
                    },
                )
                if unlinked:
                    now = datetime.now(timezone.utc)
                    await self.students_collection.update_one(
                        {"_id": unlinked["_id"]},
                        {
                            "$set": {
                                "clerk_id": user_context.clerk_id,
                                "account_status": AccountStatus.CLAIMED.value,
                                "claimed_at": now,
                                "updated_at": now,
                            }
                        },
                    )
                    logger.info(
                        "Linked existing student doc to Clerk ID",
                        clerk_id=user_context.clerk_id,
                        student_id=str(unlinked["_id"]),
                    )
                    # Merge clerk_id + role (required by User model, absent from StudentInDB docs)
                    return User(
                        **{
                            **unlinked,
                            "clerk_id": user_context.clerk_id,
                            "role": user_context.role,
                            "account_status": AccountStatus.CLAIMED,
                            "claimed_at": now,
                        }
                    )

            # Determine tutor_id based on role
            if user_context.role in [UserRole.TUTOR, UserRole.SUPER_ADMIN]:
                tutor_id = (
                    user_context.clerk_id
                )  # Tutors and super admins use their own clerk_id
            else:
                tutor_id = (
                    user_context.tutor_id or user_context.clerk_id
                )  # Fall back to own ID; updated when linked to a tutor

            user_data = UserCreate(
                clerk_id=user_context.clerk_id,
                email=user_context.email,
                name=user_context.name,
                role=user_context.role,
                tutor_id=tutor_id,
                is_active=True,
            )

            return await self.create_user(user_data)
        except Exception as e:
            # Handle duplicate key errors gracefully
            if "E11000" in str(e) or "duplicate key" in str(e).lower():
                logger.warning(
                    "Duplicate user detected, attempting to find existing user",
                    clerk_id=user_context.clerk_id,
                    email=user_context.email,
                )
                # Try to find by clerk_id first
                existing_user = await self.get_user_by_clerk_id(user_context.clerk_id)
                if existing_user:
                    return existing_user
                # Try to find by email across all collections
                for collection in [
                    self.tutors_collection,
                    self.students_collection,
                    self.parents_collection,
                ]:
                    existing_user = await collection.find_one(
                        {"email": user_context.email}
                    )
                    if existing_user:
                        return User(**existing_user)

            logger.error(
                "Failed to create user from Clerk",
                clerk_id=user_context.clerk_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to create user from Clerk: {str(e)}")

    async def update_user_from_clerk(self, user_context) -> User:
        """Update existing user from Clerk user context in role-specific collection"""
        try:
            from app.models.user import UserUpdate

            update_data = UserUpdate(
                email=user_context.email,
                name=user_context.name,
                role=user_context.role,
                updated_at=datetime.now(timezone.utc),
            )

            # Get the appropriate collection for this role
            collection = self._get_collection_for_role(user_context.role)

            # Find user by clerk_id and update
            result = await collection.find_one_and_update(
                {"clerk_id": user_context.clerk_id},
                {"$set": update_data.model_dump(exclude_unset=True)},
                return_document=True,
            )

            if result:
                return User(**result)
            else:
                raise DatabaseException("User not found for update")

        except Exception as e:
            logger.error("Failed to update user from Clerk", error=str(e))
            raise DatabaseException(f"Failed to update user: {str(e)}")

    async def get_user_by_email(self, email: str) -> Optional[User]:
        """Get user by email - searches across all role collections"""
        try:
            # Try each collection
            for collection in [
                self.tutors_collection,
                self.students_collection,
                self.parents_collection,
            ]:
                user = await collection.find_one({"email": email})
                if user:
                    return User(**user)
            return None
        except Exception as e:
            logger.error("Failed to get user by email", email=email, error=str(e))
            raise DatabaseException(f"Failed to get user: {str(e)}")

    async def update_user(self, user_id: str, user_update: UserUpdate) -> User:
        """Update user - searches across all role collections"""
        try:
            existing_user = await self.get_user_by_id(user_id)
            update_data = user_update.model_dump(exclude_unset=True)

            # Normalize student profile updates from nested payload and convenience fields
            convenience_profile_fields = {}
            for profile_field in [
                "phone",
                "grade",
                "parentName",
                "parentEmail",
                "notes",
                "interests",
            ]:
                if profile_field in update_data:
                    convenience_profile_fields[profile_field] = update_data.pop(
                        profile_field
                    )

            nested_profile_update = update_data.pop("student_profile", None)

            if existing_user.role == UserRole.STUDENT:
                if nested_profile_update is not None or convenience_profile_fields:
                    current_profile = {}
                    if existing_user.student_profile:
                        current_profile = existing_user.student_profile.model_dump()

                    merged_profile = {**current_profile}
                    if isinstance(nested_profile_update, dict):
                        merged_profile.update(nested_profile_update)
                    merged_profile.update(convenience_profile_fields)

                    update_data["student_profile"] = merged_profile

            if not update_data:
                return existing_user

            update_data["updated_at"] = datetime.now(timezone.utc)

            # If name is being updated, regenerate slug
            if "name" in update_data:
                oid = to_object_id(user_id)
                # Map role to collection name (SUPER_ADMIN uses tutors collection)
                role_to_collection = {
                    UserRole.TUTOR: "tutors",
                    UserRole.SUPER_ADMIN: "tutors",
                    UserRole.STUDENT: "students",
                    UserRole.PARENT: "parents",
                }
                collection_name = role_to_collection.get(existing_user.role, "tutors")
                update_data["slug"] = await generate_unique_slug(
                    self.db, collection_name, update_data["name"], exclude_id=str(oid)
                )

            oid = to_object_id(user_id)

            # Try to update in each collection
            for collection in [
                self.tutors_collection,
                self.students_collection,
                self.parents_collection,
            ]:
                result = await collection.update_one(
                    {"_id": oid}, {"$set": update_data}
                )
                if result.matched_count > 0:
                    logger.info(
                        "User updated", user_id=user_id, collection=collection.name
                    )
                    return await self.get_user_by_id(user_id)

            raise NotFoundError("User", user_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to update user", user_id=user_id, error=str(e))
            raise DatabaseException(f"Failed to update user: {str(e)}")

    async def delete_user(self, user_id: str) -> bool:
        """Delete user (soft delete by setting is_active=False) - searches across all role collections"""
        try:
            oid = to_object_id(user_id)

            # Try to delete in each collection
            for collection in [
                self.tutors_collection,
                self.students_collection,
                self.parents_collection,
            ]:
                result = await collection.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "is_active": False,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
                if result.matched_count > 0:
                    logger.info(
                        "User deleted", user_id=user_id, collection=collection.name
                    )
                    return True

            raise NotFoundError("User", user_id)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to delete user", user_id=user_id, error=str(e))
            raise DatabaseException(f"Failed to delete user: {str(e)}")

    async def bulk_delete_students(
        self, student_identifiers: List[str], tutor_id: str
    ) -> Dict[str, Any]:
        """Soft-delete multiple tutor-owned students with partial-success reporting."""
        try:
            normalized_ids = list(
                dict.fromkeys(
                    str(student_id).strip()
                    for student_id in student_identifiers
                    if str(student_id).strip()
                )
            )
            if not normalized_ids:
                raise ValidationError("Select at least one student")

            object_ids = [
                to_object_id(student_id)
                for student_id in normalized_ids
                if ObjectId.is_valid(student_id)
            ]
            clerk_ids = [
                student_id
                for student_id in normalized_ids
                if not ObjectId.is_valid(student_id)
            ]

            query_filters = []
            if object_ids:
                query_filters.append({"_id": {"$in": object_ids}})
            if clerk_ids:
                query_filters.append({"clerk_id": {"$in": clerk_ids}})

            students = await self.students_collection.find(
                {
                    "tutor_id": tutor_id,
                    "is_active": True,
                    "$or": query_filters,
                },
                {"_id": 1, "clerk_id": 1},
            ).to_list(length=None)

            matched_by_identifier: Dict[str, str] = {}
            deleted_student_object_ids: List[ObjectId] = []
            deleted_student_clerk_ids: List[str] = []

            for student in students:
                student_object_id = student.get("_id")
                if student_object_id is None:
                    continue
                student_object_id_str = str(student_object_id)
                student_clerk_id = str(student.get("clerk_id") or "").strip()
                matched_by_identifier[student_object_id_str] = student_object_id_str
                if student_clerk_id:
                    matched_by_identifier[student_clerk_id] = student_object_id_str
                    deleted_student_clerk_ids.append(student_clerk_id)
                deleted_student_object_ids.append(student_object_id)

            deleted_ids = [
                student_id
                for student_id in normalized_ids
                if student_id in matched_by_identifier
            ]
            skipped_ids = [
                student_id
                for student_id in normalized_ids
                if student_id not in matched_by_identifier
            ]

            if deleted_student_object_ids:
                now = datetime.now(timezone.utc)
                await self.students_collection.update_many(
                    {"_id": {"$in": deleted_student_object_ids}, "tutor_id": tutor_id},
                    {"$set": {"is_active": False, "updated_at": now}},
                )

                cleanup_identifiers = list(
                    dict.fromkeys(
                        [str(student_id) for student_id in deleted_student_object_ids]
                        + deleted_student_clerk_ids
                    )
                )
                for identifier in cleanup_identifiers:
                    await self.db.student_groups.update_many(
                        {"tutor_id": tutor_id, "studentIds": identifier},
                        {"$pull": {"studentIds": identifier}},
                    )
                    await self.parents_collection.update_many(
                        {"tutor_id": tutor_id, "student_ids": identifier},
                        {"$pull": {"student_ids": identifier}},
                    )
                    await self.parents_collection.update_many(
                        {"tutor_id": tutor_id, "parent_children": identifier},
                        {"$pull": {"parent_children": identifier}},
                    )

            return {
                "requested_count": len(normalized_ids),
                "deleted_count": len(deleted_ids),
                "deleted_student_ids": deleted_ids,
                "skipped_count": len(skipped_ids),
                "skipped_student_ids": skipped_ids,
            }
        except ValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to bulk delete students", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to bulk delete students: {str(e)}")

    async def get_users_by_role(self, role: UserRole, limit: int = 100) -> List[User]:
        """Get users by role from role-specific collection"""
        try:
            collection = self._get_collection_for_role(role)
            cursor = collection.find({"is_active": True}).limit(limit)

            users = []
            async for user in cursor:
                users.append(User(**user))

            return users

        except Exception as e:
            logger.error("Failed to get users by role", role=role, error=str(e))
            raise DatabaseException(f"Failed to get users: {str(e)}")

    async def get_students_for_tutor(
        self, tutor_id: str, limit: int = 200
    ) -> List[User]:
        """Get all students assigned to a specific tutor from students collection"""
        try:
            cursor = self.students_collection.find(
                {"tutor_id": tutor_id, "is_active": True}
            ).limit(limit)

            students = []
            async for student in cursor:
                students.append(User(**student))

            logger.info(
                "Retrieved students for tutor", tutor_id=tutor_id, count=len(students)
            )
            return students

        except Exception as e:
            logger.error(
                "Failed to get students for tutor", tutor_id=tutor_id, error=str(e)
            )
            raise DatabaseException(f"Failed to get students: {str(e)}")

    async def get_students_count_for_tutor(self, tutor_id: str) -> int:
        """Get total count of students for a tutor from students collection"""
        try:
            count = await self.students_collection.count_documents(
                {"tutor_id": tutor_id, "is_active": True}
            )
            return count
        except Exception as e:
            logger.error(
                "Failed to get students count for tutor",
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get students count: {str(e)}")

    async def get_students_for_tutor_paginated(
        self, tutor_id: str, skip: int = 0, limit: int = 10
    ) -> List[User]:
        """Get paginated students assigned to a specific tutor from students collection"""
        try:
            cursor = (
                self.students_collection.find({"tutor_id": tutor_id, "is_active": True})
                .skip(skip)
                .limit(limit)
            )

            students = []
            async for student in cursor:
                students.append(User(**student))

            logger.info(
                "Retrieved paginated students for tutor",
                tutor_id=tutor_id,
                count=len(students),
            )
            return students

        except Exception as e:
            logger.error(
                "Failed to get paginated students for tutor",
                tutor_id=tutor_id,
                error=str(e),
            )
            raise DatabaseException(f"Failed to get students: {str(e)}")

    async def assign_student_to_tutor(self, student_id: str, tutor_id: str) -> bool:
        """Assign student to tutor using students collection"""
        try:
            # Update student's tutors list
            student_oid = to_object_id(student_id)
            await self.students_collection.update_one(
                {"_id": student_oid},
                {
                    "$addToSet": {"student_tutors": tutor_id},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
            )

            logger.info(
                "Student assigned to tutor", student_id=student_id, tutor_id=tutor_id
            )
            return True

        except Exception as e:
            logger.error("Failed to assign student to tutor", error=str(e))
            raise DatabaseException(f"Failed to assign student: {str(e)}")

    async def assign_child_to_parent(
        self, child_clerk_id: str, parent_clerk_id: str
    ) -> bool:
        """Assign child to parent using parents collection (IDs are Clerk IDs)"""
        try:
            now = datetime.now(timezone.utc)

            parent_result = await self.parents_collection.update_one(
                {"clerk_id": parent_clerk_id},
                {
                    "$addToSet": {
                        "parent_children": child_clerk_id,
                        "student_ids": child_clerk_id,
                    },
                    "$set": {"updated_at": now},
                },
            )

            student_result = await self.students_collection.update_one(
                {"clerk_id": child_clerk_id},
                {
                    "$addToSet": {"parent_ids": parent_clerk_id},
                    "$set": {"updated_at": now},
                },
            )

            if parent_result.matched_count == 0:
                raise ValidationError("Parent not found for child linkage")

            if student_result.matched_count == 0:
                raise ValidationError("Student not found for parent linkage")

            logger.info(
                "Child assigned to parent",
                child_id=child_clerk_id,
                parent_id=parent_clerk_id,
            )
            return True

        except Exception as e:
            logger.error("Failed to assign child to parent", error=str(e))
            raise DatabaseException(f"Failed to assign child: {str(e)}")

    async def upsert_invited_user(
        self,
        *,
        clerk_id: str,
        email: str,
        name: str,
        role: UserRole,
        tutor_id: str,
        tenant_id: Optional[str] = None,
    ) -> User:
        """Create or relink an invited user from a verified Clerk session."""
        target_collection = self._get_collection_for_role(role)
        resolved_tenant_id = tenant_id or tutor_id
        now = datetime.now(timezone.utc)

        base_updates: Dict[str, Any] = {
            "clerk_id": clerk_id,
            "email": email,
            "name": name,
            "role": role.value,
            "tutor_id": tutor_id,
            "tenant_id": resolved_tenant_id,
            "is_active": True,
            "updated_at": now,
        }

        if role == UserRole.STUDENT:
            base_updates.setdefault("student_tutors", [tutor_id])
            base_updates["account_status"] = AccountStatus.CLAIMED.value
            base_updates["claimed_at"] = now
        elif role == UserRole.PARENT:
            base_updates.setdefault("parent_children", [])
            base_updates.setdefault("student_ids", [])

        existing_by_clerk = await self.get_user_by_clerk_id(clerk_id)
        if existing_by_clerk and existing_by_clerk.role != role:
            migrated_user = await self.update_user_role(clerk_id, role)
            if not migrated_user:
                raise DatabaseException("Failed to migrate invited user to target role")

        target_user = await target_collection.find_one({"clerk_id": clerk_id})
        if target_user:
            updated = await target_collection.find_one_and_update(
                {"_id": target_user["_id"]},
                {"$set": base_updates},
                return_document=ReturnDocument.AFTER,
            )
            if not updated:
                raise DatabaseException("Failed to update invited user")
            return User(**updated)

        existing_by_email = await target_collection.find_one({"email": email})
        if existing_by_email:
            existing_clerk_id = existing_by_email.get("clerk_id")
            if existing_clerk_id and existing_clerk_id != clerk_id:
                raise ValidationError("This email is already linked to another account")

            updated = await target_collection.find_one_and_update(
                {"_id": existing_by_email["_id"]},
                {"$set": base_updates, "$setOnInsert": {"created_at": now}},
                return_document=ReturnDocument.AFTER,
            )
            if not updated:
                raise DatabaseException("Failed to relink invited user")
            return User(**updated)

        return await self.create_user(
            UserCreate(
                clerk_id=clerk_id,
                email=email,
                name=name,
                role=role,
                tutor_id=tutor_id,
                tenant_id=resolved_tenant_id,
                is_active=True,
            )
        )
