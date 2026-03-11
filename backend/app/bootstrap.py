"""Manual startup bootstrap tasks for MongoDB schema work."""

import asyncio

import structlog

from app.core.database import database
from app.core.migrations import get_migration_runner

logger = structlog.get_logger()


async def run_bootstrap_tasks(db_ref=None):
    """Run indexes, migrations, and audit-log maintenance tasks."""
    db = db_ref or await database.ensure_connected()

    await database.ensure_connected()
    await database.ensure_indexes()

    migration_runner = get_migration_runner(db)
    migration_results = await migration_runner.migrate()
    logger.info("Database migrations checked", **migration_results)

    from app.services.audit_log_service import AuditLogService

    audit_service = AuditLogService(db)
    await audit_service.setup_ttl_index()
    logger.info("Audit log TTL index checked")

    return migration_results


async def _main_async():
    try:
        await database.init_client()
        await run_bootstrap_tasks(database.database)
    finally:
        await database.close_database_connection()


def main():
    asyncio.run(_main_async())


if __name__ == "__main__":
    main()
