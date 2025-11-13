# backend/app/auth/jwt_verifier.py
from __future__ import annotations

from typing import Any, Dict
import os

from jose import jwt, JWTError, ExpiredSignatureError

from backend.app.config import get_settings


async def verify_and_decode(token: str) -> Dict[str, Any]:
    """
    Verifies an HS256 JWT (e.g. Supabase) using a shared secret.

    - Signature is checked with JWT_SECRET / SUPABASE_JWT_SECRET.
    - exp / nbf / iss / aud are validated using config.
    - Returns the decoded claims dict on success.
    - Raises jose.* errors on failure.
    """
    s = get_settings()

    # Prefer config, but fall back directly to env for safety.
    secret = (
        getattr(s, "JWT_SECRET", None)
        or os.getenv("JWT_SECRET")
        or os.getenv("SUPABASE_JWT_SECRET")
    )
    if not secret:
        raise RuntimeError("JWT_SECRET/SUPABASE_JWT_SECRET not configured")

    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=s.JWT_AUDIENCE,
            issuer=s.JWT_ISSUER,
            # no leeway kwarg here for python-jose
        )
    except (ExpiredSignatureError, JWTError) as e:
        # Let the caller map this to HTTP 401 with "invalid_token"
        raise e

    return claims
