"""
LangGraph Edge Definitions - Open Canvas Architecture

Conditional edge functions for routing in the question generation graph.
Follows the Open Canvas pattern with generatePath routing.

Architecture:
  __start__ -> generatePath -> [artifact operations] -> generateFollowup -> reflect -> cleanState -> __end__
                            -> respondToQuery -> cleanState -> __end__
"""

from typing import Literal
from app.agents.graph.state import AgentState, ActionType


# =============================================================================
# Agent Workflow Routing Functions
# =============================================================================


def route_after_generate_path(state: AgentState) -> str:
    """
    Central routing function after generatePath node.
    Routes to appropriate artifact operation based on next_action.

    Returns node name to route to.
    """
    action = state.get("next_action")

    if action == ActionType.RESPOND_TO_QUERY:
        return "respond_to_query"
    elif action == ActionType.UPDATE_ARTIFACT:
        return "update_artifact"
    elif action == ActionType.REWRITE_ARTIFACT:
        return "rewrite_artifact"
    elif action == ActionType.REWRITE_ARTIFACT_THEME:
        return "rewrite_artifact_theme"
    else:
        # Default: generate new artifact
        return "generate_artifact"


def route_after_artifact_operation(state: AgentState) -> str:
    """
    Route after any artifact operation.
    Goes to generateFollowup for suggestions.
    """
    if state.get("error"):
        return "clean_state"
    return "generate_followup"


def route_after_respond_to_query(state: AgentState) -> str:
    """
    Route after responding to query.
    Goes directly to cleanState (no followup/reflect needed).
    """
    return "clean_state"


def route_after_followup(state: AgentState) -> str:
    """
    Route after generating followup suggestions.
    Goes to reflect if should_reflect is True.
    """
    if state.get("should_reflect", True):
        return "reflect"
    return "clean_state"


def route_after_reflect(state: AgentState) -> str:
    """
    Route after reflection.
    Check if regeneration is needed based on reflection result.

    ReAct Pattern: Enforces max_iterations limit to prevent infinite loops.
    If iteration_count >= max_iterations, forces completion even if
    reflection suggests regeneration.
    """
    reflection = state.get("reflection_result")
    iteration_count = state.get("iteration_count", 0)
    max_iterations = state.get("max_iterations", 3)  # Default to 3 if not set

    # Check iteration limit first (ReAct pattern safety)
    if iteration_count >= max_iterations:
        # Force completion - we've hit the iteration limit
        return "clean_state"

    if reflection and reflection.should_regenerate:
        # Go back to generate for regeneration
        return "generate_artifact"

    return "clean_state"


def check_iteration_limit(state: AgentState) -> bool:
    """
    Check if the agent has exceeded the maximum iteration limit.

    This is a ReAct pattern safety mechanism to prevent infinite loops
    in the reasoning/action cycle.

    Returns:
        True if iteration limit has been reached, False otherwise.
    """
    iteration_count = state.get("iteration_count", 0)
    max_iterations = state.get("max_iterations", 3)
    return iteration_count >= max_iterations


# =============================================================================
# Legacy Routing Functions (kept for backward compatibility)
# =============================================================================


def should_continue_after_analysis(
    state: AgentState,
) -> Literal["continue", "clarify", "error"]:
    """
    Determine next step after prompt analysis.

    Returns:
        - "continue": Proceed to material retrieval
        - "clarify": Need clarification from user
        - "error": Analysis failed
    """
    if state.get("error"):
        return "error"

    if state.get("needs_clarification"):
        return "clarify"

    return "continue"


def should_validate(state: AgentState) -> Literal["validate", "skip", "error"]:
    """
    Determine if validation should be run.

    Returns:
        - "validate": Run validation
        - "skip": Skip validation (no questions)
        - "error": Generation failed
    """
    if state.get("error"):
        return "error"

    questions = state.get("questions", [])
    if not questions:
        return "skip"

    return "validate"


def check_quality(state: AgentState) -> Literal["pass", "regenerate", "partial"]:
    """
    Check overall quality of generated questions.

    Returns:
        - "pass": All questions are valid
        - "regenerate": Too many invalid questions, regenerate
        - "partial": Some invalid, but acceptable
    """
    questions = state.get("questions", [])

    if not questions:
        return "regenerate"

    invalid_count = sum(1 for q in questions if not q.is_valid)
    invalid_ratio = invalid_count / len(questions)

    if invalid_ratio > 0.5:
        return "regenerate"
    elif invalid_ratio > 0:
        return "partial"

    return "pass"


def determine_completion(state: AgentState) -> Literal["complete", "continue", "error"]:
    """
    Determine if generation is complete.

    Returns:
        - "complete": All questions generated and valid
        - "continue": Need more questions
        - "error": Fatal error occurred
    """
    if state.get("error"):
        return "error"

    config = state.get("generation_config")
    questions = state.get("questions", [])

    if not config:
        return "error"

    # Check if we have enough valid questions
    valid_count = sum(1 for q in questions if q.is_valid)

    if valid_count >= config.question_count:
        return "complete"

    return "continue"


# =============================================================================
# Edge Mappings
# =============================================================================


# Open Canvas edge mappings
OPEN_CANVAS_EDGE_MAPPINGS = {
    "after_generate_path": {
        "generate_artifact": "generate_artifact",
        "update_artifact": "update_artifact",
        "rewrite_artifact": "rewrite_artifact",
        "rewrite_artifact_theme": "rewrite_artifact_theme",
        "respond_to_query": "respond_to_query",
    },
    "after_artifact": {
        "generate_followup": "generate_followup",
        "clean_state": "clean_state",
    },
    "after_respond": {"clean_state": "clean_state"},
    "after_followup": {"reflect": "reflect", "clean_state": "clean_state"},
    "after_reflect": {
        "generate_artifact": "generate_artifact",
        "clean_state": "clean_state",
    },
}


# Legacy edge mappings (kept for backward compatibility)
EDGE_MAPPINGS = {
    "after_analysis": {
        "continue": "retrieve_materials",
        "clarify": "end",
        "error": "end",
    },
    "after_generation": {
        "validate": "validate_questions",
        "skip": "end",
        "error": "end",
    },
    "after_validation": {
        "pass": "end",
        "regenerate": "generate_questions",
        "partial": "end",
    },
    "completion_check": {
        "complete": "end",
        "continue": "generate_questions",
        "error": "end",
    },
}
