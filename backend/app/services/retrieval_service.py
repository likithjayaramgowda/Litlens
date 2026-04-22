"""
Semantic retrieval over a user's ChromaDB collection.

Uses the same all-MiniLM-L6-v2 model as the embedding pipeline so query
vectors are in the same space as the stored chunk vectors.

Public surface
--------------
retrieve_chunks(user_id, query, n_results)
    → list of chunk dicts: text, paper_id, paper_title, page_number, relevance_score

build_system_prompt(chunks)
    → (system_prompt: str, sources: list[dict])
    sources: deduplicated list of {paper_id, paper_title, page_number, excerpt, relevance_score}
"""
from __future__ import annotations

import logging

from app.core.chroma import get_chroma as _get_chroma
from app.services.embedding_service import _get_model

logger = logging.getLogger(__name__)


def retrieve_chunks(
    user_id: str,
    query: str,
    n_results: int = 15,
    paper_ids: list[str] | None = None,
    project_id: str | None = None,
) -> list[dict]:
    """
    Search the user's ChromaDB collection for the top-N most relevant chunks.

    Strategy
    --------
    1. Semantic search via collection.query() + sentence-transformers embeddings.
    2. If the embedding model fails or returns 0 results, fall back to
       collection.get() with a paper_id metadata filter (same approach as
       compare.py, which always works).  This ensures the chat pipeline
       always injects paper content even when the model is unavailable.

    Returns a list of dicts with keys:
        text, paper_id, paper_title, page_number, relevance_score (0–1)

    Returns an empty list if the user has no papers or ChromaDB is unreachable.
    """
    # ── Connect to ChromaDB and open the collection ───────────────────────────
    try:
        chroma = _get_chroma()
    except Exception as exc:
        print(f"[RETRIEVAL] ChromaDB unreachable: {exc}", flush=True)
        logger.warning("[RETRIEVAL] ChromaDB unreachable for user %s: %s", user_id, exc)
        return []

    collection_name = f"user_{user_id}"
    try:
        collection = chroma.get_collection(name=collection_name)
    except Exception:
        print(f"[RETRIEVAL] No ChromaDB collection '{collection_name}' — user has no papers.", flush=True)
        logger.info("No ChromaDB collection found for user %s — no papers uploaded.", user_id)
        return []

    count = collection.count()
    print(f"[RETRIEVAL] collection={collection_name} count={count} paper_ids={paper_ids} project_id={project_id}", flush=True)
    if count == 0:
        return []

    actual_n = min(n_results, count)

    # Build ChromaDB where-filter.
    #
    # Priority: paper_ids > project_id.
    #
    # paper_id is ALWAYS stored in chunk metadata; project_id is only stored
    # when the paper was originally embedded with a project_id.  Using
    # project_id as the primary filter causes a ChromaDB ValueError ("Found 0
    # results") for any paper whose chunks were embedded without project_id
    # (e.g. auto-reprocessed papers, or papers uploaded before project_id
    # metadata was introduced).
    #
    # paper_ids come from get_project_paper_ids() which already enforces
    # project+user ownership at the Supabase level.
    where: dict | None = None
    if paper_ids:
        if len(paper_ids) == 1:
            where = {"paper_id": paper_ids[0]}
        else:
            where = {"paper_id": {"$in": paper_ids}}
    elif project_id:
        where = {"project_id": project_id}

    logger.info(
        "[RETRIEVAL] user=%s filter=%s n_results=%d collection_count=%d",
        user_id,
        f"paper_ids({len(paper_ids)})" if paper_ids else (f"project_id={project_id}" if project_id else "ALL"),
        actual_n,
        count,
    )

    # ── Path 1: semantic search via embeddings ────────────────────────────────
    balanced: list[dict] = []
    embedding: list[float] | None = None

    try:
        model = _get_model()
        embedding = model.encode(
            [query], show_progress_bar=False, convert_to_numpy=True
        )[0].tolist()
        print(f"[RETRIEVAL] Embedding computed OK, running collection.query()…", flush=True)

        query_kwargs: dict = {
            "query_embeddings": [embedding],
            "n_results": actual_n,
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            query_kwargs["where"] = where

        try:
            results = collection.query(**query_kwargs)
        except Exception as primary_exc:
            print(f"[RETRIEVAL] collection.query() failed: {primary_exc}", flush=True)
            logger.warning("[RETRIEVAL] Primary query failed (%s) — skipping to coverage pass", primary_exc)
            results = {"documents": [[]], "metadatas": [[]], "distances": [[]]}

        chunks: list[dict] = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            chunks.append({
                "text": doc,
                "paper_id": meta.get("paper_id", ""),
                "paper_title": meta.get("paper_title", "Unknown Paper"),
                "page_number": int(meta.get("page_number", 1)),
                "relevance_score": round(1.0 - float(dist), 4),
            })

        # Keep at most top-3 chunks per paper so no single paper dominates context
        per_paper: dict[str, int] = {}
        for c in chunks:
            pid = c["paper_id"]
            if per_paper.get(pid, 0) < 3:
                balanced.append(c)
                per_paper[pid] = per_paper.get(pid, 0) + 1

        # Minimum-coverage pass: guarantee every paper gets ≥2 chunks
        if paper_ids and embedding is not None:
            covered_pids = {c["paper_id"] for c in balanced}
            missing_pids = [pid for pid in paper_ids if pid not in covered_pids]
            for missing_pid in missing_pids:
                try:
                    fill = collection.query(
                        query_embeddings=[embedding],
                        n_results=2,
                        where={"paper_id": missing_pid},
                        include=["documents", "metadatas", "distances"],
                    )
                    fill_docs = fill.get("documents", [[]])[0]
                    fill_metas = fill.get("metadatas", [[]])[0]
                    fill_dists = fill.get("distances", [[]])[0]
                    if fill_docs:
                        for doc, meta, dist in zip(fill_docs, fill_metas, fill_dists):
                            balanced.append({
                                "text": doc,
                                "paper_id": meta.get("paper_id", ""),
                                "paper_title": meta.get("paper_title", "Unknown Paper"),
                                "page_number": int(meta.get("page_number", 1)),
                                "relevance_score": round(1.0 - float(dist), 4),
                            })
                        logger.info("[RETRIEVAL] Min-coverage fill: paper=%s added %d chunks", missing_pid, len(fill_docs))
                except Exception as fill_exc:
                    logger.warning("[RETRIEVAL] Min-coverage query failed for paper %s: %s", missing_pid, fill_exc)

        print(f"[RETRIEVAL] Semantic path → {len(balanced)} chunks", flush=True)

    except Exception as embed_exc:
        print(f"[RETRIEVAL] Embedding/semantic path failed: {embed_exc} — will use fallback", flush=True)
        logger.warning("[RETRIEVAL] Embedding path failed for user %s: %s", user_id, embed_exc)

    # ── Path 2: direct collection.get() fallback (same as compare.py) ─────────
    # Used when: (a) model failed to load, or (b) semantic search returned 0 chunks.
    # Only applies when we have specific paper_ids to filter on.
    if not balanced and paper_ids:
        print(f"[RETRIEVAL] Falling back to collection.get() for {len(paper_ids)} paper(s)", flush=True)
        logger.warning("[RETRIEVAL] Semantic search empty — falling back to collection.get() for paper_ids")
        try:
            fb_where = (
                {"paper_id": paper_ids[0]}
                if len(paper_ids) == 1
                else {"paper_id": {"$in": paper_ids}}
            )
            fb_result = collection.get(where=fb_where, include=["documents", "metadatas"])
            fb_docs: list[str] = fb_result.get("documents") or []
            fb_metas: list[dict] = fb_result.get("metadatas") or []

            # Up to 3 chunks per paper, same cap as semantic path
            per_paper_fb: dict[str, int] = {}
            for doc, meta in zip(fb_docs, fb_metas):
                pid = meta.get("paper_id", "")
                if per_paper_fb.get(pid, 0) < 3:
                    balanced.append({
                        "text": doc,
                        "paper_id": pid,
                        "paper_title": meta.get("paper_title", "Unknown Paper"),
                        "page_number": int(meta.get("page_number", 1)),
                        "relevance_score": 0.5,  # no semantic score available
                    })
                    per_paper_fb[pid] = per_paper_fb.get(pid, 0) + 1

            print(f"[RETRIEVAL] Fallback collection.get() → {len(balanced)} chunks", flush=True)
        except Exception as fb_exc:
            print(f"[RETRIEVAL] Fallback collection.get() also failed: {fb_exc}", flush=True)
            logger.warning("[RETRIEVAL] Fallback get() failed: %s", fb_exc)

    logger.info(
        "[RETRIEVAL] user=%s query=%r → %d chunks (top score %.3f)",
        user_id,
        query[:60],
        len(balanced),
        balanced[0]["relevance_score"] if balanced else 0.0,
    )
    return balanced


def get_paper_chunks_direct(user_id: str, paper_id: str, limit: int = 4) -> list[str]:
    """
    Fetch raw chunk text for a specific paper using metadata filter only —
    no semantic search, no embedding required.  Used by the compare endpoint
    as a reliable fallback when the semantic query returns nothing.

    Strategy:
      1. collection.get(where={"paper_id": paper_id}) — fast ChromaDB metadata filter
      2. If that fails (some ChromaDB versions reject where on get()), fetch all
         docs and filter in Python — slower but always works.
    """
    try:
        chroma = _get_chroma()
        try:
            col = chroma.get_collection(name=f"user_{user_id}")
        except Exception:
            logger.info("[RETRIEVAL] No collection for user %s", user_id)
            return []

        # Primary: metadata where-filter
        try:
            results = col.get(
                where={"paper_id": paper_id},
                include=["documents"],
                limit=limit,
            )
            docs: list[str] = results.get("documents") or []
            if docs:
                logger.info("[RETRIEVAL] Direct get (filter): paper=%s → %d chunks", paper_id, len(docs))
                return docs[:limit]
        except Exception as exc:
            logger.warning("[RETRIEVAL] Where-filter get failed for paper %s: %s", paper_id, exc)

        # Fallback: fetch full collection, filter in Python
        logger.info("[RETRIEVAL] Python-filter fallback for paper %s", paper_id)
        all_results = col.get(include=["documents", "metadatas"])
        all_docs: list[str] = all_results.get("documents") or []
        all_metas: list[dict] = all_results.get("metadatas") or []
        filtered = [
            doc
            for doc, meta in zip(all_docs, all_metas)
            if meta.get("paper_id") == paper_id
        ]
        logger.info("[RETRIEVAL] Python filter: paper=%s → %d chunks", paper_id, len(filtered))
        return filtered[:limit]

    except Exception as exc:
        logger.warning("[RETRIEVAL] Direct get failed for paper %s: %s", paper_id, exc)
        return []


# ── System prompt builder ─────────────────────────────────────────────────────

_NO_PAPERS_PROMPT = (
    "You are LitLens, an AI research assistant.\n"
    "The user has not uploaded any papers yet — their library is empty.\n"
    "Kindly tell them to go to the Dashboard and upload some PDF papers first."
)

_NO_PAPERS_IN_PROJECT_PROMPT = (
    "You are LitLens, an AI research assistant.\n"
    "This project has no papers yet — go to the Papers tab and upload PDFs first."
)


def build_system_prompt(
    chunks: list[dict],
    project_scoped: bool = False,
) -> tuple[str, list[dict]]:
    """
    Build a system prompt from retrieved chunks and a deduplicated sources list.

    Returns
    -------
    system_prompt : str
        Full system prompt including paper excerpts.
    sources : list[dict]
        Deduplicated list, one entry per unique (paper_id, page_number) pair:
        {paper_id, paper_title, page_number, excerpt (≤300 chars), relevance_score}
    """
    if not chunks:
        prompt = _NO_PAPERS_IN_PROJECT_PROMPT if project_scoped else _NO_PAPERS_PROMPT
        return prompt, []

    # ── Deduplicate sources by paper_id only — one card per paper ────────────
    # Use the highest-relevance chunk as the representative for each paper.
    best_by_paper: dict[str, dict] = {}
    for chunk in chunks:
        pid = chunk["paper_id"]
        if pid not in best_by_paper or chunk["relevance_score"] > best_by_paper[pid]["relevance_score"]:
            best_by_paper[pid] = chunk

    sources: list[dict] = [
        {
            "paper_id": c["paper_id"],
            "paper_title": c["paper_title"],
            "page_number": c["page_number"],
            "excerpt": c["text"][:300].strip(),
            "relevance_score": c["relevance_score"],
        }
        for c in sorted(best_by_paper.values(), key=lambda x: x["relevance_score"], reverse=True)
    ]

    # ── Group chunks by paper for the context block ───────────────────────────
    papers: dict[str, list[dict]] = {}
    for chunk in chunks:
        pid = chunk["paper_id"]
        if pid not in papers:
            papers[pid] = []
        papers[pid].append(chunk)

    context_parts: list[str] = []
    for pid, paper_chunks in papers.items():
        title = paper_chunks[0]["paper_title"]
        context_parts.append(f'=== Paper: "{title}" ===')
        for c in sorted(paper_chunks, key=lambda x: x["page_number"]):
            context_parts.append(f"[Page {c['page_number']}]\n{c['text']}")
        context_parts.append("")

    context = "\n".join(context_parts)

    paper_count = len(papers)
    system_prompt = f"""You are LitLens, an AI research assistant helping researchers understand and synthesize academic papers.

You have access to relevant excerpts from {paper_count} paper{"s" if paper_count != 1 else ""} uploaded by the user. Use only these excerpts to answer — do not fabricate information.

INSTRUCTIONS:
- You MUST reference ALL {paper_count} paper{"s" if paper_count != 1 else ""} provided in the context. Do not skip any paper even if it seems less directly relevant to the question — always acknowledge what each paper contributes.
- Cite every claim with: (Paper Title, p. PAGE_NUMBER)
- When multiple papers agree, note the consensus explicitly
- When papers contradict each other, highlight the disagreement and explain both positions
- If the answer is not in the excerpts, say exactly: "I couldn't find this in your uploaded papers"
- Be concise but thorough; use bullet points for multi-part answers
- Never invent paper titles, authors, or page numbers not present in the excerpts

PAPER EXCERPTS:
{context}"""

    return system_prompt, sources
