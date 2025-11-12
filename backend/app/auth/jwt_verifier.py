# backend/app/auth/jwt_verifier.py
from __future__ import annotations
import time
from typing import Any, Dict, Optional
import httpx
from jose import jwk, jwt
from jose.utils import base64url_decode

from backend.app.config import get_settings

class _JWKSCache:
    def __init__(self) -> None:
        self._jwks: Optional[Dict[str, Any]] = None
        self._fetched_at: float = 0.0
        self._ttl_seconds: int = 6 * 60 * 60  # 6 hours

    async def get(self) -> Dict[str, Any]:
        s = get_settings()
        if not s.JWKS_URL:
            raise RuntimeError("JWKS_URL not configured")
        now = time.time()
        if self._jwks and (now - self._fetched_at) < self._ttl_seconds:
            return self._jwks
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(s.JWKS_URL)
            resp.raise_for_status()
            self._jwks = resp.json()
            self._fetched_at = now
            return self._jwks

_jwks_cache = _JWKSCache()

def _validate_standard_claims(claims: Dict[str, Any]) -> None:
    s = get_settings()
    now = int(time.time())
    leeway = int(getattr(s, "JWT_LEEWAY_SECONDS", 60))

    # exp
    exp = claims.get("exp")
    if exp is not None and now > int(exp) + leeway:
        raise jwt.ExpiredSignatureError("token_expired")

    # nbf
    nbf = claims.get("nbf")
    if nbf is not None and now + leeway < int(nbf):
        raise jwt.JWTClaimsError("token_not_yet_valid")

    # iss
    if s.JWT_ISSUER:
        iss = claims.get("iss")
        if iss != s.JWT_ISSUER:
            raise jwt.JWTClaimsError("bad_issuer")

    # aud
    if s.JWT_AUDIENCE:
        aud = claims.get("aud")
        if isinstance(aud, str):
            ok = (aud == s.JWT_AUDIENCE)
        elif isinstance(aud, list):
            ok = (s.JWT_AUDIENCE in aud)
        else:
            ok = False
        if not ok:
            raise jwt.JWTClaimsError("bad_audience")

async def verify_and_decode(token: str) -> Dict[str, Any]:
    """
    Verifies an RS256 JWT against the configured JWKS. Returns decoded claims.
    Raises jose.* errors on failure.
    """
    s = get_settings()
    if not (s.JWT_ISSUER and s.JWKS_URL):
        raise RuntimeError("JWT_ISSUER/JWKS_URL not configured")

    # 1) Get unverified header to pick key by kid
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    if not kid:
        raise jwt.JWTError("missing_kid")

    # 2) Fetch JWKS and select the matching key
    jwks = await _jwks_cache.get()
    keys = jwks.get("keys", [])
    key_data = next((k for k in keys if k.get("kid") == kid), None)
    if key_data is None:
        # Refresh once in case of rotation
        _jwks_cache._jwks = None
        jwks = await _jwks_cache.get()
        keys = jwks.get("keys", [])
        key_data = next((k for k in keys if k.get("kid") == kid), None)
        if key_data is None:
            raise jwt.JWTError("unknown_kid")

    # 3) Verify signature manually (RS256)
    public_key = jwk.construct(key_data, algorithm="RS256")
    try:
        signing_input, encoded_sig = token.rsplit(".", 1)
    except ValueError:
        raise jwt.JWTError("malformed_token")

    decoded_sig = base64url_decode(encoded_sig.encode("utf-8"))
    if not public_key.verify(signing_input.encode("utf-8"), decoded_sig):
        raise jwt.JWTError("bad_signature")

    # 4) Parse claims (unverified) then validate standard fields
    claims = jwt.get_unverified_claims(token)
    _validate_standard_claims(claims)
    return claims
