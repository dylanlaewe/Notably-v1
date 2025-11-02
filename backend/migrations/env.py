from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from dotenv import load_dotenv
load_dotenv()


from alembic import context
from sqlalchemy import engine_from_config, pool

# Add repo root to sys.path so we can import backend.app.*
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

# Import your app metadata
from backend.app.db import Base  # SQLAlchemy Declarative Base
import backend.app.models  # noqa: F401  (register models)

# this is the Alembic Config object, which provides access to values within the .ini file in use.
config = context.config
db_url = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
config.set_main_option("sqlalchemy.url", db_url)

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for 'autogenerate'
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_as_batch=True,  # helpful for SQLite
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=True,  # helpful for SQLite
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
