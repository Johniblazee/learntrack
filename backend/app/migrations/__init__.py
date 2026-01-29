"""
Migrations Module

This module bridges the migration runner (app.core.migrations) with the
migration files in the top-level migrations/ directory.

Provides a get_all_migrations() function that returns Migration objects
for the MigrationRunner to use.
"""
from typing import List
from app.core.migrations import Migration

# Import using importlib to handle numeric prefix in module name
import importlib.util
import os

def _load_migration_module(filename: str):
    """Load a migration module by filename."""
    migrations_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    migrations_path = os.path.join(migrations_dir, "migrations", filename)
    spec = importlib.util.spec_from_file_location(filename.replace(".py", ""), migrations_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# Load migration modules
_migration_001 = _load_migration_module("001_ai_enhancements.py")


def get_all_migrations() -> List[Migration]:
    """
    Get all registered migrations.
    
    Returns:
        List of Migration objects in version order.
    """
    migrations = [
        Migration(
            version="001",
            name="ai_enhancements",
            description="Add cost tracking, semantic chunking, and local embeddings collections",
            up=_migration_001.run_migration,
            down=None  # No rollback defined for this migration
        ),
    ]

    return migrations

