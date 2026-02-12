"""
Invitation endpoints for user invitation system
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Path, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.core.database import get_database
from app.core.enhanced_auth import ClerkUserContext, require_tutor, get_current_user
from app.models.invitation import (
    Invitation,
    InvitationCreate,
    InvitationStatus,
    InvitationVerifyResponse,
    InvitationAcceptRequest,
    InvitationListResponse,
)
from app.services.invitation_service import InvitationService
from app.core.exceptions import NotFoundError, ValidationError

logger = structlog.get_logger()
router = APIRouter()


@router.post("/", response_model=Invitation, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    invitation_data: InvitationCreate,
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Create a new invitation (Tutor only)

    Send an invitation to a student or parent to join the tutor's account.
    """
    try:
        invitation_service = InvitationService(database)
        invitation = await invitation_service.create_invitation(
            invitation_data, current_user.clerk_id
        )
        return invitation
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to create invitation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create invitation",
        )


@router.get("/", response_model=InvitationListResponse)
async def get_invitations(
    status_filter: Optional[str] = Query(
        None, description="Filter by status (pending, accepted, expired, revoked)"
    ),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Get all invitations sent by the tutor

    Returns a list of all invitations with statistics.
    """
    try:
        invitation_service = InvitationService(database)

        # Parse status filter
        status_enum = None
        if status_filter:
            try:
                status_enum = InvitationStatus(status_filter.lower())
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status: {status_filter}",
                )

        invitations = await invitation_service.get_invitations_for_tutor(
            current_user.clerk_id, status_enum
        )
        return invitations
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get invitations", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get invitations",
        )


@router.get("/verify/{token}", response_model=InvitationVerifyResponse)
async def verify_invitation(
    token: str = Path(..., description="Invitation token"),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Verify an invitation token (Public endpoint)

    Check if an invitation token is valid and get invitation details.
    This endpoint is public and does not require authentication.
    """
    try:
        invitation_service = InvitationService(database)
        verification = await invitation_service.verify_invitation(token)
        return verification
    except Exception as e:
        logger.error("Failed to verify invitation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify invitation",
        )


@router.post("/accept", status_code=status.HTTP_200_OK)
async def accept_invitation(
    request: InvitationAcceptRequest,
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Accept an invitation (Public endpoint)

    Accept an invitation and create a user account.
    This endpoint is called after the user signs up with Clerk.
    """
    try:
        invitation_service = InvitationService(database)
        user = await invitation_service.accept_invitation(
            token=request.token,
            clerk_id=request.clerk_id,
            email=request.email,
            name=request.name,
            selected_student_ids=request.selected_student_ids,
        )

        return {
            "success": True,
            "message": "Invitation accepted successfully",
            "user": {
                "id": user.clerk_id,
                "email": user.email,
                "name": user.name,
                "role": user.role.value,
            },
        }
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error("Failed to accept invitation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to accept invitation",
        )


@router.delete("/{invitation_id}", status_code=status.HTTP_200_OK)
async def revoke_invitation(
    invitation_id: str = Path(..., description="Invitation ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Revoke an invitation (Tutor only)

    Revoke a pending invitation. Only pending invitations can be revoked.
    """
    try:
        invitation_service = InvitationService(database)
        success = await invitation_service.revoke_invitation(
            invitation_id, current_user.clerk_id
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found"
            )

        return {"success": True, "message": "Invitation revoked successfully"}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error("Failed to revoke invitation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revoke invitation",
        )


@router.post("/{invitation_id}/resend", status_code=status.HTTP_200_OK)
async def resend_invitation(
    invitation_id: str = Path(..., description="Invitation ID"),
    current_user: ClerkUserContext = Depends(require_tutor),
    database: AsyncIOMotorDatabase = Depends(get_database),
):
    """
    Resend an invitation email (Tutor only)

    Resend the invitation email for a pending invitation.
    """
    try:
        logger.warning(
            "Resend invitation endpoint called before implementation",
            invitation_id=invitation_id,
            tutor_id=current_user.clerk_id,
        )
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Invitation resend is not available yet.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to resend invitation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resend invitation",
        )
