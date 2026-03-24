"""
Enable tenant BYOK for existing AI configuration documents.
"""

import asyncio
from datetime import datetime, timezone

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = structlog.get_logger()


async def run_migration(db: AsyncIOMotorDatabase):
    """Turn on allow_custom_api_keys for existing tenant AI configs."""
    result = await db.tenant_ai_configurations.update_many(
        {
            "$or": [
                {"allow_custom_api_keys": {"$exists": False}},
                {"allow_custom_api_keys": False},
            ]
        },
        {
            "$set": {
                "allow_custom_api_keys": True,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    logger.info(
        "Enabled tenant BYOK for existing configs",
        matched_count=result.matched_count,
        modified_count=result.modified_count,
    )


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.core.config import settings

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.DATABASE_NAME]

    try:
        await run_migration(db)
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
