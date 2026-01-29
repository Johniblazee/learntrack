"""
Utility functions for the LearnTrack application
"""
import re
from typing import Union
from bson import ObjectId


def escape_regex(pattern: str) -> str:
    """
    Escape special regex characters in a string for safe use in MongoDB $regex queries.

    This prevents ReDoS (Regular Expression Denial of Service) attacks by escaping
    characters that have special meaning in regular expressions.

    Args:
        pattern: The user-provided search string to escape

    Returns:
        The escaped string safe for use in MongoDB $regex queries

    Example:
        >>> escape_regex("test (hello)")
        'test \\(hello\\)'
        >>> escape_regex("price: $100")
        'price: \\$100'
    """
    if not pattern:
        return pattern
    # Escape all regex special characters: . ^ $ * + ? { } [ ] \ | ( )
    return re.escape(pattern)


def to_object_id(id_value: str) -> Union[ObjectId, str]:
    """
    Convert a string ID to ObjectId if it's a valid ObjectId format,
    otherwise return the original string.
    
    This helper standardizes ObjectId handling across all services
    to prevent database query failures.
    
    Args:
        id_value: String ID that may or may not be a valid ObjectId
        
    Returns:
        ObjectId if the string is a valid ObjectId format, otherwise the original string
    """
    if ObjectId.is_valid(id_value):
        return ObjectId(id_value)
    return id_value
