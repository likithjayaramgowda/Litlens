"""
Knowledge Graph endpoint.

GET /api/v1/projects/{project_id}/graph
    Auth required.
    Retrieves paper chunks from ChromaDB, extracts shared concepts via LLM,
    and returns a force-graph-ready node/edge payload.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends
from supabase import create_client, Client

from app.core.auth import get_current_user
from app.core.config import settings
from app.services.project_service import get_project_paper_ids
from app.services.retrieval_service import retrieve_chunks

router = APIRouter(prefix="/projects", tags=["graph"])
logger = logging.getLogger(__name__)

_OR_BASE_URL = "https://openrouter.ai/api/v1"
_OR_HEADERS = {"HTTP-Referer": "https://litlens.app", "X-Title": "LitLens"}
_GRAPH_MODEL = "meta-llama/llama-3.3-70b-instruct:free"


@lru_cache(maxsize=1)
def _service_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


async def _extract_concepts(excerpts: list[dict]) -> tuple[list[dict], str | None]:
    """
    Ask the LLM to identify shared concepts/themes across paper excerpts.
    Returns (concepts, error_message) — error_message is None on success.
    """
    if not settings.OPENROUTER_API_KEY:
        msg = "OPENROUTER_API_KEY is not set in settings"
        logger.error("[GRAPH] %s", msg)
        return [], msg

    if not excerpts:
        return [], "No excerpts available for concept extraction"

    logger.info(
        "[GRAPH] _extract_concepts called — key_prefix=%s excerpts=%d",
        settings.OPENROUTER_API_KEY[:8] + "…",
        len(excerpts),
    )

    context_lines = [
        f'- paper_id="{e["paper_id"]}" | title="{e["paper_title"]}" '
        f'| excerpt: "{e["text"][:300].replace(chr(10), " ")}"'
        for e in excerpts[:20]
    ]
    context_block = "\n".join(context_lines)

    prompt = f"""You are analysing a set of academic papers to build a knowledge graph.

PAPER EXCERPTS:
{context_block}

Extract the top 15 most important concepts, themes, methods, or topics shared across these papers.

Respond with ONLY valid JSON — no markdown fences:
{{
  "concepts": [
    {{
      "concept": "Short Concept Name",
      "paper_ids": ["exact_paper_id_from_above"],
      "weight": 0.9
    }}
  ]
}}

Rules:
- "concept" must be a short noun phrase (2–5 words)
- "paper_ids" must only contain IDs from the paper_id fields shown above
- "weight" 0.0–1.0: how central/cross-paper this concept is
- Prioritise concepts that appear in multiple papers
- Return at most 15 concepts"""

    try:
        import httpx
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url=_OR_BASE_URL,
            default_headers=_OR_HEADERS,
            http_client=httpx.AsyncClient(timeout=90.0),
        )
        response = await client.chat.completions.create(
            model=_GRAPH_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1_200,
            stream=False,
        )
        raw = response.choices[0].message.content or "{}"
        logger.info("[GRAPH] LLM raw response (first 300): %s", raw[:300])
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw.strip())
        result = json.loads(raw)
        concepts = result.get("concepts", []) if isinstance(result, dict) else []
        logger.info("[GRAPH] Extracted %d concepts", len(concepts))
        return concepts, None
    except json.JSONDecodeError as exc:
        msg = f"LLM returned non-JSON: {exc}"
        logger.exception("[GRAPH] %s", msg)
        return [], msg
    except Exception as exc:
        logger.exception("[GRAPH] Concept extraction failed")
        return [], str(exc)


@router.get("/{project_id}/graph")
async def get_project_graph(
    project_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    user_id: str = user["sub"]

    paper_ids = get_project_paper_ids(project_id, user_id)
    if not paper_ids:
        return {"nodes": [], "edges": [], "message": "No papers in this project yet."}

    # Fetch paper metadata (title, authors, year) from Supabase
    sb = _service_client()
    meta_result = (
        sb.table("papers")
        .select("id, title, authors, year")
        .in_("id", paper_ids)
        .eq("user_id", user_id)
        .execute()
    )
    papers_meta: dict[str, dict] = {p["id"]: p for p in (meta_result.data or [])}

    # Retrieve a broad set of chunks for concept extraction
    chunks = retrieve_chunks(
        user_id,
        "research methodology findings results analysis conclusions",
        n_results=30,
        paper_ids=paper_ids,
    )

    # One representative excerpt per paper for the LLM
    seen_pids: set[str] = set()
    excerpts: list[dict] = []
    for c in chunks:
        if c["paper_id"] not in seen_pids:
            seen_pids.add(c["paper_id"])
            excerpts.append(c)

    # Extract concepts via LLM
    concepts, llm_error = await _extract_concepts(excerpts)

    # ── Build nodes ───────────────────────────────────────────────────────────

    nodes: list[dict] = []

    for pid in paper_ids:
        meta = papers_meta.get(pid, {})
        title = meta.get("title") or "Unknown Paper"
        nodes.append({
            "id": pid,
            "label": title[:55] + ("…" if len(title) > 55 else ""),
            "type": "paper",
            "metadata": {
                "title": title,
                "authors": meta.get("authors") or "",
                "year": meta.get("year"),
            },
        })

    # ── Build concept nodes + edges ───────────────────────────────────────────

    edges: list[dict] = []
    seen_concept_ids: set[str] = set()

    for c in concepts:
        name = str(c.get("concept", "")).strip()
        if not name:
            continue
        cid = "concept_" + re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        if cid in seen_concept_ids:
            continue
        seen_concept_ids.add(cid)

        valid_pids = [p for p in (c.get("paper_ids") or []) if p in papers_meta]
        weight = min(max(float(c.get("weight") or 0.5), 0.1), 1.0)

        nodes.append({
            "id": cid,
            "label": name,
            "type": "concept",
            "metadata": {"papers": valid_pids, "weight": weight},
        })
        for pid in valid_pids:
            edges.append({"source": pid, "target": cid, "weight": weight})

    logger.info(
        "[GRAPH] project=%s papers=%d concepts=%d edges=%d",
        project_id, len(paper_ids), len(seen_concept_ids), len(edges),
    )

    response: dict = {"nodes": nodes, "edges": edges}
    if llm_error:
        response["llm_error"] = llm_error
    return response
