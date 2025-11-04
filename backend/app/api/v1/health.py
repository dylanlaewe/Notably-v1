from __future__ import annotations

import os
import time
from typing import Dict, Any

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from ...db import SessionLocal

router = APIRouter(prefix="/v1", tags=["health"])

# Optional deps
try:
    import redis  
except Exception:
    redis = None

try:
    from ...storage import get_minio_client
except Exception:
    get_minio_client = None


@router.get("/_health")
def health() -> Dict[str, Any]:
    out: Dict[str, Any] = {}

    # DB
    t0 = time.monotonic()
    db_ok = False
    db_err = None
    try:
        s = SessionLocal()
        try:
            s.execute(text("select 1"))
            db_ok = True
        finally:
            s.close()
    except SQLAlchemyError as e:
        db_err = str(e)
    out["db"] = {"ok": db_ok, "latency_ms": int((time.monotonic()-t0)*1000), "error": db_err}

    # Redis
    t0 = time.monotonic()
    r_ok = None
    r_err = None
    url = os.getenv("RQ_REDIS_URL") or os.getenv("REDIS_URL")
    if redis and url:
        try:
            r = redis.from_url(url)
            r.ping()
            r_ok = True
        except Exception as e:
            r_ok = False
            r_err = str(e)
    out["redis"] = {"ok": r_ok, "latency_ms": int((time.monotonic()-t0)*1000), "url_present": bool(url), "error": r_err}

    # MinIO
    t0 = time.monotonic()
    m_enabled = os.getenv("MINIO_ENABLE", "false").lower() in {"1", "true", "yes", "y"}
    m_ok = None
    m_err = None
    if m_enabled and get_minio_client:
        try:
            client = get_minio_client()
            # list_buckets is a cheap permission check
            client.list_buckets()
            m_ok = True
        except Exception as e:
            m_ok = False
            m_err = str(e)
    out["minio"] = {"enabled": m_enabled, "ok": m_ok, "latency_ms": int((time.monotonic()-t0)*1000), "error": m_err}

    out["ok"] = bool(out["db"]["ok"]) and (out["redis"]["ok"] in (True, None)) and (out["minio"]["ok"] in (True, None))
    return out
