from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    # Found in Supabase Dashboard → Project Settings → API → JWT Secret
    SUPABASE_JWT_SECRET: str = ""

    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8000

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
