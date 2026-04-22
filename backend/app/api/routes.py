import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/ping")
async def ping() -> dict[str, str]:
    """Public smoke-test endpoint — no auth required."""
    return {"message": "pong"}


@router.get("/debug/chroma-status")
async def chroma_status(
    _: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Lists all ChromaDB collections and their document counts."""
    try:
        from app.core.chroma import get_chroma
        chroma = get_chroma()
        col_names = chroma.list_collections()  # 0.6.x returns strings
        result = []
        for name in col_names:
            try:
                count = chroma.get_collection(name).count()
            except Exception as exc:
                logger.warning("Could not count collection %s: %s", name, exc)
                count = -1
            result.append({"name": name, "count": count})
        return {"collections": result}
    except Exception as exc:
        logger.error("chroma-status failed: %s", exc)
        return {"error": str(exc), "collections": []}


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
