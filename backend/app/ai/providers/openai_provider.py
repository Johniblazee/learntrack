"""
OpenAI provider implementation
"""
from typing import List, Dict, Any, Optional
import asyncio
import structlog
from openai import AsyncOpenAI

from app.ai.providers.base import BaseAIProvider
from app.models.question import QuestionCreate, QuestionDifficulty, QuestionType
from app.core.exceptions import AIProviderError
from app.agents.prompts import get_prompt
from app.core.ai_models_config import get_default_model

logger = structlog.get_logger()

class OpenAIProvider(BaseAIProvider):
    """OpenAI provider for question generation"""

    def __init__(self, api_key: str, model: str = None):
        super().__init__(api_key)
        self.client = AsyncOpenAI(api_key=api_key)
        # Use centralized config for default model
        self.model = model or get_default_model("openai") or "gpt-4o"

    def set_model(self, model: str):
        """Change the active model"""
        self.model = model
    
    async def extract_text_from_content(self, content: str, file_type: str) -> str:
        """Extract and clean text from file content using OpenAI"""
        try:
            if file_type == "text/plain":
                return content
            
            # For other file types, use OpenAI to extract and clean text
            prompt = f"""
            Extract and clean the text content from the following {file_type} content.
            Remove any formatting artifacts, headers, footers, and irrelevant metadata.
            Return only the main educational content that would be useful for generating questions.
            
            Content:
            {content[:8000]}  # Limit to avoid token limits
            """
            
            # Use centralized prompt from registry
            system_prompt = get_prompt("text_extraction")

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=2000,
                temperature=0.1
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error("OpenAI text extraction failed", error=str(e))
            raise AIProviderError(f"Text extraction failed: {str(e)}", "openai")
    
    async def generate_questions(
        self,
        text_content: str,
        subject: str,
        topic: str,
        question_count: int = 10,
        difficulty: QuestionDifficulty = QuestionDifficulty.MEDIUM,
        question_types: Optional[List[QuestionType]] = None
    ) -> List[QuestionCreate]:
        """Generate questions using OpenAI"""
        try:
            if question_types is None:
                question_types = [QuestionType.MULTIPLE_CHOICE, QuestionType.SHORT_ANSWER]
            
            prompt = self._build_question_prompt(
                text_content, subject, topic, question_count, difficulty, question_types
            )

            # Use centralized prompt from registry
            system_prompt = get_prompt("simple_question_generator")

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=4000,
                temperature=0.7,
                response_format={"type": "json_object"}
            )
            
            response_text = response.choices[0].message.content
            questions = self._parse_ai_response(response_text, subject, topic)
            
            logger.info("OpenAI questions generated", count=len(questions), subject=subject, topic=topic)
            return questions
            
        except Exception as e:
            logger.error("OpenAI question generation failed", error=str(e))
            raise AIProviderError(f"Question generation failed: {str(e)}", "openai")
    
    async def validate_question(self, question: QuestionCreate) -> Dict[str, Any]:
        """Validate a question using OpenAI"""
        try:
            prompt = f"""
            Evaluate the following educational question for quality and correctness:
            
            Question: {question.question_text}
            Type: {question.question_type}
            Subject: {question.subject_id}
            Topic: {question.topic}
            Difficulty: {question.difficulty}
            
            Options: {question.options if question.options else 'N/A'}
            Correct Answer: {question.correct_answer if question.correct_answer else 'N/A'}
            Explanation: {question.explanation if question.explanation else 'N/A'}
            
            Provide a validation report with:
            1. Overall quality score (1-10)
            2. Clarity score (1-10)
            3. Difficulty appropriateness (1-10)
            4. Any issues or suggestions for improvement
            5. Whether the question is acceptable (true/false)
            
            Format as JSON.
            """
            
            # Use centralized prompt from registry
            system_prompt = get_prompt("simple_question_validator")

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=1000,
                temperature=0.3,
                response_format={"type": "json_object"}
            )
            
            import json
            validation_result = json.loads(response.choices[0].message.content)
            
            return validation_result
            
        except Exception as e:
            logger.error("OpenAI question validation failed", error=str(e))
            return {
                "quality_score": 5,
                "clarity_score": 5,
                "difficulty_score": 5,
                "issues": [f"Validation failed: {str(e)}"],
                "acceptable": True  # Default to acceptable if validation fails
            }
    
    async def health_check(self) -> bool:
        """Check OpenAI API health"""
        try:
            # Use a smaller, representative model from the updated list for health checks
            # to avoid hardcoding models that might be removed.
            health_check_model = "gpt-5.2-mini" # Use a model from the *new* OPENAI_MODELS

            response = await self.client.chat.completions.create(
                model=health_check_model,
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=5
            )
            return response.choices[0].message.content is not None
        except Exception as e:
            logger.error("OpenAI health check failed", error=str(e))
            return False
