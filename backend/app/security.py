from __future__ import annotations

import os
import time
import ipaddress
from typing import Dict, Tuple, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


# -------------------------------
# Helpers
# -------------------------------

def _client_ip(req: Request) -> str:
    # Prefer first X-Forwarded-For if present; else peer addr
    xff = req.headers.get("x-forwarded-for")
    if xff:
        # Take the left-most (original client)
        return xff.split(",")[0].strip()
    client = req.client
    return client.host if client else "127.0.0.1"


def _parse_allowlist(env_val: str) -> list[ipaddress._BaseNetwork]:
    nets = []
    for raw in (env_val or "").split(","):
        s = raw.strip()
        if not s:
            continue
        try:
            nets.append(ipaddress.ip_network(s, strict=False))
        except Exception:
            pass
    return nets


def _in_allowlist(ip_str: str, nets: list[ipaddress._BaseNetwork]) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except Exception:
        return False
    return any(ip in net for net in nets)


# -------------------------------
# API Key auth (no-op if unset)
# -------------------------------

class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """
    If NOTABLY_API_KEY is set, require either:
      - Header: X-Api-Key: <key>
      - Header: Authorization: Bearer <key>

    Exempts:
      - GET /health
      - All /v1/admin/* endpoints (they use the admin token)
    """

    def __init__(self, app):
        super().__init__(app)
        self.required_key = (os.getenv("NOTABLY_API_KEY") or "").strip()

    async def dispatch(self, request: Request, call_next):
        if not self.required_key:
            return await call_next(request)

        path = request.url.path or ""
        if request.method == "GET" and path == "/health":
            return await call_next(request)
        if path.startswith("/v1/admin/"):
            # Admin routes are protected by NOTABLY_ADMIN_TOKEN separately
            return await call_next(request)

        key = request.headers.get("x-api-key", "").strip()
        if not key:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                key = auth[7:].strip()

        if key != self.required_key:
            return JSONResponse(
                {"detail": "Unauthorized"},
                status_code=401,
                headers={"WWW-Authenticate": 'Bearer realm="notably"'},
            )

        return await call_next(request)


# -------------------------------
# Tiny per-IP rate limit (dev)
# -------------------------------

class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    In-memory token bucket per client IP.
      NOTABLY_RATE_RPS   : refill rate (tokens/sec), default 5
      NOTABLY_RATE_BURST : bucket size, default 10
      NOTABLY_RATE_ALLOWLIST : CSV of CIDRs to bypass, e.g. "127.0.0.1/32,10.0.0.0/8"

    Notes:
      - Lightweight, single-process dev throttle (not distributed).
      - Adds X-RateLimit-* headers and Retry-After on 429.
    """

    def __init__(self, app):
        super().__init__(app)
        self.rps = float(os.getenv("NOTABLY_RATE_RPS", "5"))
        self.burst = float(os.getenv("NOTABLY_RATE_BURST", "10"))
        self.allowlist = _parse_allowlist(os.getenv("NOTABLY_RATE_ALLOWLIST", "127.0.0.1/32"))

        # ip -> (tokens, last_ts)
        self._buckets: Dict[str, Tuple[float, float]] = {}

    async def dispatch(self, request: Request, call_next):
        ip = _client_ip(request)
        if _in_allowlist(ip, self.allowlist) or self.rps <= 0 or self.burst <= 0:
            return await call_next(request)

        now = time.monotonic()
        tokens, last = self._buckets.get(ip, (self.burst, now))
        # Refill
        tokens = min(self.burst, tokens + self.rps * (now - last))
        last = now

        if tokens < 1.0:
            # Calculate wait time for 1 token
            needed = 1.0 - tokens
            wait_s = max(0.0, needed / self.rps)
            headers = {
                "Retry-After": f"{int(wait_s) + 1}",
                "X-RateLimit-Limit": f"{int(self.burst)}",
                "X-RateLimit-Remaining": "0",
            }
            return JSONResponse({"detail": "Too Many Requests"}, status_code=429, headers=headers)

        tokens -= 1.0
        self._buckets[ip] = (tokens, last)

        response: Response = await call_next(request)
        response.headers.setdefault("X-RateLimit-Limit", f"{int(self.burst)}")
        response.headers.setdefault("X-RateLimit-Remaining", f"{max(0, int(tokens))}")
        return response
