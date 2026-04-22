"""
Comparison Table endpoint.

POST /api/v1/compare
    Auth required.
    Accepts project_id, paper_ids (2-6), and optional dimensions.

Flow:
  1. Fetch paper metadata from Supabase.
  2. Fetch ALL chunks for ALL papers in ONE ChromaDB call (collection.get with $in).
  3. Build per-paper excerpt strings upfront.
  4. Pass excerpts into LLM batches — no ChromaDB calls inside batch loops.

For 4+ papers, splits into two sequential LLM calls and merges results
to avoid token-budget issues causing truncated/unparseable JSON.
Between batch calls, sleeps 3s to reduce rate-limit pressure.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from supabase import create_client, Client

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.rate_limit import rate_limit_check
from app.core.chroma import get_chroma as _get_chroma
from app.services.llm_router import stream_free_tier

router = APIRouter(tags=["compare"])
logger = logging.getLogger(__name__)

_DEFAULT_DIMENSIONS = [
    "methodology",
    "dataset",
    "results",
    "limitations",
    "key_findings",
    "research_gap",
]


@lru_cache(maxsize=1)
def _service_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


class CompareRequest(BaseModel):
    project_id: str
    paper_ids: list[str] = Field(..., min_length=2, max_length=6)
    dimensions: list[str] | None = None


# ── LLM helpers ──────────────────────────────────────────────────────────────

async def _collect_llm(messages: list[dict], max_tokens: int = 3_000) -> str:
    """Collect all tokens from stream_free_tier into a single string."""
    tokens: list[str] = []
    async for token in stream_free_tier(messages=messages, max_tokens=max_tokens, tier="quick"):
        tokens.append(token)
    return "".join(tokens)


async def _collect_llm_with_retry(messages: list[dict], max_tokens: int = 3_000) -> str:
    """Collect LLM tokens with exponential backoff retry on failures."""
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            return await _collect_llm(messages, max_tokens)
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                wait = 2 ** attempt  # 1s, 2s
                logger.warning("[COMPARE] LLM attempt %d failed (%s), retrying in %ds", attempt + 1, exc, wait)
                await asyncio.sleep(wait)
            else:
                logger.error("[COMPARE] All 3 LLM attempts failed: %s", exc)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "All LLM providers are currently rate limited. "
            "Please try again in a minute, or add a DeepSeek API key in Advanced Settings "
            "for unlimited comparisons."
        ),
    ) from last_exc


def _unwrap_to_dict(parsed: object) -> dict | None:
    """
    Unwrap a parsed JSON value to a dict.
    - If already a dict, return it.
    - If a list of dicts, merge them: concatenate 'papers' arrays and union 'cells' dicts.
      This handles the case where the LLM returns both batches as [{batch1}, {batch2}].
    - Otherwise return None.
    Does NOT validate keys — caller does that.
    """
    if isinstance(parsed, list):
        dicts = [item for item in parsed if isinstance(item, dict)]
        if not dicts:
            return None
        if len(dicts) == 1:
            return dicts[0]
        # Merge multiple batch objects into one
        merged_papers: list = []
        merged_cells: dict = {}
        dimensions: list = []
        for d in dicts:
            merged_papers.extend(d.get("papers") or [])
            merged_cells.update(d.get("cells") or {})
            if not dimensions and d.get("dimensions"):
                dimensions = d["dimensions"]
        logger.info("[COMPARE] Merged %d array elements into one result", len(dicts))
        return {"papers": merged_papers, "dimensions": dimensions, "cells": merged_cells}
    if isinstance(parsed, dict):
        return parsed
    return None


def _extract_json(text: str) -> dict:
    """
    Extract a JSON object from LLM output regardless of wrapping or truncation.
    Returns a dict. Does NOT validate whether 'cells' is present — caller does that.
    """
    text = text.strip()

    # Strip markdown fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    # Fast path: try parsing the whole string directly
    try:
        d = _unwrap_to_dict(json.loads(text))
        if d is not None:
            return d
    except json.JSONDecodeError:
        pass

    obj_start = text.find("{")
    arr_start = text.find("[")

    if obj_start == -1 and arr_start == -1:
        raise ValueError("Could not find any JSON in LLM response")

    # Try outermost [ ... ] first when it appears before {
    if arr_start != -1 and (obj_start == -1 or arr_start < obj_start):
        arr_end = text.rfind("]")
        if arr_end > arr_start:
            try:
                d = _unwrap_to_dict(json.loads(text[arr_start : arr_end + 1]))
                if d is not None:
                    return d
            except json.JSONDecodeError:
                pass

    # Try outermost { ... }
    start = obj_start
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            d = _unwrap_to_dict(json.loads(text[start : end + 1]))
            if d is not None:
                return d
        except json.JSONDecodeError:
            pass

    # Walk brace depth to repair truncated JSON
    if start != -1:
        partial = text[start:]
        depth = 0
        last_complete = 0
        in_string = False
        escape_next = False
        for i, ch in enumerate(partial):
            if escape_next:
                escape_next = False
                continue
            if ch == "\\" and in_string:
                escape_next = True
                continue
            if ch == '"':
                in_string = not in_string
            if not in_string:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        last_complete = i
        if last_complete:
            try:
                closing = "}" * max(depth, 0)
                d = _unwrap_to_dict(json.loads(partial[: last_complete + 1] + closing))
                if d is not None:
                    return d
            except Exception:
                pass

    raise ValueError("Could not extract valid JSON from LLM response")


# ── Chunk fetching ────────────────────────────────────────────────────────────

def _fetch_all_chunks(user_id: str, paper_ids: list[str]) -> dict[str, str]:
    """
    Fetch chunks for ALL papers in ONE ChromaDB collection.get() call.
    Returns dict mapping paper_id → joined excerpt string (≤500 chars).

    Uses $in filter so all papers are fetched atomically — no per-paper
    queries inside LLM batch loops, which caused intermittent misses.
    """
    excerpts: dict[str, str] = {pid: "" for pid in paper_ids}

    try:
        chroma = _get_chroma()

        # DEBUG: list available collections so we can confirm the name
        try:
            all_cols = chroma.list_collections()
            logger.info("[COMPARE] Available ChromaDB collections: %s", [c.name for c in all_cols])
        except Exception as exc:
            logger.warning("[COMPARE] Could not list collections: %s", exc)

        collection_name = f"user_{user_id}"
        try:
            col = chroma.get_collection(name=collection_name)
        except Exception:
            logger.warning("[COMPARE] Collection %r not found — no chunks available", collection_name)
            return excerpts

        logger.info("[COMPARE] ChromaDB collection=%s  paper_ids=%s", collection_name, paper_ids)

        # Single get() for all papers at once
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
            logger.warning("[COMPARE] collection.get() with $in failed (%s) — falling back to Python filter", exc)
            # Fallback: fetch everything and filter in Python
            all_result = col.get(include=["documents", "metadatas"])
            docs = all_result.get("documents") or []
            metas = all_result.get("metadatas") or []

        # Group up to 3 chunks per paper
        chunks_by_paper: dict[str, list[str]] = {pid: [] for pid in paper_ids}
        for doc, meta in zip(docs, metas):
            pid = meta.get("paper_id", "")
            if pid in chunks_by_paper and len(chunks_by_paper[pid]) < 3:
                chunks_by_paper[pid].append(doc)

        # Build excerpt strings and log per-paper counts
        for pid in paper_ids:
            chunks = chunks_by_paper[pid]
            logger.info("[COMPARE] paper=%s → %d chunks", pid[:8], len(chunks))
            if chunks:
                excerpts[pid] = " ".join(chunks)[:500]

    except Exception as exc:
        logger.warning("[COMPARE] _fetch_all_chunks failed: %s", exc)

    return excerpts


# ── Prompt + single LLM call ──────────────────────────────────────────────────

def _build_prompt(
    paper_ids: list[str],
    papers_meta: dict[str, dict],
    excerpts: dict[str, str],
    dimensions: list[str],
) -> str:
    """Build a minimal, explicit prompt that reliably produces valid JSON."""
    papers_text = ""
    papers_list: list[dict] = []
    cells_template: dict[str, dict] = {}

    for i, pid in enumerate(paper_ids):
        meta = papers_meta[pid]
        title = (meta.get("title") or "Unknown")[:100]
        authors = str(meta.get("authors") or "")[:60]
        year = meta.get("year") or "N/A"
        excerpt = excerpts.get(pid, "")

        if excerpt:
            papers_text += (
                f'Paper {i + 1} (id="{pid}"): "{title}" ({year}) by {authors}\n'
                f"  Excerpt: {excerpt.replace(chr(10), ' ')}\n---\n"
            )
        else:
            papers_text += (
                f'Paper {i + 1} (id="{pid}"): "{title}" ({year}) by {authors}\n'
                f"  Note: No full text available. Infer from title and year.\n---\n"
            )

        papers_list.append({"paper_id": pid, "title": title, "authors": authors, "year": meta.get("year")})
        cells_template[pid] = {d: "..." for d in dimensions}

    template_json = json.dumps(
        {"papers": papers_list, "dimensions": dimensions, "cells": cells_template},
        indent=2,
    )

    return (
        "You are comparing research papers. Return ONLY a JSON object.\n\n"
        f"Papers:\n{papers_text}\n"
        "Return this exact JSON structure with real 2-3 sentence answers replacing '...':\n"
        f"{template_json}\n\n"
        "Rules: valid JSON only, no markdown fences, no text before or after the JSON.\n"
        "If no excerpt is provided for a paper, make reasonable inferences based on the paper "
        "title, authors, and publication year. Never say 'not specified' — always provide a "
        "meaningful answer based on available context."
    )


async def _single_compare(
    paper_ids: list[str],
    papers_meta: dict[str, dict],
    excerpts: dict[str, str],
    dimensions: list[str],
) -> dict:
    """Run a single LLM comparison call for a batch of papers."""
    prompt = _build_prompt(paper_ids, papers_meta, excerpts, dimensions)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a research analyst. Return ONLY valid JSON. "
                "Return a single JSON object, NOT an array. Do not wrap in [ ]. "
                "No markdown fences, no explanatory text before or after the JSON."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    raw = await _collect_llm_with_retry(messages, max_tokens=3_000)
    logger.info("[COMPARE] Raw for %d papers (first 300): %s", len(paper_ids), raw[:300])

    result = _extract_json(raw)
    if "cells" not in result:
        raise ValueError(f"LLM response missing 'cells' key. Raw: {raw[:300]}")
    return result


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/compare")
async def compare_papers(
    body: CompareRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    user_id: str = user["sub"]
    dimensions = body.dimensions or _DEFAULT_DIMENSIONS

    if not rate_limit_check(user_id, "compare", max_calls=10, window_secs=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment.",
        )

    if len(body.paper_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 papers required.")
    if len(body.paper_ids) > 6:
        raise HTTPException(status_code=400, detail="At most 6 papers allowed.")

    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENROUTER_API_KEY is not configured.",
        )

    # ── Step 1: Fetch paper metadata from Supabase ────────────────────────────
    sb = _service_client()
    meta_result = (
        sb.table("papers")
        .select("id, title, authors, year")
        .in_("id", body.paper_ids)
        .eq("user_id", user_id)
        .execute()
    )
    papers_meta: dict[str, dict] = {p["id"]: p for p in (meta_result.data or [])}

    missing = [pid for pid in body.paper_ids if pid not in papers_meta]
    if missing:
        raise HTTPException(status_code=404, detail=f"Papers not found or not owned: {missing}")

    # ── Step 2: Fetch ALL chunks for ALL papers in one ChromaDB call ──────────
    excerpts = _fetch_all_chunks(user_id, body.paper_ids)

    # ── Step 3: Run comparison (batch for 4+ papers) ──────────────────────────
    n = len(body.paper_ids)
    logger.info("[COMPARE] Starting: %d papers × %d dimensions", n, len(dimensions))

    try:
        if n <= 3:
            result = await _single_compare(body.paper_ids, papers_meta, excerpts, dimensions)
        else:
            # Split into two balanced batches to keep each call within token budget.
            # Both batches receive the same pre-fetched excerpts dict.
            # Sleep 3s between calls so the first call's rate-limit window resets.
            mid = (n + 1) // 2
            batch1 = body.paper_ids[:mid]
            batch2 = body.paper_ids[mid:]
            logger.info("[COMPARE] Batching: %d + %d papers", len(batch1), len(batch2))
            r1 = await _single_compare(batch1, papers_meta, excerpts, dimensions)
            await asyncio.sleep(5)
            r2 = await _single_compare(batch2, papers_meta, excerpts, dimensions)
            result = {
                "papers": r1.get("papers", []) + r2.get("papers", []),
                "dimensions": dimensions,
                "cells": {**r1.get("cells", {}), **r2.get("cells", {})},
            }

        logger.info("[COMPARE] Success — %d papers × %d dimensions", n, len(dimensions))
        return result

    except HTTPException:
        raise
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("[COMPARE] JSON parse failed — likely caused by rate-limited LLM returning non-JSON")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "All AI models are currently busy. "
                "Please wait 60 seconds and try again, or add a DeepSeek API key in Advanced Settings."
            ),
        ) from exc
    except Exception as exc:
        logger.exception("[COMPARE] Comparison failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Comparison failed: {exc}",
        ) from exc
