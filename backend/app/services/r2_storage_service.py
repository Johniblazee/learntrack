"""
Cloudflare R2 storage service using S3-compatible API via boto3.
"""

import io
from typing import Optional

import boto3
import structlog
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import settings

logger = structlog.get_logger()

_r2_client = None


def get_r2_client():
    """Get or create the singleton R2 (S3-compatible) client."""
    global _r2_client
    if _r2_client is None:
        if not settings.R2_ENDPOINT_URL:
            logger.warning("R2_ENDPOINT_URL not configured, R2 storage unavailable")
            return None
        _r2_client = boto3.client(
            service_name="s3",
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=BotoConfig(
                retries={"max_attempts": 3, "mode": "standard"},
                signature_version="s3v4",
            ),
        )
    return _r2_client


async def upload_file(
    content: bytes,
    key: str,
    content_type: str = "application/octet-stream",
) -> str:
    """
    Upload file content to R2.

    Args:
        content: File bytes
        key: Object key (e.g. "clerk_id/uuid.pdf")
        content_type: MIME type

    Returns:
        The object key (use generate_presigned_url to get a download URL)
    """
    client = get_r2_client()
    if client is None:
        raise RuntimeError("R2 storage is not configured")

    try:
        client.upload_fileobj(
            Fileobj=io.BytesIO(content),
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )
        logger.info("Uploaded file to R2", key=key, size=len(content))
        return key
    except ClientError as e:
        logger.error("Failed to upload file to R2", key=key, error=str(e))
        raise


async def download_file(key: str) -> bytes:
    """
    Download file content from R2.

    Args:
        key: Object key

    Returns:
        File bytes
    """
    client = get_r2_client()
    if client is None:
        raise RuntimeError("R2 storage is not configured")

    try:
        response = client.get_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
        content = response["Body"].read()
        logger.info("Downloaded file from R2", key=key, size=len(content))
        return content
    except ClientError as e:
        logger.error("Failed to download file from R2", key=key, error=str(e))
        raise


async def delete_file(key: str) -> bool:
    """
    Delete a file from R2.

    Args:
        key: Object key

    Returns:
        True if deleted successfully
    """
    client = get_r2_client()
    if client is None:
        raise RuntimeError("R2 storage is not configured")

    try:
        client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
        logger.info("Deleted file from R2", key=key)
        return True
    except ClientError as e:
        logger.error("Failed to delete file from R2", key=key, error=str(e))
        return False


def generate_presigned_url(key: str, expires_in: int = 3600) -> Optional[str]:
    """
    Generate a presigned URL for downloading a file.

    Args:
        key: Object key
        expires_in: URL expiry in seconds (default 1 hour)

    Returns:
        Presigned URL string, or None if R2 is not configured
    """
    client = get_r2_client()
    if client is None:
        return None

    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET_NAME, "Key": key},
            ExpiresIn=expires_in,
        )
        return url
    except ClientError as e:
        logger.error("Failed to generate presigned URL", key=key, error=str(e))
        return None


def close_r2_client():
    """Close the R2 client and release resources."""
    global _r2_client
    if _r2_client is not None:
        _r2_client.close()
        _r2_client = None
        logger.info("R2 client closed")
