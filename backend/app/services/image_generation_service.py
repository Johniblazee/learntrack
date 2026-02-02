"""
Image generation service using Google Gemini API (nano banana model)
"""

import structlog
from typing import Optional
import google.generativeai as genai
import base64

from app.core.config import settings
from app.prompts.group_image_prompts import get_prompt_for_group, get_prompt_version

logger = structlog.get_logger()

# Gemini Model Configuration
GEMINI_MODEL = (
    "gemini-2.0-flash-exp-image-generation"  # nano banana model for image generation
)
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024


class GeminiImageGenerationService:
    """Service for generating images using Google's Gemini API with nano banana model"""

    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self._initialized = False
        self.model = None

    def _ensure_initialized(self):
        """Initialize the Gemini client if not already done"""
        if not self._initialized:
            if not self.api_key:
                logger.error("GEMINI_API_KEY not configured")
                raise ValueError("GEMINI_API_KEY environment variable must be set")

            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel(GEMINI_MODEL)
            self._initialized = True
            logger.info(
                "Gemini image generation service initialized",
                model=GEMINI_MODEL,
                prompt_version=get_prompt_version(),
            )

    async def generate_group_cover_image(
        self, group_name: str, description: str = ""
    ) -> Optional[str]:
        """
        Generate a cover image for a student group using Gemini nano banana model.

        Args:
            group_name: Name of the group
            description: Optional description to help guide image generation

        Returns:
            Base64-encoded image data URL, or None if generation fails
        """
        try:
            self._ensure_initialized()

            if self.model is None:
                raise RuntimeError("Gemini model not initialized")

            model = self.model  # type: ignore

            # Get the prompt from the prompts module (versioned)
            prompt_text = get_prompt_for_group(group_name, description)

            logger.info(
                "Generating group cover image with Gemini",
                group_name=group_name,
                model=GEMINI_MODEL,
                prompt_version=get_prompt_version().get("version"),
                prompt_preview=prompt_text[:60],
            )

            # Generate image
            response = model.generate_content(prompt_text)

            # Extract image from response
            image_data = None
            for part in response.parts:
                if hasattr(part, "text") and part.text is not None:
                    logger.debug("Gemini response text", text=part.text[:100])
                elif hasattr(part, "inline_data") and part.inline_data is not None:
                    image_data = part.inline_data.data
                    logger.debug(
                        "Received image data from Gemini",
                        data_size=len(image_data) if image_data else 0,
                    )

            if not image_data:
                logger.error("No image data received from Gemini")
                return None

            # Convert to base64 data URL
            mime_type = "image/png"  # Gemini typically returns PNG
            base64_image = base64.b64encode(image_data).decode("utf-8")
            data_url = f"data:{mime_type};base64,{base64_image}"

            logger.info(
                "Successfully generated group cover image",
                group_name=group_name,
                image_size=len(image_data),
                prompt_version=get_prompt_version().get("version"),
            )

            return data_url

        except Exception as e:
            logger.error(
                "Failed to generate group image with Gemini",
                error=str(e),
                group_name=group_name,
                model=GEMINI_MODEL,
            )
            return None

    async def regenerate_image(
        self, group_name: str, description: str = ""
    ) -> Optional[str]:
        """Regenerate an image with a fresh seed for variety"""
        return await self.generate_group_cover_image(group_name, description)


# Singleton instance
_image_service: Optional[GeminiImageGenerationService] = None


def get_image_service() -> GeminiImageGenerationService:
    """Get or create the singleton image generation service"""
    global _image_service
    if _image_service is None:
        _image_service = GeminiImageGenerationService()
    return _image_service


# Convenience function for backward compatibility
async def generate_group_image(
    group_name: str,
    description: str = "",
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
) -> Optional[str]:
    """
    Generate a cover image for a student group.

    Args:
        group_name: Name of the group
        description: Optional description to help guide image generation
        width: Image width (ignored - Gemini controls dimensions)
        height: Image height (ignored - Gemini controls dimensions)

    Returns:
        Base64 data URL of the generated image, or None if generation fails
    """
    service = get_image_service()
    return await service.generate_group_cover_image(group_name, description)


# Export prompt utilities for use in other modules
__all__ = [
    "GeminiImageGenerationService",
    "get_image_service",
    "generate_group_image",
    "get_prompt_for_group",
    "get_prompt_version",
]
