"""
SSE Handler for Question Generation Streaming

Manages the Server-Sent Events stream for real-time updates
during question generation.
"""

from typing import AsyncGenerator, Optional, Callable, Awaitable, Any
import asyncio
import structlog
from datetime import datetime

from app.agents.streaming.event_types import (
    StreamEvent,
    StreamEventData,
    StreamEventType,
)

logger = structlog.get_logger()

# Type alias for question save callback
QuestionSaveCallback = Callable[[dict], Awaitable[bool]]


class SSEHandler:
    """
    Handler for Server-Sent Events streaming.

    Manages the event queue and provides methods for sending
    events to the client during question generation.
    """

    def __init__(
        self,
        session_id: str,
        on_question_complete: Optional[QuestionSaveCallback] = None,
    ):
        self.session_id = session_id
        self._queue: asyncio.Queue[StreamEventData] = asyncio.Queue(maxsize=1000)
        self._is_closed = False
        self._event_count = 0
        self._on_question_complete = on_question_complete

    async def send(self, event: StreamEventData) -> None:
        """Add an event to the stream queue"""
        if self._is_closed:
            logger.warning(
                "Attempted to send event on closed stream", session_id=self.session_id
            )
            return

        self._event_count += 1
        try:
            await asyncio.wait_for(self._queue.put(event), timeout=10.0)
        except asyncio.TimeoutError:
            logger.error(
                "SSE queue full, closing stream",
                session_id=self.session_id,
                queue_size=self._queue.qsize(),
            )
            self._is_closed = True
            return
        logger.debug(
            "Event queued",
            session_id=self.session_id,
            event_type=event.event_type.value,
            event_count=self._event_count,
        )

    async def send_thinking(self, step: str) -> None:
        """Send a minimal thinking step"""
        await self.send(StreamEvent.thinking(step))

    async def send_action(self, step: str) -> None:
        """Send an action notification"""
        await self.send(StreamEvent.action(step))

    async def send_chunk(
        self, question_id: str, content: str, question_number: int
    ) -> None:
        """Stream a content chunk"""
        await self.send(StreamEvent.chunk(question_id, content, question_number))

    async def send_question_complete(
        self, question_id: str, question_data: dict, score: float
    ) -> None:
        """Signal question completion and save to database if callback is set"""
        logger.info(
            "send_question_complete called",
            session_id=self.session_id,
            question_id=question_id,
            has_callback=self._on_question_complete is not None,
        )

        # Send SSE event to client
        await self.send(
            StreamEvent.question_complete(question_id, question_data, score)
        )

        # Save question to database via callback if provided
        if self._on_question_complete:
            try:
                logger.info(
                    "Invoking save callback",
                    session_id=self.session_id,
                    question_id=question_id,
                )
                result = await self._on_question_complete(question_data)
                logger.info(
                    "Question save callback completed",
                    session_id=self.session_id,
                    question_id=question_id,
                    result=result,
                )
            except Exception as e:
                logger.error(
                    "Failed to save question via callback",
                    session_id=self.session_id,
                    question_id=question_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                import traceback

                logger.error("Callback traceback", traceback=traceback.format_exc())
        else:
            logger.warning(
                "No save callback set",
                session_id=self.session_id,
                question_id=question_id,
            )

    async def send_source_found(self, source_id: str, title: str, excerpt: str) -> None:
        """Signal source discovery"""
        await self.send(StreamEvent.source_found(source_id, title, excerpt))

    async def send_error(self, message: str, code: str = "GENERATION_ERROR") -> None:
        """Send an error event"""
        await self.send(StreamEvent.error(message, code))
        self._is_closed = True

    async def send_done(self, questions_count: int) -> None:
        """Signal completion and close the stream"""
        await self.send(StreamEvent.done(self.session_id, questions_count))
        self._is_closed = True

    async def event_generator(self) -> AsyncGenerator[str, None]:
        """
        Generate SSE formatted events for FastAPI StreamingResponse.

        Yields:
            SSE formatted event strings
        """
        logger.info("Starting SSE stream", session_id=self.session_id)

        try:
            while not self._is_closed:
                try:
                    # Wait for next event with timeout
                    event = await asyncio.wait_for(
                        self._queue.get(),
                        timeout=30.0,  # Send keepalive every 30s
                    )

                    yield event.to_sse_format()

                    # Check if this was the final event
                    if event.event_type == StreamEventType.DONE:
                        break

                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ": keepalive\n\n"

        except asyncio.CancelledError:
            logger.info("SSE stream cancelled", session_id=self.session_id)
            raise
        except Exception as e:
            logger.error("SSE stream error", session_id=self.session_id, error=str(e))
            yield StreamEvent.error(str(e)).to_sse_format()
        finally:
            self._is_closed = True
            logger.info(
                "SSE stream closed",
                session_id=self.session_id,
                total_events=self._event_count,
            )

    def close(self) -> None:
        """Close the stream"""
        self._is_closed = True
