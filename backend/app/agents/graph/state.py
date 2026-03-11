"""
LangGraph State Schema for Question Generator Agent

Defines the state that flows through the agent graph using a
stateful agent architecture with conditional path routing.
"""

from typing import TypedDict, List, Optional, Dict, Any, Literal, Annotated
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field

try:
    from langgraph.graph.message import add_messages
except Exception:

    def add_messages(existing: List[Any], new: List[Any]) -> List[Any]:
        existing_messages = list(existing or [])
        new_messages = list(new or [])
        return [*existing_messages, *new_messages]


class QuestionType(str, Enum):
    MULTIPLE_CHOICE = "multiple-choice"
    TRUE_FALSE = "true-false"
    SHORT_ANSWER = "short-answer"
    ESSAY = "essay"


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    MIXED = "mixed"


class BloomsLevel(str, Enum):
    REMEMBER = "REMEMBER"
    UNDERSTAND = "UNDERSTAND"
    APPLY = "APPLY"
    ANALYZE = "ANALYZE"
    EVALUATE = "EVALUATE"
    CREATE = "CREATE"


# ============================================================================
# Agentic Workflow - Action Types
# ============================================================================


class ActionType(str, Enum):
    """
    The action type determines which path the agent takes.
    Based on conditional path routing.
    """

    # Generate new artifact (questions)
    GENERATE_ARTIFACT = "generateArtifact"

    # Update existing artifact (edit question)
    UPDATE_ARTIFACT = "updateArtifact"

    # Rewrite artifact completely (regenerate with same params)
    REWRITE_ARTIFACT = "rewriteArtifact"

    # Rewrite with different theme/style (change difficulty, type, etc.)
    REWRITE_ARTIFACT_THEME = "rewriteArtifactTheme"

    # Respond to user query about generated content
    RESPOND_TO_QUERY = "respondToQuery"


class ArtifactType(str, Enum):
    """Type of artifact being generated/modified"""

    QUESTION_SET = "question_set"
    SINGLE_QUESTION = "single_question"


class ArtifactContent(BaseModel):
    """
    The artifact content - in our case, generated questions.
    This represents the output of the generation process.
    """

    artifact_id: str
    artifact_type: ArtifactType = ArtifactType.QUESTION_SET
    title: str = "Generated Questions"
    current_index: int = 0  # For versioning
    contents: List[Dict[str, Any]] = []  # List of questions
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FollowupSuggestion(BaseModel):
    """A follow-up action suggestion after generation"""

    suggestion_type: Literal["topic", "difficulty", "type", "regenerate", "expand"]
    title: str
    description: str
    action_params: Dict[str, Any] = {}


class ReflectionResult(BaseModel):
    """Result of self-reflection on generated content"""

    overall_quality: float  # 0-1 score
    strengths: List[str] = []
    improvements: List[str] = []
    should_regenerate: bool = False
    regenerate_indices: List[int] = []  # Which questions to regenerate


class ThinkingStep(BaseModel):
    """A single thinking step for transparency display"""

    step_type: Literal["thinking", "action", "observation"]
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Optional[Dict[str, Any]] = None


class SourceChunk(BaseModel):
    """A chunk of source material retrieved via RAG or web search"""

    material_id: str
    material_title: str
    content: str
    location: Optional[str] = None  # Page number, section, etc.
    relevance_score: float = 0.0
    source_type: Literal["rag", "web", "default"] = "rag"  # Source of the chunk
    url: Optional[str] = None  # For web search results


class SourceCitation(BaseModel):
    """Citation linking a question to its source"""

    material_id: str
    material_title: str
    excerpt: str
    location: Optional[str] = None


class GeneratedQuestion(BaseModel):
    """A single generated question with all metadata"""

    question_id: str
    type: QuestionType
    difficulty: Difficulty
    blooms_level: BloomsLevel
    question_text: str
    options: Optional[List[str]] = None  # For multiple-choice/true-false
    correct_answer: str
    explanation: str
    source_citations: List[SourceCitation] = []
    tags: List[str] = []
    quality_score: Optional[float] = None
    is_valid: bool = True
    validation_issues: List[Dict[str, Any]] = []


class PromptAnalysis(BaseModel):
    """Result of analyzing the user's prompt"""

    subject: str
    topic: str
    question_count: int = 5
    question_types: List[QuestionType] = [QuestionType.MULTIPLE_CHOICE]
    difficulty: Difficulty = Difficulty.MEDIUM
    blooms_levels: List[BloomsLevel] | Literal["AUTO"] = "AUTO"
    special_requirements: List[str] = []
    needs_clarification: bool = False
    clarification_questions: List[str] = []
    enhanced_prompt: str = ""


class GenerationConfig(BaseModel):
    """Configuration for question generation"""

    question_count: int = 1
    question_types: List[QuestionType] = [QuestionType.MULTIPLE_CHOICE]
    difficulty: Difficulty = Difficulty.MEDIUM
    blooms_levels: List[BloomsLevel] | Literal["AUTO"] = "AUTO"
    subject: Optional[str] = None
    topic: Optional[str] = None
    grade_level: Optional[str] = None
    special_requirements: List[str] = []
    # ReAct agent iteration limit
    max_iterations: int = 3  # Maximum reasoning/action loops before forcing completion


class GenerationSession(BaseModel):
    """Persisted generation session for resume capability"""

    session_id: str
    user_id: str
    tenant_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    status: Literal["in_progress", "completed", "failed", "paused"] = "in_progress"
    config: GenerationConfig
    original_prompt: str
    enhanced_prompt: Optional[str] = None
    selected_materials: List[str] = []
    questions: List[GeneratedQuestion] = []
    thinking_steps: List[ThinkingStep] = []
    current_question_index: int = 0
    error_message: Optional[str] = None


class AgentState(TypedDict):
    """
    The state that flows through the LangGraph agent.

    This state is passed between nodes and accumulates information
    as the agent processes the generation request.
    """

    # =========================================================================
    # Session info
    # =========================================================================
    session_id: str
    user_id: str
    tenant_id: str

    # =========================================================================
    # Agent Workflow - Routing & Action
    # =========================================================================
    # The current action type (set by the router node)
    next_action: Optional[ActionType]

    # User's message/query (for respondToQuery)
    user_query: Optional[str]

    # Target question ID for update/rewrite operations
    target_question_id: Optional[str]

    # New theme/style parameters for rewriteArtifactTheme
    new_theme: Optional[Dict[str, Any]]

    # =========================================================================
    # Generation Artifact (Generated Questions)
    # =========================================================================
    artifact: Optional[ArtifactContent]

    # =========================================================================
    # Configuration
    # =========================================================================
    generation_config: GenerationConfig

    # =========================================================================
    # Prompt handling
    # =========================================================================
    original_prompt: str
    enhanced_prompt: Optional[str]
    prompt_analysis: Optional[PromptAnalysis]

    # =========================================================================
    # Materials (RAG) and Web Search
    # =========================================================================
    selected_material_ids: List[str]
    retrieved_chunks: List[SourceChunk]
    context_source: Literal["rag", "web", "default", "mixed"] = (
        "default"  # Which source was used
    )
    web_search_enabled: bool = True  # Whether web search is enabled for this tenant
    web_search_query: Optional[str] = None  # Custom web search query if provided

    # =========================================================================
    # Generation state (legacy - kept for compatibility)
    # =========================================================================
    questions: List[GeneratedQuestion]
    current_question_index: int

    # =========================================================================
    # Agent Workflow - Follow-up & Reflection
    # =========================================================================
    followup_suggestions: List[FollowupSuggestion]
    reflection_result: Optional[ReflectionResult]
    response_to_query: Optional[str]

    # =========================================================================
    # Transparency (Thinking Steps)
    # =========================================================================
    thinking_steps: List[ThinkingStep]

    # =========================================================================
    # Control flow
    # =========================================================================
    needs_clarification: bool
    is_complete: bool
    should_reflect: bool  # Whether to run reflection node
    error: Optional[str]

    # =========================================================================
    # ReAct Iteration Control
    # =========================================================================
    iteration_count: int  # Current iteration number (starts at 0)
    max_iterations: int  # Maximum iterations before forcing completion (default: 3)
