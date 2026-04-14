from pathlib import Path

from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings

# Always resolve .env relative to the project root (three levels up from this file:
# backend/app/core/config.py → backend/app/core → backend/app → backend → project root)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ENV_FILE = str(_PROJECT_ROOT / ".env")


class Settings(BaseSettings):
    # Accept both the backend-native name and the Next.js NEXT_PUBLIC_ prefixed name
    # so a single shared .env file works for both services.
    SUPABASE_URL: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    )
    SUPABASE_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    )
    # Service-role key (server-side only — bypasses RLS, never expose to browser)
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    # JWT Secret — only needed for HS256 projects (pre-March 2024).
    # ES256/RS256 projects verify via JWKS; this field can be left empty for those.
    SUPABASE_JWT_SECRET: str = ""

    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8000

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    model_config = {"env_file": _ENV_FILE, "extra": "ignore"}


settings = Settings()
