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
        question_types: Optional[List[QuestionType]] = None
    ) -> List[QuestionCreate]:
        """Generate questions from text content"""
        pass
    
    @abstractmethod
    async def validate_question(self, question: QuestionCreate) -> Dict[str, Any]:
        """Validate a question for quality and correctness"""
        pass
    
    def _build_question_prompt(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int,
        difficulty: QuestionDifficulty,
        question_types: List[QuestionType]
    ) -> str:
        """Build prompt for question generation"""
        types_str = ", ".join([qt.value for qt in question_types])
        
        prompt = f"""
You are an expert educator creating assessment questions for the subject "{subject}" on the topic "{topic}".

Based on the following content, generate {question_count} high-quality {difficulty.value} level questions.

Question types to include: {types_str}

Content:
{text_content[:4000]}  # Limit content to avoid token limits

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
    
    def _parse_ai_response(self, response_text: str, subject_id: str, topic: str) -> List[QuestionCreate]:
        """Parse AI response into QuestionCreate objects"""
        try:
            import json
            
            # Try to extract JSON from response
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
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
                        correct_answer=q_data.get("correct_answer")
                    )
                    questions.append(question)
                except Exception as e:
                    logger.warning("Failed to parse question", error=str(e), question_data=q_data)
                    continue
            
            return questions
            
        except Exception as e:
            logger.error("Failed to parse AI response", error=str(e), response=response_text[:500])
            return []
    
    async def health_check(self) -> bool:
        """Check if the AI provider is available"""
        try:
            # Simple test to verify API connectivity
            test_response = await self.extract_text_from_content("Test content", "text/plain")
            return test_response is not None
        except Exception as e:
            logger.error(f"{self.provider_name} health check failed", error=str(e))
            return False
