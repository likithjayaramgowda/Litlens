from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user

router = APIRouter()


@router.get("/ping")
async def ping() -> dict[str, str]:
    """Public smoke-test endpoint — no auth required."""
    return {"message": "pong"}


@router.get("/me")
async def get_me(
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Returns the authenticated user's Supabase JWT claims."""
    return {
        "sub": user.get("sub"),
        "email": user.get("email"),
        "role": user.get("role"),
    }
