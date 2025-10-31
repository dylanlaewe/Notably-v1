from __future__ import annotations

import os
from redis import Redis
from rq import Queue

# Config via env; sane dev defaults
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RQ_QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "notably")
RQ_DEFAULT_TIMEOUT = int(os.getenv("RQ_DEFAULT_TIMEOUT", "600"))  # seconds

def get_connection() -> Redis:
    return Redis.from_url(REDIS_URL)

def get_queue() -> Queue:
    return Queue(RQ_QUEUE_NAME, connection=get_connection(), default_timeout=RQ_DEFAULT_TIMEOUT)
