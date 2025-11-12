# backend/app/api/v1/auth_routes.py
from fastapi import APIRouter, Depends
from ...auth import require_user, UserContext   # ← this is the key line

router = APIRouter(prefix="/v1/auth", tags=["auth"])

@router.get("/ping")
async def auth_ping(user: UserContext = Depends(require_user)):
    return {
        "ok": True,
        "user_id": str(user.user_id) if user.user_id else None,
        "sub": user.sub,
        "email": user.email,
        "dev": user.is_dev,
    }


