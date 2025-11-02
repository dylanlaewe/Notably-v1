from dotenv import load_dotenv
load_dotenv()

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")

IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if IS_SQLITE else {}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

class Base(DeclarativeBase):
    pass

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


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

