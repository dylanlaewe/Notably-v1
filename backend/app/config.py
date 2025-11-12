# backend/app/config.py
import os
from functools import lru_cache

class Settings:
    # ---- Modes / toggles
    DEV_MODE: bool = os.getenv("DEV_MODE", "false").lower() == "true"

    # ---- Dev key path (local only)
    DEV_API_KEY: str | None = os.getenv("DEV_API_KEY")
    NOTABLY_DEV_USER_ID: str | None = os.getenv("NOTABLY_DEV_USER_ID")  # UUID string

    # ---- JWT / OIDC (for Supabase or any OIDC issuer)
    JWT_ISSUER: str | None = os.getenv("JWT_ISSUER")
    JWT_AUDIENCE: str | None = os.getenv("JWT_AUDIENCE")
    JWKS_URL: str | None = os.getenv("JWKS_URL")
    JWT_LEEWAY_SECONDS: int = int(os.getenv("JWT_LEEWAY_SECONDS", "60"))

@lru_cache
def get_settings() -> Settings:
    return Settings()
