"""
Simplified AI Manager — all LLM calls go through LiteLLM.

The ``generate_questions`` / ``generate_questions_with_rag`` methods now use
``create_litellm_chat_model()`` directly (no old provider subclasses needed).
"""

from typing import List, Dict, Any, Optional
import json
import structlog

from app.core.config import settings
from app.ai.providers.base import AIProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.core.exceptions import AIProviderError
from app.utils.enums import normalize_question_type, normalize_difficulty

logger = structlog.get_logger()

# Map AIProvider enum → (provider_id, settings attr)
_PROVIDER_KEY_MAP = {
    AIProvider.OPENAI: ("openai", "OPENAI_API_KEY"),
    AIProvider.GROQ: ("groq", "GROQ_API_KEY"),
    AIProvider.GEMINI: ("gemini", "GEMINI_API_KEY"),
    AIProvider.ANTHROPIC: ("anthropic", "ANTHROPIC_API_KEY"),
}


class AIManager:
    """Thin AI manager — delegates to LiteLLM for all LLM calls."""

    def __init__(self):
        self._available: List[str] = []
        for enum_val, (pid, attr) in _PROVIDER_KEY_MAP.items():
            key = getattr(settings, attr, None)
            if key and len(key) > 10:
                self._available.append(pid)

    # ------------------------------------------------------------------
    # LiteLLM-based chat model
    # ------------------------------------------------------------------

    @staticmethod
    def get_chat_model(
        provider_id: str,
        model_id: str,
        encrypted_tutor_key: Optional[str] = None,
        **kwargs,
    ):
        """Return a LangChain ``BaseChatModel`` via LiteLLM."""
        from app.ai.litellm_provider import create_litellm_chat_model

        return create_litellm_chat_model(
            provider_id=provider_id,
            model_id=model_id,
            encrypted_tutor_key=encrypted_tutor_key,
            **kwargs,
        )

    # ------------------------------------------------------------------
    # Question generation (used by RAG endpoint)
    # ------------------------------------------------------------------

    def _pick_provider_and_model(
        self, preferred: Optional[str] = None
    ) -> tuple[str, str]:
        """Return (provider_id, default_model_id) for the best available provider."""
        from app.core.ai_models_config import get_default_model

        candidates = []
        if preferred and preferred in self._available:
            candidates.append(preferred)
        candidates.extend(p for p in self._available if p not in candidates)

        if not candidates:
            raise AIProviderError("No AI providers configured — check API keys")

        pid = candidates[0]
        model = get_default_model(pid) or {
            "openai": "gpt-4o",
            "groq": "llama-3.3-70b-versatile",
            "gemini": "gemini-2.0-flash",
            "anthropic": "claude-sonnet-4-20250514",
        }.get(pid, "gpt-4o")
        return pid, model

    @staticmethod
    def _build_prompt(
        text_content: str,
        subject: str,
        topic: str,
        question_count: int,
        difficulty: QuestionDifficulty,
        question_types: List[QuestionType],
    ) -> str:
        types_str = ", ".join(qt.value for qt in question_types)
        truncated = text_content[:4000]
        return f"""You are an expert educator creating assessment questions for the subject "{subject}" on the topic "{topic}".

Based on the following content, generate {question_count} high-quality {difficulty.value} level questions.

Question types to include: {types_str}

Content:
{truncated}

Requirements:
1. Questions should be clear, unambiguous, and directly related to the content
2. For multiple-choice questions, provide 4 options with exactly one correct answer
3. Include explanations for correct answers
4. Vary the cognitive levels (knowledge, comprehension, application, analysis)
5. Ensure questions are appropriate for the {difficulty.value} difficulty level

Return ONLY valid JSON with this structure:
{{
    "questions": [
        {{
            "question_text": "...",
            "question_type": "multiple-choice|true-false|short-answer|essay",
            "difficulty": "{difficulty.value}",
            "points": 1,
            "explanation": "...",
            "options": [
                {{"text": "Option A", "is_correct": false}},
                {{"text": "Option B", "is_correct": true}},
                {{"text": "Option C", "is_correct": false}},
                {{"text": "Option D", "is_correct": false}}
            ],
            "correct_answer": "For non-multiple choice",
            "tags": ["tag1"]
        }}
    ]
}}

Generate exactly {question_count} questions."""

    @staticmethod
    def _parse_response(text: str, subject_id: str, topic: str) -> List[QuestionCreate]:
        if "```json" in text:
            start = text.find("```json") + 7
            end = text.find("```", start)
            text = text[start:end].strip() if end != -1 else text[start:].strip()

        payload = json.loads(text)
        items = (
            payload.get("questions", payload) if isinstance(payload, dict) else payload
        )
        if not isinstance(items, list):
            items = [items] if isinstance(items, dict) else []

        questions: List[QuestionCreate] = []
        for q in items:
            try:
                questions.append(
                    QuestionCreate(
                        question_text=q["question_text"],
                        question_type=normalize_question_type(
                            q.get("question_type") or q.get("type")
                        ),
                        subject_id=subject_id,
                        topic=topic,
                        difficulty=normalize_difficulty(q.get("difficulty")),
                        points=q.get("points", 1),
                        explanation=q.get("explanation"),
                        tags=q.get("tags", []),
                        options=q.get("options", []),
                        correct_answer=q.get("correct_answer"),
                    )
                )
            except Exception as e:
                logger.warning("Failed to parse question", error=str(e))
        return questions

    async def generate_questions(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        preferred_provider: Optional[str] = None,
        provider_id: Optional[str] = None,
        model_id: Optional[str] = None,
        encrypted_tutor_key: Optional[str] = None,
    ) -> List[QuestionCreate]:
        types = question_types or [QuestionType.MULTIPLE_CHOICE]
        pid = provider_id
        model = model_id
        if not pid or not model:
            pid, model = self._pick_provider_and_model(
                preferred_provider or provider_id
            )

        from app.ai.litellm_provider import create_litellm_chat_model
        from langchain_core.messages import HumanMessage

        llm = create_litellm_chat_model(
            provider_id=pid,
            model_id=model,
            encrypted_tutor_key=encrypted_tutor_key,
            temperature=0.7,
        )
        prompt = self._build_prompt(
            text_content, subject, topic, question_count, difficulty, types
        )

        response = await llm.ainvoke([HumanMessage(content=prompt)])
        response_content = response.content
        if isinstance(response_content, list):
            response_content = "\n".join(
                str(part) for part in response_content if part is not None
            )
        return self._parse_response(str(response_content), subject, topic)

    async def generate_questions_with_rag(
        self,
        rag_context: str,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
        preferred_provider: Optional[str] = None,
        provider_id: Optional[str] = None,
        model_id: Optional[str] = None,
        encrypted_tutor_key: Optional[str] = None,
    ) -> List[QuestionCreate]:
        combined = f"RAG Context:\n{rag_context}\n\nOriginal Content:\n{text_content}"
        return await self.generate_questions(
            text_content=combined,
            subject=subject,
            topic=topic,
            question_count=question_count,
            difficulty=difficulty,
            question_types=question_types,
            preferred_provider=preferred_provider,
            provider_id=provider_id,
            model_id=model_id,
            encrypted_tutor_key=encrypted_tutor_key,
        )

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_available_providers(self) -> List[str]:
        return list(self._available)

    def get_provider(self, name: str):
        return None  # Legacy — no longer used

    def get_available_models(
        self, provider_name: Optional[str] = None
    ) -> Dict[str, List[str]]:
        from app.core.ai_models_config import get_model_ids, ALL_PROVIDER_MODELS

        if provider_name:
            key = provider_name.lower()
            ids = get_model_ids(key, active_only=True)
            return {key: ids} if ids else {}
        return {p: get_model_ids(p, active_only=True) for p in ALL_PROVIDER_MODELS}


# ---------------------------------------------------------------------------
# Module-level helpers (backward compat)
# ---------------------------------------------------------------------------


def invalidate_tenant_ai_manager(tenant_id: str) -> None:
    """No-op — tenant caching removed. Kept for call-site compatibility."""
    pass


async def get_tenant_ai_manager(tenant_id: str, db=None) -> AIManager:
    return AIManager()


async def get_ai_manager_for_tenant(tenant_id: str, tenant_config=None) -> AIManager:
    return AIManager()


def create_ai_manager(**kwargs) -> AIManager:
    return AIManager()


def get_default_ai_manager() -> AIManager:
    return AIManager()
