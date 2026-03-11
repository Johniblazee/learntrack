"""
Visibility service for enforcing role-based access control
"""

from typing import List, Dict, Optional
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from app.models.user import UserRole
from app.core.exceptions import NotFoundError, AuthorizationError
from app.core.utils import to_object_id

logger = structlog.get_logger()


class VisibilityService:
    """Service for managing visibility rules across roles with role-specific collections"""

    def __init__(self, database: AsyncIOMotorDatabase):
        self.database = database
        # Role-specific collections
        self.tutors = database.tutors
        self.students = database.students
        self.parents = database.parents
        self.conversations = database.conversations

    async def get_visible_users_for_student(self, student_clerk_id: str) -> List[str]:
        """
        Get list of user IDs visible to a student.
        Students can see:
        - Their assigned teacher (tutor)
        - Their linked parents
        """
        try:
            # Get student record from students collection
            student = await self.students.find_one({"clerk_id": student_clerk_id})
            if not student:
                raise NotFoundError("Student", student_clerk_id)

            visible_users = []

            # Add tutor
            if student.get("tutor_id"):
                visible_users.append(student["tutor_id"])

            # Add linked parents
            parent_ids = list(student.get("parent_ids", []) or [])
            if not parent_ids:
                linked_parents = await self.parents.find(
                    {
                        "$or": [
                            {"parent_children": student_clerk_id},
                            {"student_ids": student_clerk_id},
                        ]
                    },
                    {"clerk_id": 1},
                ).to_list(length=None)
                parent_ids = [
                    parent.get("clerk_id")
                    for parent in linked_parents
                    if parent.get("clerk_id")
                ]
            visible_users.extend(parent_ids)

            logger.info(
                "Retrieved visible users for student",
                student_id=student_clerk_id,
                visible_count=len(visible_users),
            )

            return visible_users

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to get visible users for student", error=str(e))
            return []

    async def get_visible_users_for_parent(self, parent_clerk_id: str) -> List[str]:
        """
        Get list of user IDs visible to a parent.
        Parents can see:
        - Their children (students)
        - Their children's teacher (tutor)
        """
        try:
            # Get parent record from parents collection
            parent = await self.parents.find_one({"clerk_id": parent_clerk_id})
            if not parent:
                raise NotFoundError("Parent", parent_clerk_id)

            visible_users = []

            child_ids = list(
                parent.get("parent_children") or parent.get("student_ids") or []
            )

            if child_ids:
                children = await self.students.find(
                    {"clerk_id": {"$in": child_ids}}
                ).to_list(length=None)
            else:
                children = await self.students.find(
                    {"parent_ids": parent_clerk_id}
                ).to_list(length=None)

            # Add children IDs
            child_ids = [child["clerk_id"] for child in children]
            visible_users.extend(child_ids)

            # Add children's tutors (unique)
            tutor_ids = set()
            for child in children:
                if child.get("tutor_id"):
                    tutor_ids.add(child["tutor_id"])

            visible_users.extend(list(tutor_ids))

            logger.info(
                "Retrieved visible users for parent",
                parent_id=parent_clerk_id,
                children_count=len(child_ids),
                tutors_count=len(tutor_ids),
            )

            return visible_users

        except NotFoundError:
            raise
        except Exception as e:
            logger.error("Failed to get visible users for parent", error=str(e))
            return []

    async def get_visible_users_for_tutor(self, tutor_clerk_id: str) -> List[str]:
        """
        Get list of user IDs visible to a tutor.
        Tutors can see:
        - All their students
        - All parents linked to their students
        """
        try:
            visible_users = []

            # Get all students for this tutor from students collection
            students = await self.students.find({"tutor_id": tutor_clerk_id}).to_list(
                length=None
            )

            # Add student IDs
            student_ids = [student["clerk_id"] for student in students]
            visible_users.extend(student_ids)

            # Collect all parent IDs from students
            parent_ids = set()
            for student in students:
                parent_ids.update(student.get("parent_ids", []))

            if not parent_ids and student_ids:
                parent_docs = await self.parents.find(
                    {
                        "tutor_id": tutor_clerk_id,
                        "$or": [
                            {"parent_children": {"$in": student_ids}},
                            {"student_ids": {"$in": student_ids}},
                        ],
                    },
                    {"clerk_id": 1},
                ).to_list(length=None)
                parent_ids.update(
                    parent.get("clerk_id")
                    for parent in parent_docs
                    if parent.get("clerk_id")
                )

            visible_users.extend(list(parent_ids))

            logger.info(
                "Retrieved visible users for tutor",
                tutor_id=tutor_clerk_id,
                students_count=len(student_ids),
                parents_count=len(parent_ids),
            )

            return visible_users

        except Exception as e:
            logger.error("Failed to get visible users for tutor", error=str(e))
            return []

    async def can_user_see_user(
        self, viewer_id: str, target_id: str, viewer_role: UserRole
    ) -> bool:
        """
        Check if viewer can see target user based on role-based visibility rules.
        """
        try:
            # Users can always see themselves
            if viewer_id == target_id:
                return True

            # Get visible users based on role
            if viewer_role == UserRole.STUDENT:
                visible_users = await self.get_visible_users_for_student(viewer_id)
            elif viewer_role == UserRole.PARENT:
                visible_users = await self.get_visible_users_for_parent(viewer_id)
            elif viewer_role == UserRole.TUTOR:
                visible_users = await self.get_visible_users_for_tutor(viewer_id)
            else:
                return False

            return target_id in visible_users

        except Exception as e:
            logger.error("Failed to check user visibility", error=str(e))
            return False

    async def can_user_access_conversation(
        self, user_id: str, conversation_id: str, user_role: UserRole
    ) -> bool:
        """
        Check if user can access a conversation.
        Users can only access conversations they are participants in.
        """
        try:
            conversation = await self.conversations.find_one(
                {"_id": to_object_id(conversation_id)}
            )

            if not conversation:
                return False

            # Check if user is a participant
            participants = conversation.get("participants", [])
            if user_id not in participants:
                return False

            return True

        except Exception as e:
            logger.error("Failed to check conversation access", error=str(e))
            return False

    async def can_access_question(
        self, user_id: str, question_id: str, user_role: UserRole
    ) -> bool:
        """
        Check if user can access a specific question.
        - Tutors: Can see questions they own or that are shared in their tenant.
        - Students: Can see questions assigned to them.
        """
        try:
            question = await self.database.questions.find_one({"_id": question_id})
            if not question:
                return False

            if user_role == UserRole.TUTOR:
                return question.get("tutor_id") == user_id

            if user_role == UserRole.STUDENT:
                # Check if question is in any of the student's active assignments
                assignment = await self.database.assignments.find_one(
                    {
                        "student_id": user_id,
                        "questions.question_id": question_id,
                        "status": "active",
                    }
                )
                return assignment is not None

            return False
        except Exception as e:
            logger.error("Failed to check question access", error=str(e))
            return False

    async def can_modify_question(
        self, user_id: str, question_id: str, user_role: UserRole
    ) -> bool:
        """Only tutors can modify their own questions."""
        if user_role != UserRole.TUTOR:
            return False
        return await self.can_access_question(user_id, question_id, user_role)

    async def can_access_assignment(
        self, user_id: str, assignment_id: str, user_role: UserRole
    ) -> bool:
        """
        Check if user can access a specific assignment.
        - Tutors: Can see assignments they created.
        - Students: Can see assignments assigned to them.
        - Parents: Can see assignments of their children.
        """
        try:
            assignment = await self.database.assignments.find_one(
                {"_id": assignment_id}
            )
            if not assignment:
                return False

            if user_role == UserRole.TUTOR:
                return assignment.get("tutor_id") == user_id

            if user_role == UserRole.STUDENT:
                return assignment.get("student_id") == user_id

            if user_role == UserRole.PARENT:
                student_id = assignment.get("student_id")
                return await self.can_user_see_user(user_id, student_id, user_role)

            return False
        except Exception as e:
            logger.error("Failed to check assignment access", error=str(e))
            return False

    async def can_access_subject(
        self, user_id: str, subject_id: str, user_role: UserRole
    ) -> bool:
        """Check if user can access a subject (must be same tutor/tenant scope)."""
        try:
            subject = await self.database.subjects.find_one({"_id": subject_id})
            if not subject:
                return False

            # subjects are usually tutor-scoped
            tutor_id = subject.get("tutor_id")
            if not tutor_id:
                return True  # Global subjects?

            return await self.can_user_see_user(user_id, tutor_id, user_role)
        except Exception as e:
            logger.error("Failed to check subject access", error=str(e))
            return False

    async def filter_users_by_visibility(
        self, viewer_id: str, viewer_role: UserRole, user_ids: List[str]
    ) -> List[str]:
        """
        Filter a list of user IDs to only include those visible to the viewer.
        """
        try:
            # Get visible users
            if viewer_role == UserRole.STUDENT:
                visible_users = await self.get_visible_users_for_student(viewer_id)
            elif viewer_role == UserRole.PARENT:
                visible_users = await self.get_visible_users_for_parent(viewer_id)
            elif viewer_role == UserRole.TUTOR:
                visible_users = await self.get_visible_users_for_tutor(viewer_id)
            else:
                return []

            # Filter user_ids to only include visible ones
            visible_set = set(visible_users)
            visible_set.add(viewer_id)  # Always include self

            filtered = [uid for uid in user_ids if uid in visible_set]

            logger.info(
                "Filtered users by visibility",
                viewer_id=viewer_id,
                original_count=len(user_ids),
                filtered_count=len(filtered),
            )

            return filtered

        except Exception as e:
            logger.error("Failed to filter users by visibility", error=str(e))
            return []

    async def get_visible_students_for_user(
        self, user_id: str, user_role: UserRole
    ) -> List[Dict]:
        """
        Get list of students visible to the user with full details.
        """
        try:
            if user_role == UserRole.TUTOR:
                # Tutors see all their students from students collection
                students = await self.students.find({"tutor_id": user_id}).to_list(
                    length=None
                )

            elif user_role == UserRole.PARENT:
                # Parents see only their children from students collection
                students = await self.students.find({"parent_ids": user_id}).to_list(
                    length=None
                )

            elif user_role == UserRole.STUDENT:
                # Students don't see other students
                students = []
            else:
                students = []

            return students

        except Exception as e:
            logger.error("Failed to get visible students", error=str(e))
            return []
