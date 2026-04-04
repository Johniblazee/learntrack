"""
Invitation service for managing user invitations
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog
import os

from app.models.invitation import (
    Invitation,
    InvitationCreate,
    InvitationInDB,
    InvitationStatus,
    InvitationRole,
    InvitationVerifyResponse,
    InvitationListResponse,
    InvitationStats,
)
from app.models.user import UserRole, User
from app.models.user import AccountStatus
from app.core.exceptions import NotFoundError, ValidationError, DatabaseException
from app.services.user_service import UserService
from app.services.email_service import email_service
from bson import ObjectId

logger = structlog.get_logger()

# Get frontend URL from environment
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


def to_object_id(id_str: str) -> ObjectId:
    """Convert string to ObjectId"""
    try:
        return ObjectId(id_str)
    except Exception:
        raise ValidationError(f"Invalid ID format: {id_str}")


class InvitationService:
    """Service for managing invitations"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.db = database
        self.collection = database.invitations
        self.user_service = UserService(database)

    def _generate_token(self) -> str:
        """Generate a secure random token for invitation"""
        return secrets.token_urlsafe(32)

    async def _normalize_parent_student_ids(
        self, student_ids: Optional[List[str]], tutor_id: str
    ) -> List[str]:
        if not student_ids:
            return []

        normalized_ids = list(
            dict.fromkeys(
                str(student_id).strip()
                for student_id in student_ids
                if str(student_id).strip()
            )
        )
        if not normalized_ids:
            return []

        object_ids = [
            ObjectId(student_id)
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

        students = await self.db.students.find(
            {
                "tutor_id": tutor_id,
                "is_active": {"$ne": False},
                "$or": query_filters,
            },
            {"_id": 1, "clerk_id": 1, "role": 1},
        ).to_list(length=None)

        canonical_ids: Dict[str, str] = {}
        for student in students:
            student_clerk_id = str(student.get("clerk_id") or "").strip()
            if not student_clerk_id:
                continue
            canonical_ids[str(student.get("_id"))] = student_clerk_id
            canonical_ids[student_clerk_id] = student_clerk_id

        invalid_ids = [
            student_id
            for student_id in normalized_ids
            if student_id not in canonical_ids
        ]
        if invalid_ids:
            raise ValidationError(
                f"Invalid student selection: {', '.join(invalid_ids)}"
            )

        return list(
            dict.fromkeys(canonical_ids[student_id] for student_id in normalized_ids)
        )

    async def _resolve_invited_students(
        self, student_ids: List[str]
    ) -> List[Dict[str, str]]:
        normalized_ids = [
            str(student_id).strip()
            for student_id in student_ids
            if str(student_id).strip()
        ]
        if not normalized_ids:
            return []

        students = await self.db.students.find(
            {"clerk_id": {"$in": normalized_ids}, "is_active": {"$ne": False}},
            {"clerk_id": 1, "name": 1, "email": 1},
        ).to_list(length=None)

        student_map = {
            str(student.get("clerk_id")): {
                "id": str(student.get("clerk_id")),
                "name": str(student.get("name") or "Student"),
                "email": str(student.get("email") or ""),
            }
            for student in students
            if student.get("clerk_id")
        }

        return [
            student_map[student_id]
            for student_id in normalized_ids
            if student_id in student_map
        ]

    async def create_invitation(
        self, invitation_data: InvitationCreate, tutor_id: str
    ) -> Invitation:
        """Create a new invitation"""
        try:
            # Check if user with this email already exists
            existing_user = await self.user_service.get_user_by_email(
                invitation_data.invitee_email
            )
            if existing_user:
                allow_provisioned_student_invite = (
                    invitation_data.role == InvitationRole.STUDENT
                    and existing_user.role == UserRole.STUDENT
                    and existing_user.tutor_id == tutor_id
                    and not existing_user.clerk_id
                )
                if not allow_provisioned_student_invite:
                    raise ValidationError(
                        f"User with email {invitation_data.invitee_email} already exists"
                    )

            # Check for existing pending invitation
            existing_invitation = await self.collection.find_one(
                {
                    "invitee_email": invitation_data.invitee_email,
                    "tutor_id": tutor_id,
                    "status": InvitationStatus.PENDING.value,
                }
            )

            if existing_invitation:
                raise ValidationError(
                    f"Pending invitation already exists for {invitation_data.invitee_email}"
                )

            invitation_dict = invitation_data.model_dump()
            if invitation_data.role == InvitationRole.PARENT:
                invitation_dict[
                    "student_ids"
                ] = await self._normalize_parent_student_ids(
                    invitation_data.student_ids,
                    tutor_id,
                )
            else:
                invitation_dict["student_ids"] = []

            # Create invitation
            token = self._generate_token()
            now = datetime.now(timezone.utc)
            expires_at = now + timedelta(days=14)  # 2 weeks expiration

            invitation_dict.update(
                {
                    "tutor_id": tutor_id,
                    "token": token,
                    "status": InvitationStatus.PENDING.value,
                    "created_at": now,
                    "expires_at": expires_at,
                    "accepted_at": None,
                    "revoked_at": None,
                    "rejected_at": None,
                }
            )

            result = await self.collection.insert_one(invitation_dict)
            invitation_dict["_id"] = result.inserted_id

            if invitation_data.role == InvitationRole.STUDENT:
                await self.user_service._mark_unclaimed_student_status(
                    email=invitation_data.invitee_email,
                    tutor_id=tutor_id,
                    status=AccountStatus.INVITED,
                    invited_at=now,
                )

            logger.info(
                "Invitation created",
                invitation_id=str(result.inserted_id),
                tutor_id=tutor_id,
                invitee_email=invitation_data.invitee_email,
                role=invitation_data.role,
            )

            # Send invitation email
            try:
                # Get tutor info for email
                tutor = await self.user_service.get_user_by_clerk_id(tutor_id)
                tutor_name = tutor.name if tutor else "Your Teacher"

                invitation_link = f"{FRONTEND_URL}/accept-invitation/{token}"

                email_service.send_invitation_email(
                    to_email=invitation_data.invitee_email,
                    to_name=invitation_data.invitee_name or "there",
                    from_name=tutor_name,
                    role=invitation_data.role.value,
                    invitation_link=invitation_link,
                )
            except Exception as e:
                logger.warning(
                    "Failed to send invitation email",
                    error=str(e),
                    invitee_email=invitation_data.invitee_email,
                )

            return self._to_invitation_model(invitation_dict)

        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to create invitation", error=str(e))
            raise DatabaseException(f"Failed to create invitation: {str(e)}")

    async def get_invitation_by_token(self, token: str) -> Optional[Invitation]:
        """Get invitation by token"""
        try:
            invitation = await self.collection.find_one({"token": token})
            return self._to_invitation_model(invitation) if invitation else None
        except Exception as e:
            logger.error("Failed to get invitation by token", error=str(e))
            return None

    async def verify_invitation(self, token: str) -> InvitationVerifyResponse:
        """Verify if an invitation token is valid"""
        try:
            invitation = await self.get_invitation_by_token(token)

            if not invitation:
                return InvitationVerifyResponse(
                    valid=False, error="Invitation not found"
                )

            # Check if already accepted
            if invitation.status == InvitationStatus.ACCEPTED:
                return InvitationVerifyResponse(
                    valid=False, error="Invitation has already been accepted"
                )

            # Check if revoked
            if invitation.status == InvitationStatus.REVOKED:
                return InvitationVerifyResponse(
                    valid=False, error="Invitation has been revoked"
                )

            # Check if expired
            if invitation.expires_at < datetime.now(timezone.utc):
                # Update status to expired
                await self.collection.update_one(
                    {"token": token},
                    {"$set": {"status": InvitationStatus.EXPIRED.value}},
                )
                return InvitationVerifyResponse(
                    valid=False, error="Invitation has expired"
                )

            # Get tutor info
            tutor = await self.user_service.get_user_by_clerk_id(invitation.tutor_id)
            invited_students = []
            if invitation.role == InvitationRole.PARENT and invitation.student_ids:
                invited_students = await self._resolve_invited_students(
                    invitation.student_ids
                )

            return InvitationVerifyResponse(
                valid=True,
                invitation=invitation,
                invited_students=invited_students,
                tutor_name=tutor.name if tutor else "Unknown",
                tutor_email=tutor.email if tutor else None,
            )

        except Exception as e:
            logger.error("Failed to verify invitation", error=str(e))
            return InvitationVerifyResponse(
                valid=False, error="Failed to verify invitation"
            )

    async def accept_invitation(
        self,
        token: str,
        clerk_id: str,
        email: str,
        name: str,
        selected_student_ids: Optional[List[str]] = None,
    ) -> User:
        """Accept an invitation and create user account"""
        try:
            # Verify invitation
            verification = await self.verify_invitation(token)
            if not verification.valid:
                raise ValidationError(verification.error or "Invalid invitation")

            invitation = verification.invitation
            if not invitation:
                raise ValidationError("Invitation not found")

            # Check if email matches
            if email.lower() != invitation.invitee_email.lower():
                raise ValidationError("Email does not match invitation")

            # Determine role
            user_role = (
                UserRole.STUDENT
                if invitation.role == InvitationRole.STUDENT
                else UserRole.PARENT
            )

            allowed_student_ids = [
                str(student_id) for student_id in invitation.student_ids
            ]
            requested_student_ids = [
                str(student_id)
                for student_id in (selected_student_ids or [])
                if student_id
            ]

            if user_role == UserRole.PARENT:
                if requested_student_ids:
                    invalid_student_ids = sorted(
                        set(requested_student_ids) - set(allowed_student_ids)
                    )
                    if invalid_student_ids:
                        raise ValidationError(
                            "Parent invitations can only link invited students"
                        )
                    student_ids_to_link = requested_student_ids
                else:
                    student_ids_to_link = allowed_student_ids
            else:
                student_ids_to_link = []

            user = await self.user_service.upsert_invited_user(
                clerk_id=clerk_id,
                email=email,
                name=name,
                role=user_role,
                tutor_id=invitation.tutor_id,
                tenant_id=invitation.tutor_id,
            )

            # For parent invitations, link to students
            if user_role == UserRole.PARENT:
                for student_id in student_ids_to_link:
                    await self.user_service.assign_child_to_parent(
                        student_id, user.clerk_id
                    )

            # Mark invitation as accepted
            await self.collection.update_one(
                {"token": token},
                {
                    "$set": {
                        "status": InvitationStatus.ACCEPTED.value,
                        "accepted_at": datetime.now(timezone.utc),
                    }
                },
            )

            logger.info(
                "Invitation accepted",
                invitation_id=str(invitation.id),
                user_id=user.clerk_id,
                role=user_role,
            )

            return user

        except (ValidationError, NotFoundError):
            raise
        except Exception as e:
            logger.error("Failed to accept invitation", error=str(e))
            raise DatabaseException(f"Failed to accept invitation: {str(e)}")

    async def _mark_expired_invitations(self, tutor_id: str) -> int:
        """Automatically mark expired pending invitations for a tutor"""
        try:
            now = datetime.now(timezone.utc)

            # Find all pending invitations that have expired
            expired_query = {
                "tutor_id": tutor_id,
                "status": InvitationStatus.PENDING.value,
                "expires_at": {"$lt": now},
            }
            expired_invitations = await self.collection.find(expired_query).to_list(
                length=None
            )

            # Update them to expired status
            result = await self.collection.update_many(
                expired_query, {"$set": {"status": InvitationStatus.EXPIRED.value}}
            )

            if result.modified_count > 0:
                logger.info(
                    "Auto-marked invitations as expired",
                    tutor_id=tutor_id,
                    count=result.modified_count,
                )

                for invitation in expired_invitations:
                    if invitation.get("role") == InvitationRole.STUDENT.value:
                        await self.user_service.sync_student_account_status_from_invitations(
                            email=str(invitation.get("invitee_email") or ""),
                            tutor_id=tutor_id,
                        )

            return result.modified_count
        except Exception as e:
            logger.error(
                "Failed to mark expired invitations", error=str(e), tutor_id=tutor_id
            )
            return 0

    async def get_invitations_for_tutor(
        self, tutor_id: str, status: Optional[InvitationStatus] = None
    ) -> InvitationListResponse:
        """Get all invitations sent by a tutor with automatic expiration"""
        try:
            # First, automatically mark any expired pending invitations
            await self._mark_expired_invitations(tutor_id)

            query = {"tutor_id": tutor_id}
            if status:
                query["status"] = status.value

            invitations_cursor = self.collection.find(query).sort("created_at", -1)
            invitations_data = await invitations_cursor.to_list(length=None)

            invitations = [self._to_invitation_model(inv) for inv in invitations_data]

            # Calculate stats
            total = len(invitations)
            pending = sum(
                1 for inv in invitations if inv.status == InvitationStatus.PENDING
            )
            accepted = sum(
                1 for inv in invitations if inv.status == InvitationStatus.ACCEPTED
            )
            expired = sum(
                1 for inv in invitations if inv.status == InvitationStatus.EXPIRED
            )
            revoked = sum(
                1 for inv in invitations if inv.status == InvitationStatus.REVOKED
            )
            rejected = sum(
                1 for inv in invitations if inv.status == InvitationStatus.REJECTED
            )

            return InvitationListResponse(
                invitations=invitations,
                total=total,
                pending=pending,
                accepted=accepted,
                expired=expired,
                revoked=revoked,
                rejected=rejected,
            )

        except Exception as e:
            logger.error("Failed to get invitations for tutor", error=str(e))
            raise DatabaseException(f"Failed to get invitations: {str(e)}")

    async def revoke_invitation(self, invitation_id: str, tutor_id: str) -> bool:
        """Revoke an invitation"""
        try:
            oid = to_object_id(invitation_id)

            # Verify ownership
            invitation = await self.collection.find_one({"_id": oid})
            if not invitation:
                raise NotFoundError("Invitation", invitation_id)

            if invitation["tutor_id"] != tutor_id:
                raise ValidationError("Not authorized to revoke this invitation")

            if invitation["status"] != InvitationStatus.PENDING.value:
                raise ValidationError("Can only revoke pending invitations")

            result = await self.collection.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": InvitationStatus.REVOKED.value,
                        "revoked_at": datetime.now(timezone.utc),
                    }
                },
            )

            logger.info(
                "Invitation revoked", invitation_id=invitation_id, tutor_id=tutor_id
            )
            if invitation.get("role") == InvitationRole.STUDENT.value:
                await self.user_service.sync_student_account_status_from_invitations(
                    email=str(invitation.get("invitee_email") or ""),
                    tutor_id=tutor_id,
                )
            return result.modified_count > 0

        except (NotFoundError, ValidationError):
            raise
        except Exception as e:
            logger.error("Failed to revoke invitation", error=str(e))
            raise DatabaseException(f"Failed to revoke invitation: {str(e)}")

    async def resend_invitation(self, invitation_id: str, tutor_id: str) -> Invitation:
        """Resend a pending invitation and extend its expiration window."""
        try:
            oid = to_object_id(invitation_id)
            invitation = await self.collection.find_one({"_id": oid})
            if not invitation:
                raise NotFoundError("Invitation", invitation_id)

            if invitation.get("tutor_id") != tutor_id:
                raise ValidationError("Not authorized to resend this invitation")

            if invitation.get("status") != InvitationStatus.PENDING.value:
                raise ValidationError("Only pending invitations can be resent")

            now = datetime.now(timezone.utc)
            expires_at = invitation.get("expires_at")
            if expires_at and expires_at < now:
                await self.collection.update_one(
                    {"_id": oid}, {"$set": {"status": InvitationStatus.EXPIRED.value}}
                )
                raise ValidationError(
                    "Invitation has expired. Create a new invitation instead."
                )

            refreshed_token = self._generate_token()
            refreshed_expiry = now + timedelta(days=14)

            await self.collection.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "token": refreshed_token,
                        "expires_at": refreshed_expiry,
                        "updated_at": now,
                    }
                },
            )

            updated = await self.collection.find_one({"_id": oid})
            if not updated:
                raise NotFoundError("Invitation", invitation_id)

            if updated.get("role") == InvitationRole.STUDENT.value:
                await self.user_service._mark_unclaimed_student_status(
                    email=str(updated.get("invitee_email") or ""),
                    tutor_id=tutor_id,
                    status=AccountStatus.INVITED,
                    invited_at=now,
                )

            try:
                tutor = await self.user_service.get_user_by_clerk_id(tutor_id)
                tutor_name = tutor.name if tutor else "Your Teacher"

                invitation_link = f"{FRONTEND_URL}/accept-invitation/{refreshed_token}"
                role_value = updated.get("role")

                email_service.send_invitation_email(
                    to_email=updated.get("invitee_email"),
                    to_name=updated.get("invitee_name") or "there",
                    from_name=tutor_name,
                    role=role_value,
                    invitation_link=invitation_link,
                )
            except Exception as email_error:
                logger.warning(
                    "Failed to send resent invitation email",
                    error=str(email_error),
                    invitation_id=invitation_id,
                )

            logger.info(
                "Invitation resent",
                invitation_id=invitation_id,
                tutor_id=tutor_id,
                invitee_email=updated.get("invitee_email"),
            )

            return self._to_invitation_model(updated)

        except (NotFoundError, ValidationError):
            raise
        except Exception as e:
            logger.error("Failed to resend invitation", error=str(e))
            raise DatabaseException(f"Failed to resend invitation: {str(e)}")

    async def bulk_revoke_invitations(
        self, invitation_ids: List[str], tutor_id: str
    ) -> Dict[str, Any]:
        """Revoke multiple invitations with partial-success reporting."""
        normalized_ids = list(
            dict.fromkeys(
                str(invitation_id).strip()
                for invitation_id in invitation_ids
                if str(invitation_id).strip()
            )
        )
        if not normalized_ids:
            raise ValidationError("Select at least one invitation")

        revoked_ids: List[str] = []
        skipped_ids: List[str] = []

        for invitation_id in normalized_ids:
            try:
                revoked = await self.revoke_invitation(invitation_id, tutor_id)
                if revoked:
                    revoked_ids.append(invitation_id)
                else:
                    skipped_ids.append(invitation_id)
            except (ValidationError, NotFoundError):
                skipped_ids.append(invitation_id)

        return {
            "requested_count": len(normalized_ids),
            "updated_count": len(revoked_ids),
            "updated_invitation_ids": revoked_ids,
            "skipped_count": len(skipped_ids),
            "skipped_invitation_ids": skipped_ids,
        }

    async def bulk_resend_invitations(
        self, invitation_ids: List[str], tutor_id: str
    ) -> Dict[str, Any]:
        """Resend multiple invitations with partial-success reporting."""
        normalized_ids = list(
            dict.fromkeys(
                str(invitation_id).strip()
                for invitation_id in invitation_ids
                if str(invitation_id).strip()
            )
        )
        if not normalized_ids:
            raise ValidationError("Select at least one invitation")

        resent_ids: List[str] = []
        skipped_ids: List[str] = []

        for invitation_id in normalized_ids:
            try:
                await self.resend_invitation(invitation_id, tutor_id)
                resent_ids.append(invitation_id)
            except (ValidationError, NotFoundError):
                skipped_ids.append(invitation_id)

        return {
            "requested_count": len(normalized_ids),
            "updated_count": len(resent_ids),
            "updated_invitation_ids": resent_ids,
            "skipped_count": len(skipped_ids),
            "skipped_invitation_ids": skipped_ids,
        }

    def _to_invitation_model(self, invitation_dict: dict) -> Invitation:
        """Convert database document to Invitation model"""
        invitation_dict["id"] = str(invitation_dict.pop("_id"))
        return Invitation(**invitation_dict)
