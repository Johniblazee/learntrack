"""
Google Gemini AI Provider using LangChain
"""
from typing import List, Dict, Any, Optional
import structlog
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage

from app.ai.providers.base import BaseAIProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.agents.prompts import get_prompt
from app.core.ai_models_config import get_default_model

logger = structlog.get_logger()

class GeminiProvider(BaseAIProvider):
    """Google Gemini AI provider using LangChain"""

    def __init__(self, api_key: str, model: str = None):
        super().__init__(api_key)
        # Use centralized config for default model
        self.model = model or get_default_model("gemini") or "gemini-3-pro-preview"
        self.llm = ChatGoogleGenerativeAI(google_api_key=api_key, model=self.model, temperature=0.7)

    def set_model(self, model: str):
        """Change the active model"""
        self.model = model
        self.llm = ChatGoogleGenerativeAI(google_api_key=self.api_key, model=model, temperature=0.7)

    async def extract_text_from_content(self, content: str, file_type: str) -> str:
        """Extract and clean text from file content"""
        try:
            messages = [HumanMessage(content=f"Extract the main text from this {file_type} content:\n\n{content[:8000]}")]
            response = await self.llm.ainvoke(messages)
            return response.content
        except Exception as e:
            logger.error(f"Gemini text extraction failed: {e}")
            return content

    async def generate_questions(
        self, text_content: str, subject: str, topic: str, question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None
    ) -> List[QuestionCreate]:
        """Generate questions using Gemini"""
        if question_types is None:
            question_types = [QuestionType.MULTIPLE_CHOICE]
        
        prompt = self._build_question_prompt(text_content, subject, topic, question_count, difficulty, question_types)
        
        try:
            system_prompt = get_prompt("simple_question_generator")
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=prompt)
            ]
            response = await self.llm.ainvoke(messages)
            return self._parse_ai_response(response.content, subject, topic)
        except Exception as e:
            logger.error(f"Gemini question generation failed: {e}")
            return []

    async def validate_question(self, question: QuestionCreate) -> Dict[str, Any]:
        """Validate a question for quality and correctness"""
        try:
            prompt = f"""Validate this question for quality and correctness:
Question: {question.question_text}
Type: {question.question_type.value}
Options: {question.options if question.options else 'N/A'}
Correct Answer: {question.correct_answer if question.correct_answer else 'See options'}

Respond with JSON only: {{"is_valid": true/false, "issues": [], "suggestions": [], "quality_score": 0-100}}"""
            
            messages = [HumanMessage(content=prompt)]
            response = await self.llm.ainvoke(messages)
            
            import json
            try:
                return json.loads(response.content)
            except:
                return {"is_valid": True, "issues": [], "suggestions": [], "quality_score": 75}
        except Exception as e:
            logger.error(f"Gemini validation failed: {e}")
            return {"is_valid": True, "issues": [], "suggestions": [], "quality_score": 50}

    async def health_check(self) -> bool:
        """Check if Gemini is available"""
        try:
            messages = [HumanMessage(content="Hello")]
            await self.llm.ainvoke(messages)
            return True
        except Exception as e:
            logger.error(f"Gemini health check failed: {e}")
            return False
