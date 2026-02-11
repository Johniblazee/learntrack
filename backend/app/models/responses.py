"""Common response models for API documentation."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Health check response model."""

    status: str = Field(..., description="Service health status")
    service: str = Field(..., description="Service name")
    version: Optional[str] = Field(None, description="API version")
    timestamp: Optional[str] = Field(None, description="Response timestamp")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "healthy",
                "service": "learntrack-api",
                "version": "1.0.0",
                "timestamp": "2024-01-15T10:30:00Z",
            }
        }
    )
