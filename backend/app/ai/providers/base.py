"""
Base AI provider interface
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from enum import Enum
import structlog

from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.utils.enums import normalize_question_type, normalize_difficulty

logger = structlog.get_logger()


class AIProvider(str, Enum):
    """Available AI providers"""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GROQ = "groq"
    GEMINI = "gemini"
    # Legacy alias
    GOOGLE = "gemini"


class BaseAIProvider(ABC):
    """Base class for AI providers"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.provider_name = self.__class__.__name__.lower().replace("provider", "")

    @abstractmethod
    async def extract_text_from_content(self, content: str, file_type: str) -> str:
        """Extract and clean text from file content"""
        pass

    @abstractmethod
    async def generate_questions(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
    ) -> List[QuestionCreate]:
        """Generate questions from text content"""
        pass

    @abstractmethod
    async def validate_question(self, question: QuestionCreate) -> Dict[str, Any]:
        """Validate a question for quality and correctness"""
        pass

    def _sanitize_input(self, text: str) -> str:
        """Sanitize user input to reduce prompt injection risks.

        Strips common directive-like phrases that could alter prompt behavior.
        Note: This provides defense-in-depth but cannot fully eliminate prompt
        injection risks from determined adversaries with full control over inputs.
        """
        if not text:
            return text
        # Strip/escape common directive patterns (case-insensitive)
        dangerous_patterns = [
            "ignore previous instructions",
            "ignore all previous instructions",
            "disregard previous",
            "forget everything",
            "system prompt:",
            "new instructions:",
            "you are now",
            "role:",
        ]
        import re

        for pattern in dangerous_patterns:
            text = re.sub(pattern, "[FILTERED]", text, flags=re.IGNORECASE)
        return text

    def _build_question_prompt(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int,
        difficulty: QuestionDifficulty,
        question_types: List[QuestionType],
        max_content_chars: int = 4000,
    ) -> str:
        """Build prompt for question generation.

        Args:
            text_content: The educational content to base questions on
            subject: Subject area for the questions
            topic: Specific topic within the subject
            question_count: Number of questions to generate
            difficulty: Difficulty level for questions
            question_types: Types of questions to include
            max_content_chars: Maximum characters to include from content (default 4000)

        Note: User inputs are sanitized before interpolation, but residual prompt
        injection risk remains if inputs contain carefully crafted sequences.
        """
        types_str = ", ".join([qt.value for qt in question_types])

        # Sanitize user-controlled inputs before interpolation
        safe_subject = self._sanitize_input(subject)
        safe_topic = self._sanitize_input(topic)
        safe_text = self._sanitize_input(text_content)

        # Truncate content before interpolation to avoid embedding comments in the prompt
        truncated_text = safe_text[:max_content_chars]

        prompt = f"""
You are an expert educator creating assessment questions for the subject "{safe_subject}" on the topic "{safe_topic}".

Based on the following content, generate {question_count} high-quality {difficulty.value} level questions.

Question types to include: {types_str}

Content:
{truncated_text}

Requirements:
1. Questions should be clear, unambiguous, and directly related to the content
2. For multiple-choice questions, provide 4 options with exactly one correct answer
3. Include explanations for correct answers
4. Vary the cognitive levels (knowledge, comprehension, application, analysis)
5. Ensure questions are appropriate for the {difficulty.value} difficulty level

Format your response as a JSON object with a top-level "questions" array:
{{
    "questions": [
        {{
            "question_text": "The question text",
            "question_type": "multiple-choice|true-false|short-answer|essay",
            "difficulty": "{difficulty.value}",
            "points": 1,
            "explanation": "Explanation of the correct answer",
            "options": [
                {{"text": "Option A", "is_correct": false}},
                {{"text": "Option B", "is_correct": true}},
                {{"text": "Option C", "is_correct": false}},
                {{"text": "Option D", "is_correct": false}}
            ],
            "correct_answer": "For non-multiple choice questions",
            "tags": ["relevant", "tags"]
        }}
    ]
}}

Generate exactly {question_count} questions.
"""
        return prompt

    def _parse_ai_response(
        self, response_text: str, subject_id: str, topic: str
    ) -> List[QuestionCreate]:
        """Parse AI response into QuestionCreate objects"""
        try:
            import json

            # Try to extract JSON from response
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                # If the closing fence is missing, take the remainder of the response
                if json_end == -1:
                    json_text = response_text[json_start:].strip()
                else:
                    json_text = response_text[json_start:json_end].strip()
            else:
                json_text = response_text.strip()

            payload = json.loads(json_text)
            if isinstance(payload, dict):
                questions_data = payload.get("questions", [])
            else:
                questions_data = payload

            if isinstance(questions_data, dict):
                questions_data = [questions_data]
            if not isinstance(questions_data, list):
                questions_data = []

            questions = []
            for q_data in questions_data:
                try:
                    question = QuestionCreate(
                        question_text=q_data["question_text"],
                        question_type=normalize_question_type(
                            q_data.get("question_type") or q_data.get("type")
                        ),
                        subject_id=subject_id,
                        topic=topic,
                        difficulty=normalize_difficulty(q_data.get("difficulty")),
                        points=q_data.get("points", 1),
                        explanation=q_data.get("explanation"),
                        tags=q_data.get("tags", []),
                        options=q_data.get("options", []),
                        correct_answer=q_data.get("correct_answer"),
                    )
                    questions.append(question)
                except Exception as e:
                    # Avoid logging potentially sensitive question content. Log keys instead.
                    try:
                        q_keys = (
                            list(q_data.keys()) if isinstance(q_data, dict) else None
                        )
                    except Exception:
                        q_keys = None
                    logger.warning(
                        "Failed to parse question",
                        error=str(e),
                        question_keys=q_keys,
                    )
                    continue

            return questions

        except Exception as e:
            # Log only safe metadata - never log user/AI content
            logger.error(
                "Failed to parse AI response",
                error=str(e),
                provider=self.provider_name,
                response_length=len(response_text) if response_text else 0,
            )
            from app.core.exceptions import AIProviderError

            raise AIProviderError(
                f"Failed to parse AI response from {self.provider_name}: {e}"
            )

    # Health check endpoint URLs for lightweight connectivity verification.
    # Subclasses can override with provider-specific URLs.
    _HEALTH_CHECK_URLS: Dict[str, str] = {
        "openai": "https://api.openai.com/v1/models",
        "groq": "https://api.groq.com/openai/v1/models",
        "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
        "anthropic": "https://api.anthropic.com/v1/messages",
    }

    async def health_check(self) -> bool:
        """Check if the AI provider is available using a lightweight HTTP request
        instead of a real LLM call."""
        import httpx
        from cachetools import TTLCache

        # Module-level cache — shared across all provider instances
        if not hasattr(BaseAIProvider, "_health_cache"):
            BaseAIProvider._health_cache = TTLCache(maxsize=16, ttl=60)

        cache_key = self.provider_name
        cached = BaseAIProvider._health_cache.get(cache_key)
        if cached is not None:
            return cached

        url = self._HEALTH_CHECK_URLS.get(self.provider_name)
        if not url:
            # Unknown provider — assume healthy to avoid blocking
            return True

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                # 200 = success, 401/403 = key invalid but service reachable
                is_healthy = response.status_code < 500
                BaseAIProvider._health_cache[cache_key] = is_healthy
                return is_healthy
        except Exception as e:
            logger.warning(
                f"{self.provider_name} health check failed", error=str(e)
            )
            BaseAIProvider._health_cache[cache_key] = False
            return False
