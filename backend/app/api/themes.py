"""
Theme Clustering endpoint.

POST /api/v1/projects/{project_id}/themes
    Auth required.
    Fetches papers + ChromaDB excerpts for a project, sends them to the LLM,
    and returns 3-6 thematic clusters with paper assignments and colours.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import create_client, Client

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.rate_limit import rate_limit_check
from app.core.chroma import get_chroma as _get_chroma
from app.services.llm_router import stream_free_tier
from app.services.project_service import get_project_paper_ids

router = APIRouter(prefix="/projects", tags=["themes"])
logger = logging.getLogger(__name__)

_THEME_COLOURS = ["#a855f7", "#14b8a6", "#f59e0b", "#f43f5e", "#3b82f6", "#22c55e"]


@lru_cache(maxsize=1)
def _service_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# ── LLM helpers (same pattern as compare.py) ─────────────────────────────────

async def _collect_llm(messages: list[dict], max_tokens: int = 2_000) -> str:
    tokens: list[str] = []
    async for token in stream_free_tier(messages=messages, max_tokens=max_tokens, tier="quick"):
        tokens.append(token)
    return "".join(tokens)


async def _collect_with_retry(messages: list[dict], max_tokens: int = 2_000) -> str:
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            return await _collect_llm(messages, max_tokens)
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                wait = 2 ** attempt
                logger.warning("[THEMES] LLM attempt %d failed (%s), retrying in %ds", attempt + 1, exc, wait)
                await asyncio.sleep(wait)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "LLM providers are rate limited. Please try again in a minute, "
            "or add a DeepSeek API key in Advanced Settings."
        ),
    ) from last_exc


def _extract_json(text: str) -> dict:
    """Extract JSON dict from LLM output, handling fences, arrays, truncation."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    def _unwrap(parsed: object) -> dict | None:
        if isinstance(parsed, list):
            dicts = [x for x in parsed if isinstance(x, dict)]
            return dicts[0] if dicts else None
        return parsed if isinstance(parsed, dict) else None

    try:
        d = _unwrap(json.loads(text))
        if d is not None:
            return d
    except json.JSONDecodeError:
        pass

    for start_char, end_char in [("[", "]"), ("{", "}")]:
        s = text.find(start_char)
        e = text.rfind(end_char)
        if s != -1 and e > s:
            try:
                d = _unwrap(json.loads(text[s : e + 1]))
                if d is not None:
                    return d
            except json.JSONDecodeError:
                pass

    raise ValueError("Could not extract valid JSON from LLM response")


# ── ChromaDB excerpt fetching (same one-shot pattern as compare.py) ──────────

def _fetch_excerpts(user_id: str, paper_ids: list[str], chunks_per_paper: int = 5) -> dict[str, str]:
    """
    Fetch up to `chunks_per_paper` chunks for every paper in one collection.get() call.
    Returns {paper_id: joined_excerpt_string}.
    """
    excerpts: dict[str, str] = {pid: "" for pid in paper_ids}
    try:
        chroma = _get_chroma()
        collection_name = f"user_{user_id}"
        try:
            col = chroma.get_collection(name=collection_name)
        except Exception:
            logger.warning("[THEMES] Collection %r not found", collection_name)
            return excerpts

        where = (
            {"paper_id": paper_ids[0]}
            if len(paper_ids) == 1
            else {"paper_id": {"$in": paper_ids}}
        )
        try:
            result = col.get(where=where, include=["documents", "metadatas"])
            docs: list[str] = result.get("documents") or []
            metas: list[dict] = result.get("metadatas") or []
        except Exception as exc:
            logger.warning("[THEMES] collection.get() with $in failed (%s) — Python fallback", exc)
            all_r = col.get(include=["documents", "metadatas"])
            docs = all_r.get("documents") or []
            metas = all_r.get("metadatas") or []

        chunks_by_paper: dict[str, list[str]] = {pid: [] for pid in paper_ids}
        for doc, meta in zip(docs, metas):
            pid = meta.get("paper_id", "")
            if pid in chunks_by_paper and len(chunks_by_paper[pid]) < chunks_per_paper:
                chunks_by_paper[pid].append(doc)

        for pid in paper_ids:
            chunks = chunks_by_paper[pid]
            if chunks:
                excerpts[pid] = " ".join(chunks)[:600]
            logger.info("[THEMES] paper=%s → %d chunks", pid[:8], len(chunks))

    except Exception as exc:
        logger.warning("[THEMES] _fetch_excerpts failed: %s", exc)

    return excerpts


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_prompt(papers_meta: dict[str, dict], excerpts: dict[str, str]) -> str:
    papers_text = ""
    for pid, meta in papers_meta.items():
        title = (meta.get("title") or "Untitled")[:120]
        year = meta.get("year") or "N/A"
        excerpt = excerpts.get(pid, "")
        if excerpt:
            papers_text += f'- id="{pid}" | "{title}" ({year})\n  Excerpt: {excerpt[:400]}\n'
        else:
            papers_text += f'- id="{pid}" | "{title}" ({year})\n  Note: no full text available\n'

    colour_list = ", ".join(_THEME_COLOURS)
    n = len(papers_meta)
    num_themes = min(6, max(3, n // 2))

    template = json.dumps(
        {
            "themes": [
                {
                    "theme_id": "theme_1",
                    "label": "Short Theme Name",
                    "description": "2-3 sentence description of this research theme.",
                    "color": _THEME_COLOURS[0],
                    "papers": ["<paper_id>"],
                }
            ]
        },
        indent=2,
    )

    return (
        f"Analyze these {n} research papers and group them into {num_themes} thematic clusters "
        "based on their topics, methods, and content.\n\n"
        f"Papers:\n{papers_text}\n"
        f"Return this exact JSON structure:\n{template}\n\n"
        "Rules:\n"
        "- Return ONLY valid JSON, no markdown fences, no text outside the JSON.\n"
        "- Return a single JSON object, NOT an array.\n"
        f"- Use distinct hex colors chosen from: {colour_list}\n"
        "- Every paper_id must appear in at least one theme.\n"
        "- Papers may belong to multiple themes if appropriate.\n"
        "- Use only paper_id values exactly as listed above.\n"
        "- label must be 3-5 words.\n"
        "- description must be 2-3 sentences."
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/{project_id}/themes")
async def get_project_themes(
    project_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    user_id: str = user["sub"]

    if not rate_limit_check(user_id, "themes", max_calls=10, window_secs=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment.",
        )

    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENROUTER_API_KEY is not configured.",
        )

    # Step 1: paper IDs for this project
    paper_ids = get_project_paper_ids(project_id, user_id)
    if not paper_ids:
        return {"themes": [], "papers": {}}

    if len(paper_ids) < 2:
        return {"themes": [], "papers": {}, "message": "Need at least 2 papers to cluster themes."}

    # Step 2: paper metadata from Supabase (user_id filter is defence-in-depth;
    # paper_ids already came from get_project_paper_ids which filters by user_id)
    sb = _service_client()
    meta_result = (
        sb.table("papers")
        .select("id, title, authors, year")
        .in_("id", paper_ids)
        .eq("user_id", user_id)
        .execute()
    )
    papers_meta: dict[str, dict] = {p["id"]: p for p in (meta_result.data or [])}

    if not papers_meta:
        return {"themes": [], "papers": {}}

    # Step 3: one-shot ChromaDB fetch for all papers
    excerpts = _fetch_excerpts(user_id, list(papers_meta.keys()))

    # Step 4: LLM theme extraction
    prompt = _build_prompt(papers_meta, excerpts)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a research analyst. Return ONLY valid JSON. "
                "Return a single JSON object, NOT an array. "
                "No markdown fences, no text before or after the JSON."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    logger.info("[THEMES] project=%s papers=%d — calling LLM", project_id, len(papers_meta))
    raw = await _collect_with_retry(messages, max_tokens=2_000)
    logger.info("[THEMES] Raw (first 300): %s", raw[:300])

    try:
        result = _extract_json(raw)
    except ValueError as exc:
        logger.exception("[THEMES] JSON parse failed")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="LLM returned unparseable theme data. Please try again.",
        ) from exc

    themes: list[dict] = result.get("themes") or []
    if not themes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="LLM returned no themes. Please try again.",
        )

    # Sanitise: strip unknown paper_ids, assign colours if missing
    valid_ids = set(papers_meta.keys())
    for i, theme in enumerate(themes):
        theme["papers"] = [p for p in (theme.get("papers") or []) if p in valid_ids]
        if not theme.get("color"):
            theme["color"] = _THEME_COLOURS[i % len(_THEME_COLOURS)]

    logger.info("[THEMES] project=%s → %d themes", project_id, len(themes))

    # Step 5: return themes + full paper metadata keyed by paper_id
    papers_out = {
        pid: {
            "paper_id": pid,
            "title": meta.get("title") or "Untitled",
            "authors": meta.get("authors") or "",
            "year": meta.get("year"),
        }
        for pid, meta in papers_meta.items()
    }

    return {"themes": themes, "papers": papers_out}
