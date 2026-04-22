"""
Citation Assistant endpoints.

POST /api/v1/citations/suggest
    Body: { paragraph, project_id?, citation_style? }
    Returns: list of citation suggestion objects

POST /api/v1/citations/verify
    Body: { text, project_id?, citation_style? }
    Returns: list of paragraph annotation objects

GET  /api/v1/citations/drafts/{project_id}
    Returns: the user's saved draft for that project (or 404)

PUT  /api/v1/citations/drafts/{project_id}
    Body: { title?, content, citation_style? }
    Returns: the saved draft row

POST /api/v1/citations/bibliography
    Body: { project_id, citation_style }
    Returns: { bibliography: str, papers: [...] }
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.rate_limit import rate_limit_check

from app.core.auth import get_current_user
from app.services.citation_service import (
    suggest_citations,
    verify_draft,
    get_draft,
    save_draft,
    format_bibliography,
)
from app.services.project_service import get_project, get_project_paper_ids

router = APIRouter(prefix="/citations", tags=["citations"])
logger = logging.getLogger(__name__)


# ── Request / response models ──────────────────────────────────────────────────

class SuggestRequest(BaseModel):
    paragraph: str = Field(..., max_length=10_000)
    project_id: str | None = None
    citation_style: str = "APA"


class VerifyRequest(BaseModel):
    text: str = Field(..., max_length=50_000)
    project_id: str | None = None
    citation_style: str = "APA"


class SaveDraftRequest(BaseModel):
    title: str = Field("Untitled Draft", max_length=500)
    content: str = Field(..., max_length=100_000)
    citation_style: str = "APA"


class BibliographyRequest(BaseModel):
    project_id: str
    citation_style: str = "APA"
    paper_ids: list[str] | None = None  # optional explicit list; if None, use all project papers


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_project_access(project_id: str, user_id: str) -> None:
    """Raise 404 if the project doesn't exist or doesn't belong to this user."""
    if not get_project(project_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project '{project_id}' not found.",
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/suggest",
    summary="Suggest citations for a paragraph based on project papers",
)
async def suggest_endpoint(
    body: SuggestRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> list[dict]:
    """
    Embed the paragraph, retrieve the most semantically relevant chunks from
    the project's papers, then ask the LLM which papers best support the text
    and whether a citation is needed.
    """
    user_id: str = user["sub"]
    if not rate_limit_check(user_id, "citations_suggest", max_calls=20, window_secs=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment.",
        )

    paper_ids: list[str] | None = None
    if body.project_id:
        _require_project_access(body.project_id, user_id)
        paper_ids = get_project_paper_ids(body.project_id, user_id)

    return await suggest_citations(
        user_id=user_id,
        paragraph=body.paragraph,
        project_id=body.project_id,
        citation_style=body.citation_style,
        paper_ids=paper_ids,
    )


@router.post(
    "/verify",
    summary="Verify citation accuracy across an entire draft",
)
async def verify_endpoint(
    body: VerifyRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> list[dict]:
    """
    Split the draft into paragraphs, retrieve relevant paper chunks, then ask
    the LLM to classify each paragraph's citation status:
        correct | weak | wrong | missing | ok
    """
    user_id: str = user["sub"]

    paper_ids: list[str] | None = None
    if body.project_id:
        _require_project_access(body.project_id, user_id)
        paper_ids = get_project_paper_ids(body.project_id, user_id)

    return await verify_draft(
        user_id=user_id,
        full_text=body.text,
        project_id=body.project_id,
        paper_ids=paper_ids,
    )


@router.get(
    "/drafts/{project_id}",
    summary="Get the user's saved draft for a project",
)
async def get_draft_endpoint(
    project_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    user_id: str = user["sub"]
    _require_project_access(project_id, user_id)

    draft = get_draft(user_id, project_id)
    if not draft:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No draft found for this project.",
        )
    return draft


@router.put(
    "/drafts/{project_id}",
    summary="Create or update the draft for a project",
)
async def save_draft_endpoint(
    project_id: str,
    body: SaveDraftRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    user_id: str = user["sub"]
    _require_project_access(project_id, user_id)

    return save_draft(
        user_id=user_id,
        project_id=project_id,
        title=body.title,
        content=body.content,
        citation_style=body.citation_style,
    )


@router.post(
    "/bibliography",
    summary="Generate a formatted bibliography for all papers in a project",
)
async def bibliography_endpoint(
    body: BibliographyRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """
    Fetch paper metadata from Supabase for the given project and format the
    bibliography in the requested citation style.

    Returns:
        { bibliography: str, papers: list[dict], citation_style: str }
    """
    from app.services.project_service import _service_client  # reuse cached client

    user_id: str = user["sub"]
    _require_project_access(body.project_id, user_id)

    # Fetch paper metadata
    try:
        sb = _service_client()
        query = (
            sb.table("papers")
            .select("id, title, authors, year, filename")
            .eq("project_id", body.project_id)
            .eq("user_id", user_id)
        )
        if body.paper_ids:
            query = query.in_("id", body.paper_ids)

        result = query.order("year", desc=False).execute()
        papers = result.data or []
    except Exception as exc:
        logger.error("Failed to fetch papers for bibliography: %s", exc)
        raise HTTPException(status_code=500, detail="Could not fetch paper metadata.")

    bibliography = format_bibliography(papers, body.citation_style)

    return {
        "bibliography": bibliography,
        "papers": papers,
        "citation_style": body.citation_style,
    }
