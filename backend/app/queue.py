from __future__ import annotations

import os
from redis import Redis
from rq import Queue

def rq_enabled() -> bool:
    return os.getenv("RQ_ENABLE", "true").lower() in {"1", "true", "yes", "y"}

# Back-compat for callers importing a constant
RQ_ENABLE = rq_enabled()

def get_queue(name: str = "notably") -> Queue:
    r = Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        db=int(os.getenv("REDIS_DB", "0")),
    )
    return Queue(name, connection=r)

# Config via env; sane dev defaults
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RQ_QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "notably")
RQ_DEFAULT_TIMEOUT = int(os.getenv("RQ_DEFAULT_TIMEOUT", "600"))  # seconds

def get_connection() -> Redis:
    return Redis.from_url(REDIS_URL)

def get_queue() -> Queue:
    return Queue(RQ_QUEUE_NAME, connection=get_connection(), default_timeout=RQ_DEFAULT_TIMEOUT)
