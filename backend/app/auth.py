# backend/app/auth.py
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request, status

# Try to import the correct library (python-jose). If not available, defer use.
try:
    # pip package name: python-jose ; import path: from jose import jwt
    from jose import jwt as _jwt  # type: ignore
except Exception:
    _jwt = None  # Lazy fail if/when JWT path is actually used


@dataclass
class UserContext:
    user_id: str


def _dev_user_from_api_key(request: Request) -> Optional[UserContext]:
    """If X-Api-Key matches NOTABLY_DEV_API_KEY, return a fixed dev user."""
    dev_key = os.getenv("NOTABLY_DEV_API_KEY")
    if not dev_key:
        return None
    sent = request.headers.get("X-Api-Key")
    if sent and sent == dev_key:
        user_id = os.getenv(
            "NOTABLY_DEV_USER_ID",
            "11111111-1111-1111-1111-111111111111",  # stable UUID for local/dev/tests
        )
        return UserContext(user_id=user_id)
    return None


def _user_from_bearer(request: Request) -> Optional[UserContext]:
    """
    Minimal JWT path for future real auth.
    Uses HS256 with JWT_SECRET for now; extend to JWK/OIDC later.
    """
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None

    token = auth.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Empty bearer token")

    if _jwt is None:
        # JWT library not installed/configured on this server
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer not supported on this server",
            headers={"WWW-Authenticate": 'Bearer realm="notably"'},
        )

    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="JWT not configured")

    try:
        payload = _jwt.decode(token, secret, algorithms=["HS256"], options={"verify_aud": False})
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    sub = (payload or {}).get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="JWT missing subject")
    return UserContext(user_id=str(sub))


def require_user(request: Request) -> UserContext:
    """
    FastAPI dependency used by endpoints.
    Prefers dev API key; falls back to Bearer JWT if present.
    """
    dev = _dev_user_from_api_key(request)
    if dev:
        return dev

    bearer = _user_from_bearer(request)
    if bearer:
        return bearer

    # Neither header matched -> 401
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized",
        headers={"WWW-Authenticate": 'Bearer realm="notably"'},
    )
