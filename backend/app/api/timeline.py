"""
Paper Timeline endpoint.

GET /api/v1/projects/{project_id}/timeline
    Auth required.
    Returns papers in the project sorted by publication year ascending,
    filtered to those with a known year, for chronological visualization.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends
from supabase import create_client, Client

from app.core.auth import get_current_user
from app.core.config import settings
from app.services.project_service import get_project_paper_ids

router = APIRouter(prefix="/projects", tags=["timeline"])
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _service_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


@router.get("/{project_id}/timeline")
async def get_project_timeline(
    project_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    user_id: str = user["sub"]

    paper_ids = get_project_paper_ids(project_id, user_id)
    if not paper_ids:
        return {"timeline": [], "year_min": None, "year_max": None}

    sb = _service_client()
    meta_result = (
        sb.table("papers")
        .select("id, title, authors, year, page_count")
        .in_("id", paper_ids)
        .eq("user_id", user_id)
        .execute()
    )
    papers = meta_result.data or []

    # Keep only papers with a known publication year
    dated = [p for p in papers if p.get("year") is not None]
    dated.sort(key=lambda p: p["year"])

    if not dated:
        return {"timeline": [], "year_min": None, "year_max": None}

    timeline = [
        {
            "paper_id": p["id"],
            "title": p.get("title") or "Untitled",
            "authors": p.get("authors") or "",
            "year": int(p["year"]),
            "page_count": p.get("page_count"),
        }
        for p in dated
    ]

    logger.info(
        "[TIMELINE] project=%s — %d papers with year data (%d–%d)",
        project_id, len(timeline), dated[0]["year"], dated[-1]["year"],
    )

    return {
        "timeline": timeline,
        "year_min": int(dated[0]["year"]),
        "year_max": int(dated[-1]["year"]),
    }
