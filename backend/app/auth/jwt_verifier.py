# backend/app/auth/jwt_verifier.py
from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict
import json
import os
from urllib.request import urlopen

from jose import jwt, JWTError, ExpiredSignatureError

from backend.app.config import get_settings


@lru_cache(maxsize=4)
def _fetch_jwks(jwks_url: str) -> dict[str, Any]:
    with urlopen(jwks_url, timeout=5) as response:
        return json.load(response)


def _decode_with_jwks(token: str, alg: str, kid: str, jwks_url: str, audience: str | None, issuer: str | None) -> Dict[str, Any]:
    jwks = _fetch_jwks(jwks_url)
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=audience,
                issuer=issuer,
            )
    raise JWTError("matching_jwk_not_found")


def _decode_with_shared_secret(token: str, audience: str | None, issuer: str | None) -> Dict[str, Any]:
    secret = (
        os.getenv("JWT_SECRET")
        or os.getenv("SUPABASE_JWT_SECRET")
    )
    if not secret:
        raise RuntimeError("JWT_SECRET/SUPABASE_JWT_SECRET not configured")

    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience=audience,
        issuer=issuer,
    )


async def verify_and_decode(token: str) -> Dict[str, Any]:
    """
    Verify Supabase-issued JWTs.

    Supports:
    - Modern asymmetric Supabase tokens (ES256/RS256) via JWKS
    - Legacy HS256 tokens via JWT_SECRET / SUPABASE_JWT_SECRET
    """
    s = get_settings()
    header = jwt.get_unverified_header(token)
    alg = header.get("alg")
    kid = header.get("kid")

    try:
        if alg in {"ES256", "RS256"} and kid and s.JWKS_URL:
            return _decode_with_jwks(
                token=token,
                alg=alg,
                kid=kid,
                jwks_url=s.JWKS_URL,
                audience=s.JWT_AUDIENCE,
                issuer=s.JWT_ISSUER,
            )

        return _decode_with_shared_secret(
            token=token,
            audience=s.JWT_AUDIENCE,
            issuer=s.JWT_ISSUER,
        )
    except (ExpiredSignatureError, JWTError):
        raise
