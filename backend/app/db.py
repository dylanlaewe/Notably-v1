from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# SQLite dev DB file in project root
SQLALCHEMY_DATABASE_URL = "sqlite:///./dev.db"

# check_same_thread=False lets us use the connection across threads in dev
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)

class Base(DeclarativeBase):
    """All ORM models will subclass this."""
    pass

def init_db() -> None:
    """
    Create tables for all models that import Base.
    (We'll call this on startup after models are imported.)
    """
    from . import models  # noqa: F401  (ensures models are registered)
    Base.metadata.create_all(bind=engine)

def get_session():
    """
    FastAPI dependency helper (generator).
    We'll use this later inside route handlers.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

