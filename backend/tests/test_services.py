"""
Comprehensive backend test suite for LearnTrack
Tests all major services and API endpoints
"""

import pytest
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

# Import services
from app.services.assignment_service import AssignmentService
from app.services.question_service import QuestionService
from app.models.assignment import (
    Assignment,
    AssignmentCreate,
    AssignmentUpdate,
    AssignmentStatus,
)
from app.models.question import (
    Question,
    QuestionCreate,
    QuestionType,
    QuestionDifficulty,
    QuestionStatus,
)
from app.core.exceptions import NotFoundError, AuthorizationError


class TestAssignmentService:
    """Test suite for AssignmentService"""

    @pytest.fixture
    async def mock_db(self):
        """Create mock database"""
        db = AsyncMock(spec=AsyncIOMotorDatabase)
        db.assignments = AsyncMock()
        db.users = AsyncMock()
        return db

    @pytest.fixture
    async def assignment_service(self, mock_db):
        """Create assignment service with mock db"""
        return AssignmentService(mock_db)

    @pytest.mark.asyncio
    async def test_create_assignment(self, assignment_service, mock_db):
        """Test creating a new assignment"""
        # Arrange
        assignment_data = AssignmentCreate(
            title="Test Assignment",
            description="Test Description",
            subject_id=str(ObjectId()),
            tutor_id="tutor_123",
            student_ids=["student_1", "student_2"],
            due_date=datetime.now(timezone.utc),
            question_ids=[str(ObjectId())],  # At least one question required
        )
        tutor_id = "tutor_123"

        mock_db.assignments.insert_one.return_value = Mock(
            inserted_id=ObjectId("507f1f77bcf86cd799439011")
        )

        # Act
        result = await assignment_service.create_assignment(assignment_data, tutor_id)

        # Assert
        assert result is not None
        assert result.title == "Test Assignment"
        assert result.tutor_id == tutor_id
        mock_db.assignments.insert_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_assignment_by_id(self, assignment_service, mock_db):
        """Test retrieving assignment by ID"""
        # Arrange
        assignment_id = ObjectId("507f1f77bcf86cd799439011")
        tutor_id = "tutor_123"

        mock_db.assignments.find_one.return_value = {
            "_id": assignment_id,
            "title": "Test Assignment",
            "tutor_id": tutor_id,
            "student_ids": ["student_1"],
            "status": AssignmentStatus.DRAFT.value,
            "questions": [],
            "total_points": 100,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        # Act
        result = await assignment_service.get_assignment(str(assignment_id))

        # Assert
        assert result is not None
        assert result.title == "Test Assignment"
        assert result.tutor_id == tutor_id

    @pytest.mark.asyncio
    async def test_get_assignment_not_found(self, assignment_service, mock_db):
        """Test retrieving non-existent assignment"""
        # Arrange
        assignment_id = "507f1f77bcf86cd799439011"
        mock_db.assignments.find_one.return_value = None

        # Act & Assert
        with pytest.raises(NotFoundError):
            await assignment_service.get_assignment(assignment_id)

    @pytest.mark.asyncio
    async def test_update_assignment(self, assignment_service, mock_db):
        """Test updating an assignment"""
        # Arrange
        assignment_id = ObjectId("507f1f77bcf86cd799439011")
        tutor_id = "tutor_123"

        update_data = AssignmentUpdate(
            title="Updated Title", description="Updated Description"
        )

        mock_db.assignments.find_one.return_value = {
            "_id": assignment_id,
            "title": "Original Title",
            "tutor_id": tutor_id,
            "status": AssignmentStatus.DRAFT.value,
            "questions": [],
            "total_points": 100,
        }

        mock_db.assignments.update_one.return_value = Mock(modified_count=1)

        # Act
        result = await assignment_service.update_assignment(
            str(assignment_id), update_data, tutor_id
        )

        # Assert
        assert result is not None
        mock_db.assignments.update_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_assignment(self, assignment_service, mock_db):
        """Test deleting an assignment"""
        # Arrange
        assignment_id = ObjectId("507f1f77bcf86cd799439011")
        tutor_id = "tutor_123"

        mock_db.assignments.find_one.return_value = {
            "_id": assignment_id,
            "title": "Test Assignment",
            "tutor_id": tutor_id,
        }

        mock_db.assignments.delete_one.return_value = Mock(deleted_count=1)

        # Act
        result = await assignment_service.delete_assignment(
            str(assignment_id), tutor_id
        )

        # Assert
        assert result is True
        mock_db.assignments.delete_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_assignments_for_tutor(self, assignment_service, mock_db):
        """Test listing assignments for a tutor"""
        # Arrange
        tutor_id = "tutor_123"

        mock_assignments = [
            {
                "_id": ObjectId(),
                "title": "Assignment 1",
                "tutor_id": tutor_id,
                "status": AssignmentStatus.PUBLISHED.value,
                "student_ids": ["student_1"],
                "questions": [],
                "total_points": 100,
            },
            {
                "_id": ObjectId(),
                "title": "Assignment 2",
                "tutor_id": tutor_id,
                "status": AssignmentStatus.DRAFT.value,
                "student_ids": ["student_2"],
                "questions": [],
                "total_points": 50,
            },
        ]

        mock_cursor = AsyncMock()
        mock_cursor.to_list.return_value = mock_assignments
        mock_db.assignments.find.return_value = mock_cursor

        # Act
        result = await assignment_service.get_assignments_for_tutor(tutor_id)

        # Assert
        assert len(result) == 2
        assert result[0].tutor_id == tutor_id
        assert result[1].tutor_id == tutor_id


class TestQuestionService:
    """Test suite for QuestionService"""

    @pytest.fixture
    async def mock_db(self):
        """Create mock database"""
        db = AsyncMock(spec=AsyncIOMotorDatabase)
        db.questions = AsyncMock()
        return db

    @pytest.fixture
    async def question_service(self, mock_db):
        """Create question service with mock db"""
        return QuestionService(mock_db)

    @pytest.mark.asyncio
    async def test_create_question(self, question_service, mock_db):
        """Test creating a new question"""
        # Arrange
        question_data = QuestionCreate(
            question_text="What is 2+2?",
            question_type=QuestionType.MULTIPLE_CHOICE,
            subject_id=str(ObjectId()),
            difficulty=QuestionDifficulty.EASY,
            points=5,
            options=[
                {"text": "3", "is_correct": False},
                {"text": "4", "is_correct": True},
                {"text": "5", "is_correct": False},
            ],
            explanation="Basic arithmetic",
            tags=["math", "addition"],
        )
        tutor_id = "tutor_123"

        mock_db.questions.insert_one.return_value = Mock(
            inserted_id=ObjectId("507f1f77bcf86cd799439012")
        )

        # Act
        result = await question_service.create_question(question_data, tutor_id)

        # Assert
        assert result is not None
        assert result.question_text == "What is 2+2?"
        assert result.tutor_id == tutor_id
        mock_db.questions.insert_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_question_by_id(self, question_service, mock_db):
        """Test retrieving question by ID"""
        # Arrange
        question_id = ObjectId("507f1f77bcf86cd799439012")

        mock_db.questions.find_one.return_value = {
            "_id": question_id,
            "question_text": "What is 2+2?",
            "question_type": QuestionType.MULTIPLE_CHOICE.value,
            "subject_id": str(ObjectId()),
            "difficulty": QuestionDifficulty.EASY.value,
            "tutor_id": "tutor_123",
            "points": 5,
            "options": [{"text": "4", "is_correct": True}],
            "status": QuestionStatus.APPROVED.value,
            "created_at": datetime.now(timezone.utc),
        }

        # Act
        result = await question_service.get_question(str(question_id))

        # Assert
        assert result is not None
        assert result.question_text == "What is 2+2?"

    @pytest.mark.asyncio
    async def test_get_question_not_found(self, question_service, mock_db):
        """Test retrieving non-existent question"""
        # Arrange
        question_id = "507f1f77bcf86cd799439012"
        mock_db.questions.find_one.return_value = None

        # Act & Assert
        with pytest.raises(NotFoundError):
            await question_service.get_question(question_id)

    @pytest.mark.asyncio
    async def test_approve_question(self, question_service, mock_db):
        """Test approving a question"""
        # Arrange
        question_id = ObjectId("507f1f77bcf86cd799439012")
        tutor_id = "tutor_123"

        mock_db.questions.find_one.return_value = {
            "_id": question_id,
            "question_text": "Test Question",
            "tutor_id": tutor_id,
            "status": QuestionStatus.PENDING.value,
        }

        mock_db.questions.update_one.return_value = Mock(modified_count=1)

        # Act
        result = await question_service.approve_question(str(question_id), tutor_id)

        # Assert
        assert result is not None
        assert result.status == QuestionStatus.APPROVED
        mock_db.questions.update_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_reject_question(self, question_service, mock_db):
        """Test rejecting a question"""
        # Arrange
        question_id = ObjectId("507f1f77bcf86cd799439012")
        tutor_id = "tutor_123"
        reason = "Incorrect answer"

        mock_db.questions.find_one.return_value = {
            "_id": question_id,
            "question_text": "Test Question",
            "tutor_id": tutor_id,
            "status": QuestionStatus.PENDING.value,
        }

        mock_db.questions.update_one.return_value = Mock(modified_count=1)

        # Act
        result = await question_service.reject_question(
            str(question_id), tutor_id, reason
        )

        # Assert
        assert result is not None
        assert result.status == QuestionStatus.REJECTED
        mock_db.questions.update_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_questions_by_subject(self, question_service, mock_db):
        """Test listing questions by subject"""
        # Arrange
        subject_id = str(ObjectId())
        tutor_id = "tutor_123"

        mock_questions = [
            {
                "_id": ObjectId(),
                "question_text": "Question 1",
                "subject_id": subject_id,
                "tutor_id": tutor_id,
                "status": QuestionStatus.APPROVED.value,
            },
            {
                "_id": ObjectId(),
                "question_text": "Question 2",
                "subject_id": subject_id,
                "tutor_id": tutor_id,
                "status": QuestionStatus.APPROVED.value,
            },
        ]

        mock_cursor = AsyncMock()
        mock_cursor.to_list.return_value = mock_questions
        mock_db.questions.find.return_value = mock_cursor

        # Act
        result = await question_service.get_questions_by_subject(subject_id, tutor_id)

        # Assert
        assert len(result) == 2
        assert result[0].subject_id == subject_id

    @pytest.mark.asyncio
    async def test_bulk_approve_questions(self, question_service, mock_db):
        """Test bulk approving questions"""
        # Arrange
        question_ids = ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439013"]
        tutor_id = "tutor_123"

        mock_db.questions.update_many.return_value = Mock(modified_count=2)

        # Act
        result = await question_service.bulk_approve_questions(question_ids, tutor_id)

        # Assert
        assert result["approved_count"] == 2
        mock_db.questions.update_many.assert_called_once()


class TestAuthorization:
    """Test suite for authorization and access control"""

    @pytest.mark.asyncio
    async def test_tutor_cannot_access_other_tutor_assignment(self):
        """Test tenant isolation - Tutor A cannot access Tutor B's assignment"""
        # Arrange
        db = AsyncMock(spec=AsyncIOMotorDatabase)
        service = AssignmentService(db)

        assignment_id = ObjectId("507f1f77bcf86cd799439011")
        owner_tutor_id = "tutor_123"
        other_tutor_id = "tutor_456"

        db.assignments.find_one.return_value = {
            "_id": assignment_id,
            "title": "Assignment",
            "tutor_id": owner_tutor_id,
        }

        # Act & Assert
        with pytest.raises(AuthorizationError):
            await service.get_assignment_with_ownership_check(
                str(assignment_id), other_tutor_id
            )

    @pytest.mark.asyncio
    async def test_tutor_can_access_own_assignment(self):
        """Test tutor can access their own assignment"""
        # Arrange
        db = AsyncMock(spec=AsyncIOMotorDatabase)
        service = AssignmentService(db)

        assignment_id = ObjectId("507f1f77bcf86cd799439011")
        tutor_id = "tutor_123"

        db.assignments.find_one.return_value = {
            "_id": assignment_id,
            "title": "Assignment",
            "tutor_id": tutor_id,
            "status": AssignmentStatus.DRAFT.value,
            "questions": [],
            "total_points": 100,
        }

        # Act
        result = await service.get_assignment_with_ownership_check(
            str(assignment_id), tutor_id
        )

        # Assert
        assert result is not None
        assert result.tutor_id == tutor_id


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
