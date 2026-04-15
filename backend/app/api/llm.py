"""
LLM endpoints.

GET  /api/v1/llm/tiers            — list model tiers for the frontend toggle (public)
GET  /api/v1/llm/quota            — user's remaining queries today (auth required)
POST /api/v1/llm/test-connection  — validate a BYOK DeepSeek API key (auth required)

Free-tier streaming uses OpenRouter server-side and is handled in the Phase 4
chat endpoint.  API keys are never stored — they travel only in X-LLM-API-Key
request headers and sessionStorage.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.services.llm_router import BYOK_PROVIDERS, TIERS, test_connection
from app.services.quota_service import get_quota_info, is_demo_user

router = APIRouter(prefix="/llm", tags=["llm"])


# ── Response models ───────────────────────────────────────────────────────────

class TierInfo(BaseModel):
    id: str
    label: str
    model: str
    description: str
    icon: str


class QuotaResponse(BaseModel):
    used: int
    limit: int
    remaining: int


class TestConnectionResponse(BaseModel):
    ok: bool
    error: str | None = None
    sample: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/tiers",
    response_model=list[TierInfo],
    summary="List available model tiers for the chat UI toggle",
)
async def list_tiers() -> list[TierInfo]:
    """
    Public endpoint — no auth required.
    Returns the three model tiers so the frontend toggle can render labels,
    tooltips, and icons without hard-coding anything.
    """
    return [TierInfo(**t) for t in TIERS]


@router.get(
    "/quota",
    response_model=QuotaResponse,
    summary="Get the user's remaining daily query quota",
)
async def get_quota(
    user: Annotated[dict, Depends(get_current_user)],
) -> QuotaResponse:
    """
    Returns how many free-tier queries the user has used and how many remain
    today.  Demo users (``user_metadata.is_demo == true``) have a lower cap.
    """
    user_id: str = user["sub"]
    demo = is_demo_user(user)
    info = get_quota_info(user_id, is_demo=demo)
    return QuotaResponse(**info)


@router.post(
    "/test-connection",
    response_model=TestConnectionResponse,
    summary="Validate a BYOK DeepSeek API key",
)
async def test_llm_connection(
    user: Annotated[dict, Depends(get_current_user)],
    x_llm_provider: str = Header(alias="X-LLM-Provider", default="deepseek"),
    x_llm_model: str = Header(alias="X-LLM-Model", default="deepseek-chat"),
    x_llm_api_key: str = Header(alias="X-LLM-API-Key", default=""),
) -> TestConnectionResponse:
    """
    Send a minimal probe message to the configured BYOK provider.

    The API key is read from the ``X-LLM-API-Key`` request header and is
    **never persisted** — it exists only for the duration of this request.

    Returns ``{"ok": true}`` if the key works, ``{"ok": false, "error": "..."}``
    otherwise.
    """
    provider = x_llm_provider.lower()

    if provider not in BYOK_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported BYOK provider '{provider}'. "
                   f"Supported: {list(BYOK_PROVIDERS)}",
        )

    if BYOK_PROVIDERS[provider].get("needs_key", True) and not x_llm_api_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="X-LLM-API-Key header is required for this provider.",
        )

    result = await test_connection(
        provider=provider,
        model=x_llm_model,
        api_key=x_llm_api_key,
    )
    return TestConnectionResponse(**result)
