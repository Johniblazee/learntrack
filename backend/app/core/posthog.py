"""
PostHog analytics integration — server-side event capture.
No-ops gracefully when POSTHOG_API_KEY is not set.
"""

from typing import Any, Dict, Optional

from posthog import Posthog

from app.core.config import settings

_client: Optional[Posthog] = None

if settings.POSTHOG_API_KEY:
    _client = Posthog(
        api_key=settings.POSTHOG_API_KEY,
        host=settings.POSTHOG_API_HOST,
    )


def capture_event(
    distinct_id: str,
    event: str,
    properties: Optional[Dict[str, Any]] = None,
) -> None:
    """Send an event to PostHog. No-op when client is not configured."""
    if _client is None:
        return
    _client.capture(distinct_id, event, properties=properties)


def shutdown() -> None:
    """Flush pending events and close the PostHog client."""
    if _client is None:
        return
    _client.flush()
    _client.shutdown()
