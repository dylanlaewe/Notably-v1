from typing import Optional
from uuid import UUID
from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import get_settings
from backend.app.db import get_session
from backend.app.auth.jwt_verifier import verify_and_decode
from backend.app.auth.types import UserContext


async def require_user(
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-Api-Key"),
    db: AsyncSession = Depends(get_session),  # kept for later
) -> UserContext:
    s = get_settings()

    # --- DEV KEY PATH (no DB calls) ---
    if s.DEV_MODE and s.DEV_API_KEY and s.NOTABLY_DEV_USER_ID and x_api_key == s.DEV_API_KEY:
        try:
            dev_uuid = UUID(str(s.NOTABLY_DEV_USER_ID))
        except Exception:
            raise HTTPException(status_code=500, detail="bad_dev_user_id_config")

        # Return a valid context without touching models
        return UserContext(
            sub=f"dev:{dev_uuid}",
            email="dev@local",
            name="Dev User",
            user_id=dev_uuid,   # use the env-provided UUID
            is_dev=True,
        )

    # --- JWT PATH (no DB calls yet) ---
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

    # We'll fill user_id after we wire provisioning to your actual models
    return UserContext(sub=sub, email=email, name=name, user_id=None, is_dev=False)

