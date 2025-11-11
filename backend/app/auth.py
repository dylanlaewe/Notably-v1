# backend/app/auth.py
from __future__ import annotations
import os
import time
import typing as T
from dataclasses import dataclass
from pydantic import BaseModel

import httpx
from fastapi import Depends, HTTPException, Request
from jose import jwt

# ---- Config from env ----
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL") or (f"{SUPABASE_URL}/auth/v1/keys" if SUPABASE_URL else "")
SUPABASE_ISSUER = os.getenv("SUPABASE_ISSUER") or (f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else "")
SUPABASE_AUD = os.getenv("SUPABASE_JWT_AUD", "authenticated")

# Dev bypass (keeps local/simple flows working)
DEV_API_KEY = os.getenv("NOTABLY_API_KEY", "")
DEV_USER_ID = os.getenv("NOTABLY_DEV_USER_ID", "11111111-1111-1111-1111-111111111111")

# Small JWKS cache
_JWKS: dict | None = None
_JWKS_EXP: float = 0.0


@dataclass
class UserContext:
    user_id: str
    email: str
    is_dev_key: bool = False


async def _get_jwks() -> dict:
    global _JWKS, _JWKS_EXP
    now = time.time()
    if _JWKS and now < _JWKS_EXP:
        return _JWKS
    if not SUPABASE_JWKS_URL:
        raise HTTPException(status_code=500, detail="Auth misconfigured (no JWKS URL)")
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(SUPABASE_JWKS_URL)
        r.raise_for_status()
        _JWKS = r.json()
        _JWKS_EXP = now + 600  # 10 min cache
        return _JWKS


def _pick_key(jwks: dict, kid: str) -> dict | None:
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            return k
    return None


async def _verify_bearer(token: str) -> UserContext:
    try:
        header = jwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token header")

    jwks = await _get_jwks()
    key = _pick_key(jwks, header.get("kid"))
    if not key:
        raise HTTPException(status_code=401, detail="No matching JWKS key")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "RS256")],
            audience=SUPABASE_AUD,
            issuer=SUPABASE_ISSUER or None,
            options={"verify_aud": bool(SUPABASE_AUD)},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub")

    return UserContext(
        user_id=sub,
        email=claims.get("email"),
        is_dev_key=False,
    )


async def require_user(request: Request) -> UserContext:
    """
    Auth dependency:
      - If NOTABLY_API_KEY is set and matches X-Api-Key: accept as dev user.
      - Else require Authorization: Bearer <supabase-jwt> and verify via JWKS.
    """
    # Dev API key path:
    if DEV_API_KEY:
        key = request.headers.get("X-Api-Key")
        if key and key == DEV_API_KEY:
            return UserContext(
                user_id=DEV_USER_ID,           # <- guaranteed UUID
                email="dev@local",
                is_dev_key=True,
            )

    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    return await _verify_bearer(token)
