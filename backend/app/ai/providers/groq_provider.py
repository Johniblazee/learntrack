"""
Groq AI Provider using LangChain
"""

from typing import List, Dict, Any, Optional
import structlog
import json
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from app.ai.providers.base import BaseAIProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.agents.prompts import get_prompt
from app.core.ai_models_config import get_default_model

logger = structlog.get_logger()


class GroqProvider(BaseAIProvider):
    """Groq AI provider using LangChain"""

    def __init__(self, api_key: str, model: str = None):
        super().__init__(api_key)
        # Use centralized config for default model
        self.model = model or get_default_model("groq") or "llama-3.3-70b-versatile"
        self.llm = ChatGroq(api_key=api_key, model_name=self.model, temperature=0.7)

    def set_model(self, model: str):
        """Change the active model"""
        self.model = model
        self.llm = ChatGroq(api_key=self.api_key, model_name=model, temperature=0.7)

    async def extract_text_from_content(self, content: str, file_type: str) -> str:
        """Extract and clean text from file content"""
        try:
            # Use centralized prompt from registry
            system_prompt = get_prompt("text_extraction")

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"Extract the main text from this {file_type} content:\n\n{content[:8000]}"
                ),
            ]
            response = await self.llm.ainvoke(messages)
            return response.content
        except Exception as e:
            logger.error(f"Groq text extraction failed: {e}")
            return content

    async def generate_questions(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None,
    ) -> List[QuestionCreate]:
        """Generate questions using Groq"""
        if question_types is None:
            question_types = [QuestionType.MULTIPLE_CHOICE]

        prompt = self._build_question_prompt(
            text_content, subject, topic, question_count, difficulty, question_types
        )

        try:
            # Use centralized prompt from registry
            system_prompt = get_prompt("simple_question_generator")

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=prompt),
            ]
            response = await self.llm.ainvoke(messages)
            return self._parse_ai_response(response.content, subject, topic)
        except Exception as e:
            logger.error(f"Groq question generation failed: {e}")
            return []

    async def validate_question(self, question: QuestionCreate) -> Dict[str, Any]:
        """Validate a question for quality and correctness"""
        try:
            prompt = f"""Validate this question for quality and correctness:
Question: {question.question_text}
Type: {question.question_type.value}
Options: {question.options if question.options else "N/A"}
Correct Answer: {question.correct_answer if question.correct_answer else "See options"}

Respond with JSON: {{"is_valid": true/false, "issues": [], "suggestions": [], "quality_score": 0-100}}"""

            # Use centralized prompt from registry
            system_prompt = get_prompt("simple_question_validator")

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=prompt),
            ]
            response = await self.llm.ainvoke(messages)

            content = response.content
            # Strip markdown code fences and normalize
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            # Handle single backtick inline JSON
            if content.startswith("`") and content.endswith("`"):
                content = content[1:-1].strip()

            try:
                return json.loads(content)
            except json.JSONDecodeError as je:
                logger.error(
                    "Groq validate_question JSON parse error",
                    error=str(je),
                    cleaned_content=content[:500],
                    exc_info=True,
                )
                return {
                    "is_valid": False,
                    "issues": ["AI validation failed: invalid JSON response"],
                    "suggestions": [],
                    "quality_score": 10,
                }
        except Exception as e:
            logger.error("Groq validation failed", error=str(e), exc_info=True)
            return {
                "is_valid": False,
                "issues": [f"AI validation failed: {str(e)[:200]}"],
                "suggestions": [],
                "quality_score": 5,
            }

    async def health_check(self) -> bool:
        """Check if Groq is available"""
        try:
            messages = [HumanMessage(content="Hello")]
            await self.llm.ainvoke(messages)
            return True
        except Exception as e:
            logger.error(f"Groq health check failed: {e}")
            return False
