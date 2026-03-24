"""Pydantic schemas for structured LLM outputs."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class PromptAnalysisOutput(BaseModel):
    subject: str = Field(default="General")
    topic: str = Field(default="")
    question_count: int = Field(default=5, ge=1, le=50)
    question_types: List[str] = Field(default_factory=lambda: ["multiple-choice"])
    difficulty: str = Field(default="medium")
    blooms_levels: List[str] | Literal["AUTO"] = Field(default="AUTO")
    special_requirements: List[str] = Field(default_factory=list)
    needs_clarification: bool = Field(default=False)
    clarification_questions: List[str] = Field(default_factory=list)
    enhanced_prompt: str = Field(default="")


class SourceCitationOutput(BaseModel):
    material_id: str = Field(default="")
    material_title: str = Field(default="")
    excerpt: str = Field(default="")
    location: Optional[str] = Field(default=None)


class GeneratedQuestionOutput(BaseModel):
    question_id: Optional[str] = Field(default=None)
    question_type: str = Field(default="multiple-choice")
    difficulty: str = Field(default="medium")
    blooms_level: str = Field(default="UNDERSTAND")
    question_text: str = Field(default="")
    options: List[str] = Field(default_factory=list)
    correct_answer: str = Field(default="")
    explanation: str = Field(default="")
    source_citations: List[SourceCitationOutput] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)


class GeneratedQuestionListOutput(BaseModel):
    questions: List[GeneratedQuestionOutput] = Field(default_factory=list)


class ReflectionOutput(BaseModel):
    overall_quality: float = Field(default=0.85, ge=0.0, le=1.0)
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    should_regenerate: bool = Field(default=False)
    regenerate_indices: List[int] = Field(default_factory=list)


class QuestionBatchOutput(BaseModel):
    questions: List[GeneratedQuestionOutput] = Field(default_factory=list)
