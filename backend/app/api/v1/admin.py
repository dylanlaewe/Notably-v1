from __future__ import annotations

import os
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Query

from ...maintenance.retention import sweep_loop

router = APIRouter(prefix="/v1/admin", tags=["admin"])

def _auth_or_401(token: Optional[str]) -> None:
    want = os.getenv("NOTABLY_ADMIN_TOKEN", "").strip()
    if not want:
        raise HTTPException(status_code=403, detail="Server not configured with NOTABLY_ADMIN_TOKEN")
    if (token or "").strip() != want:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/retention/sweep")
def retention_sweep(
    limit: int = Query(100, ge=1, le=1000),
    dry_run: bool = Query(True),
    # Explicitly bind to the standard HTTP header "X-Admin-Token"
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token"),
):
    _auth_or_401(x_admin_token)
    res = sweep_loop(limit=limit, dry_run=dry_run)
    return {"ok": True, **res}
