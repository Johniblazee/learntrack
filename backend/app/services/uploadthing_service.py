"""
UploadThing File Storage Service
Replaces local file storage with cloud-based UploadThing integration
"""

import os
import httpx
from typing import Optional, Dict, Any, BinaryIO, List
from pathlib import Path
import structlog

from app.core.config import settings

logger = structlog.get_logger()


class UploadThingService:
    """
    UploadThing file storage service
    Handles file uploads, deletions, and metadata management
    """

    def __init__(self):
        self.app_id = settings.UPLOADTHING_APP_ID
        self.secret = settings.UPLOADTHING_SECRET
        self.base_url = "https://uploadthing.com"

        if not self.app_id or not self.secret:
            logger.warning(
                "UploadThing configuration missing",
                app_id=bool(self.app_id),
                secret=bool(self.secret),
            )

        logger.info(
            "Initialized UploadThing service",
            app_id=self.app_id,
        )

    async def upload_file(
        self,
        file_content: bytes,
        filename: str,
        content_type: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Upload a file to UploadThing

        Args:
            file_content: File bytes to upload
            filename: Original filename
            content_type: MIME type of the file
            metadata: Additional metadata for the file

        Returns:
            Dictionary containing file URL and metadata
        """
        if not self.app_id or not self.secret:
            raise ValueError("UploadThing configuration missing")

        try:
            # Get upload URL from UploadThing
            upload_data = await self._get_upload_url(filename, content_type, metadata)

            if not upload_data.get("presignedUrl"):
                raise Exception("Failed to get upload URL")

            # Upload file to presigned URL
            upload_response = await self._upload_to_presigned_url(
                upload_data["presignedUrl"], file_content, content_type
            )

            if not upload_response:
                raise Exception("Failed to upload file")

            result = {
                "url": upload_data.get("fileUrl"),
                "key": upload_data.get("key"),
                "filename": filename,
                "size": len(file_content),
                "content_type": content_type,
                "metadata": metadata or {},
            }

            logger.info(
                "Successfully uploaded file",
                filename=filename,
                url=result["url"],
                size=len(file_content),
            )

            return result

        except Exception as e:
            logger.error(
                "Failed to upload file",
                error=str(e),
                filename=filename,
            )
            raise

    async def _get_upload_url(
        self,
        filename: str,
        content_type: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Get presigned upload URL from UploadThing"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/api/uploadFiles",
                    headers={
                        "Authorization": f"Bearer {self.secret}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "files": [
                            {
                                "name": filename,
                                "type": content_type,
                                "size": len(filename),  # Will be updated after upload
                                "customId": filename,
                                "metadata": metadata or {},
                            }
                        ],
                        "metadata": metadata or {},
                    },
                )
                response.raise_for_status()
                return response.json()

        except Exception as e:
            logger.error(
                "Failed to get upload URL",
                error=str(e),
                filename=filename,
            )
            raise

    async def _upload_to_presigned_url(
        self, presigned_url: str, file_content: bytes, content_type: str
    ) -> bool:
        """Upload file to presigned URL"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.put(
                    presigned_url,
                    content=file_content,
                    headers={
                        "Content-Type": content_type,
                        "Content-Length": str(len(file_content)),
                    },
                )
                response.raise_for_status()
                return True

        except Exception as e:
            logger.error(
                "Failed to upload to presigned URL",
                error=str(e),
                url=presigned_url[:100],  # Log first 100 chars
            )
            return False

    async def delete_file(self, file_key: str) -> bool:
        """
        Delete a file from UploadThing

        Args:
            file_key: The key of the file to delete

        Returns:
            True if successful, False otherwise
        """
        if not self.app_id or not self.secret:
            raise ValueError("UploadThing configuration missing")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.delete(
                    f"{self.base_url}/api/deleteFile/{file_key}",
                    headers={
                        "Authorization": f"Bearer {self.secret}",
                    },
                )
                response.raise_for_status()

                logger.info(
                    "Successfully deleted file",
                    file_key=file_key,
                )

                return True

        except Exception as e:
            logger.error(
                "Failed to delete file",
                error=str(e),
                file_key=file_key,
            )
            return False

    async def get_file_info(self, file_key: str) -> Optional[Dict[str, Any]]:
        """Get information about a file"""
        if not self.app_id or not self.secret:
            raise ValueError("UploadThing configuration missing")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/file/{file_key}",
                    headers={
                        "Authorization": f"Bearer {self.secret}",
                    },
                )
                response.raise_for_status()
                return response.json()

        except Exception as e:
            logger.error(
                "Failed to get file info",
                error=str(e),
                file_key=file_key,
            )
            return None

    async def list_files(
        self, limit: int = 100, offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List uploaded files"""
        if not self.app_id or not self.secret:
            raise ValueError("UploadThing configuration missing")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/api/files",
                    headers={
                        "Authorization": f"Bearer {self.secret}",
                    },
                    params={
                        "limit": limit,
                        "offset": offset,
                    },
                )
                response.raise_for_status()
                return response.json().get("files", [])

        except Exception as e:
            logger.error(
                "Failed to list files",
                error=str(e),
            )
            return []

    def is_configured(self) -> bool:
        """Check if UploadThing is properly configured"""
        return bool(self.app_id and self.secret)

    def get_public_url(self, file_key: str) -> str:
        """Get public URL for a file"""
        return f"https://utfs.io/f/{self.app_id}/{file_key}"


# Global instance for convenience
_default_uploadthing_service = None


def get_uploadthing_service() -> UploadThingService:
    """Get or create default UploadThing service"""
    global _default_uploadthing_service
    if _default_uploadthing_service is None:
        _default_uploadthing_service = UploadThingService()
    return _default_uploadthing_service


def create_uploadthing_service() -> UploadThingService:
    """Create a new UploadThing service instance"""
    return UploadThingService()


# Convenience functions
async def upload_file(
    file_content: bytes,
    filename: str,
    content_type: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Upload file using default service"""
    service = get_uploadthing_service()
    return await service.upload_file(file_content, filename, content_type, metadata)


async def delete_file(file_key: str) -> bool:
    """Delete file using default service"""
    service = get_uploadthing_service()
    return await service.delete_file(file_key)
