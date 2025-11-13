from __future__ import annotations

import os
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Query

from ...maintenance.retention import sweep_loop
from backend.app.config import get_settings

router = APIRouter(prefix="/v1/admin", tags=["admin"])

def _require_admin(x_admin_token: str | None = Header(None, alias="X-Admin-Token")):
    s = get_settings()
    if not s or not getattr(s, "NOTABLY_ADMIN_TOKEN", None):
        # test will SKIP on this 401
        raise HTTPException(status_code=401, detail="Server not configured with NOTABLY_ADMIN_TOKEN")
    if x_admin_token != s.NOTABLY_ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/retention/sweep")
def retention_sweep(
    limit: int = Query(100, ge=1, le=1000),
    dry_run: bool = Query(True),
    # Explicitly bind to the standard HTTP header "X-Admin-Token"
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token"),
):
    _require_admin(x_admin_token)
    res = sweep_loop(limit=limit, dry_run=dry_run)
    return {"ok": True, **res}
