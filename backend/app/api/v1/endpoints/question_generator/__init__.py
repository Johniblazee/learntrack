"""AI Question Generator Endpoints — LangGraph Agent.

Provides streaming SSE endpoints for question generation using the
LangGraph ReAct agent architecture.

Sub-routers:
  chat       — /chat, /chat-with-tools
  stream     — /generate, /edit  (SSE)
  sessions   — /sessions, /pending-questions, /all-questions, /sessions-with-questions
  review     — /approve, /reject, /request-revision
  bank       — /save-to-question-bank
  management — /update, /delete, /stats, /available-models
"""

from fastapi import APIRouter

from .chat import router as chat_router
from .stream import router as stream_router
from .sessions import router as sessions_router
from .review import router as review_router
from .bank import router as bank_router, save_session_questions_to_bank
from .management import router as management_router
from ._shared import SaveToQuestionBankRequest

router = APIRouter()
router.include_router(chat_router)
router.include_router(stream_router)
router.include_router(sessions_router)
router.include_router(review_router)
router.include_router(bank_router)
router.include_router(management_router)

__all__ = [
    "router",
    "SaveToQuestionBankRequest",
    "save_session_questions_to_bank",
]
