"""Progress tracking endpoints.

Sub-routers:
  student    — /student, /student/{id}/analytics, /parent
  tutor      — /reports, /assignment/{id} (overview), /subject/{id}/analytics
  assignment — /assignment/{id}/student/{id}, /assignment/{id} (PUT), /assignment/{id}/answer
  grading    — /submissions, /submissions/{id}/grade, /submissions/{id}/release
"""

from fastapi import APIRouter

from .student import router as student_router
from .tutor import router as tutor_router
from .assignment import router as assignment_router
from .grading import router as grading_router
from ._shared import (
    derive_submission_totals as _derive_submission_totals,
    get_authorized_student_record as _get_authorized_student_record,
)
from .assignment import get_student_assignment_progress, submit_answer
from .grading import (
    list_submissions_for_grading,
    grade_submission,
    release_submission_results,
)

router = APIRouter()

# Student/parent views first (static paths before dynamic)
router.include_router(student_router)
# Tutor overview — /reports before /assignment/{id}
router.include_router(tutor_router)
# Assignment-specific student progress
router.include_router(assignment_router)
# Grading center
router.include_router(grading_router)
