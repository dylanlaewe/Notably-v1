# backend/app/auth/types.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

@dataclass
class UserContext:
    sub: str                      # stable external identity (OIDC/Supabase)
    email: Optional[str] = None
    name: Optional[str] = None
    user_id: Optional[UUID] = None  # will be filled after DB mapping (Step 5)
    is_dev: bool = False
