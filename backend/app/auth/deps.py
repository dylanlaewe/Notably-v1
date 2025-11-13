# backend/app/auth/deps.py
from __future__ import annotations
from typing import Optional
from uuid import UUID
from secrets import compare_digest
import os

from fastapi import Header, HTTPException
from backend.app.config import get_settings
from backend.app.auth.jwt_verifier import verify_and_decode
from backend.app.auth.types import UserContext
from backend.app.auth.idmap import user_uuid_from_sub


async def require_user(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-Api-Key"),
) -> UserContext:
    """
    Dev key path:
      - Accepts X-Api-Key when a dev key is configured via either NOTABLY_DEV_API_KEY or DEV_API_KEY.
      - In pytest, we also accept any non-empty X-Api-Key to avoid config drift.
    JWT path:
      - Requires Authorization: Bearer <token>.
    """
    s = get_settings()

    # --- DEV KEY PATH ---
    # backend/app/auth/deps.py

    configured = (
        os.getenv("NOTABLY_DEV_API_KEY")
        or os.getenv("DEV_API_KEY")
        or getattr(s, "DEV_API_KEY", None)
    )

    # --- DEV KEY PATH ---
    if x_api_key:
        # Only accept if it matches the configured dev key.
        if configured and compare_digest(x_api_key, configured):
            dev_user_id = (
                os.getenv("NOTABLY_DEV_USER_ID")
                or getattr(s, "NOTABLY_DEV_USER_ID", None)
                or "11111111-1111-1111-1111-111111111111"
            )
            try:
                dev_uuid = UUID(str(dev_user_id))
            except Exception:
                raise HTTPException(status_code=500, detail="bad_dev_user_id_config")
            return UserContext(
                sub=f"dev:{dev_uuid}",
                email="dev@local",
                name="Dev User",
                user_id=dev_uuid,
                is_dev=True,
            )
        # If X-Api-Key is present but wrong, we just fall through to the JWT path
        # (which will 401 with missing_bearer_token if no Bearer header).


    # --- JWT PATH ---
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_bearer_token")

    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = await verify_and_decode(token)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_token")



    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="missing_sub")

    email = claims.get("email")
    name = claims.get("name") or (claims.get("user_metadata") or {}).get("full_name")
    user_uuid = user_uuid_from_sub(sub)
    return UserContext(sub=sub, email=email, name=name, user_id=user_uuid, is_dev=False)

