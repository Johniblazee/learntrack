"""
Database Migration Script for AI Enhancements
Creates collections for cost tracking and updates existing data
"""

import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

logger = structlog.get_logger()


async def create_cost_tracking_collections(db: AsyncIOMotorDatabase):
    """Create cost tracking collections with indexes"""

    # Cost tracking collection
    cost_collection = db.cost_tracking
    await cost_collection.create_index([("tenant_id", 1), ("timestamp", -1)])
    await cost_collection.create_index(
        [("tenant_id", 1), ("provider", 1), ("operation", 1)]
    )
    await cost_collection.create_index([("timestamp", -1)])

    # Cost quotas collection
    quota_collection = db.cost_quotas
    await quota_collection.create_index(
        [("tenant_id", 1), ("is_active", 1)], unique=True
    )
    await quota_collection.create_index([("tier", 1)])
    await quota_collection.create_index([("last_daily_reset", 1)])

    # Cost alerts collection
    alerts_collection = db.cost_alerts
    await alerts_collection.create_index([("tenant_id", 1), ("timestamp", -1)])
    await alerts_collection.create_index(
        [("tenant_id", 1), ("dismissed", 1), ("severity", 1)]
    )
    await alerts_collection.create_index([("timestamp", -1)])

    logger.info("Created cost tracking collections with indexes")


async def create_default_quotas(db: AsyncIOMotorDatabase):
    """Create default quotas for existing tenants"""

    # Get existing users to create quotas for
    users_collection = db.users
    users = await users_collection.find(
        {"role": {"$in": ["TUTOR", "STUDENT", "PARENT"]}}
    ).to_list(None)

    quota_collection = db.cost_quotas
    quotas_created = 0

    for user in users:
        tenant_id = str(user["_id"])

        # Check if quota already exists
        existing = await quota_collection.find_one({"tenant_id": tenant_id})
        if existing:
            continue

        # Determine tier based on role
        if user.get("role") == "TUTOR":
            tier = "pro"
            monthly_limit = Decimal("100.00")
            daily_limit = Decimal("10.00")
        else:
            tier = "free"
            monthly_limit = Decimal("10.00")
            daily_limit = Decimal("1.00")

        # Create default quota
        quota = {
            "tenant_id": tenant_id,
            "tier": tier,
            "monthly_limit": monthly_limit,
            "daily_limit": daily_limit,
            "alert_threshold": Decimal("0.8"),
            "current_monthly_usage": Decimal("0"),
            "current_daily_usage": Decimal("0"),
            "last_monthly_reset": datetime.now(timezone.utc),
            "last_daily_reset": datetime.now(timezone.utc),
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
            "updated_at": None,
        }

        await quota_collection.insert_one(quota)
        quotas_created += 1

    logger.info(f"Created default quotas for {quotas_created} tenants")


async def update_existing_files_with_cost_metadata(db: AsyncIOMotorDatabase):
    """Update existing files with cost tracking metadata"""

    files_collection = db.files
    files = await files_collection.find({"embedding_status": "completed"}).to_list(None)

    cost_collection = db.cost_tracking
    records_created = 0

    for file in files:
        tenant_id = str(file.get("tutor_id", file.get("uploaded_by")))
        file_id = str(file["_id"])

        # Estimate historical cost (simplified)
        token_estimate = file.get("token_estimate", 1000)
        chunk_count = file.get("chunk_count", 10)

        # Create historical cost record
        cost_record = {
            "tenant_id": tenant_id,
            "provider": "openai",  # Assume OpenAI for historical data
            "model": "text-embedding-3-small",
            "input_tokens": token_estimate,
            "output_tokens": 0,
            "input_cost": Decimal(
                str(token_estimate * 0.00000002)
            ),  # OpenAI small embedding cost
            "output_cost": Decimal("0"),
            "total_cost": Decimal(str(token_estimate * 0.00000002)),
            "operation": "document_embedding",
            "timestamp": file.get(
                "last_embedded_at", file.get("created_at", datetime.now(timezone.utc))
            ),
            "metadata": {
                "file_id": file_id,
                "chunks": chunk_count,
                "processor_used": file.get("processor_used", "unknown"),
                "historical": True,
            },
        }

        await cost_collection.insert_one(cost_record)
        records_created += 1

    logger.info(f"Created {records_created} historical cost records")


async def create_migration_log(db: AsyncIOMotorDatabase):
    """Log migration completion"""

    migration_collection = db.migrations
    migration_record = {
        "name": "ai_enhancements_v1",
        "version": "1.0.0",
        "description": "Add cost tracking, semantic chunking, and local embeddings",
        "executed_at": datetime.now(timezone.utc),
        "status": "completed",
        "collections_created": ["cost_tracking", "cost_quotas", "cost_alerts"],
        "indexes_created": [
            "cost_tracking: tenant_id+timestamp",
            "cost_tracking: tenant_id+provider+operation",
            "cost_quotas: tenant_id+is_active",
            "cost_alerts: tenant_id+timestamp",
        ],
    }

    await migration_collection.insert_one(migration_record)
    logger.info("Migration logged successfully")


async def run_migration(db: AsyncIOMotorDatabase):
    """Run complete migration"""

    logger.info("Starting AI enhancements database migration")

    try:
        # Step 1: Create collections and indexes
        await create_cost_tracking_collections(db)

        # Step 2: Create default quotas for existing tenants
        await create_default_quotas(db)

        # Step 3: Update existing files with cost metadata
        await update_existing_files_with_cost_metadata(db)

        # Step 4: Log migration completion
        await create_migration_log(db)

        logger.info("AI enhancements migration completed successfully")

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        raise


# Standalone execution
async def main():
    """Run migration standalone"""
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import settings

    # Connect to database
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.DATABASE_NAME]

    try:
        await run_migration(db)
        print("✅ Migration completed successfully")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
