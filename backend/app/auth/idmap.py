# backend/app/auth/idmap.py
from __future__ import annotations
from uuid import UUID, uuid5, NAMESPACE_URL

# Stable mapping from external subject (OIDC/Supabase "sub") to our internal user UUID.
# UUIDv5 is deterministic: same sub -> same UUID, no DB required.
def user_uuid_from_sub(sub: str) -> UUID:
    # Use a namespaced URL so it won't collide with other UUIDv5 generators
    return uuid5(NAMESPACE_URL, f"https://notably.app/auth-sub/{sub}")
