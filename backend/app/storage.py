from __future__ import annotations

import os
from typing import Optional
from minio import Minio

# Defaults are dev-friendly; can be overridden by env vars
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "notably-uploads")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"


def get_client() -> Minio:
    """Create a MinIO client with env-configured credentials."""
    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE,
    )


def ensure_bucket(client: Minio, bucket: Optional[str] = None) -> str:
    """Create the uploads bucket if it doesn't exist (idempotent)."""
    b = bucket or MINIO_BUCKET
    found = client.bucket_exists(b)
    if not found:
        client.make_bucket(b)
    return b


def make_object_key(meeting_id: str, upload_id: str, filename: str) -> str:
    """
    Deterministic object path for an upload.
    (Team prefix can be added later without breaking callers.)
    """
    safe_name = filename or "upload.bin"
    return f"meetings/{meeting_id}/uploads/{upload_id}/{safe_name}"
