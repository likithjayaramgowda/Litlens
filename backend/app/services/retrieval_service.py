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

from app.services.embedding_service import _get_model, _get_chroma

logger = logging.getLogger(__name__)


def retrieve_chunks(
    user_id: str,
    query: str,
    n_results: int = 15,
) -> list[dict]:
    """
    Search the user's ChromaDB collection for the top-N most relevant chunks.

    Returns a list of dicts with keys:
        text, paper_id, paper_title, page_number, relevance_score (0–1)

    Returns an empty list if the user has no papers or ChromaDB is unreachable.
    """
    try:
        model = _get_model()
        embedding: list[float] = model.encode(
            [query], show_progress_bar=False, convert_to_numpy=True
        )[0].tolist()

        chroma = _get_chroma()
        collection_name = f"user_{user_id}"

        try:
            collection = chroma.get_collection(name=collection_name)
        except Exception:
            logger.info("No ChromaDB collection found for user %s — no papers uploaded.", user_id)
            return []

        count = collection.count()
        if count == 0:
            return []

        actual_n = min(n_results, count)
        results = collection.query(
            query_embeddings=[embedding],
            n_results=actual_n,
            include=["documents", "metadatas", "distances"],
        )

        chunks: list[dict] = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            # ChromaDB cosine distance → cosine similarity (higher = more relevant)
            chunks.append({
                "text": doc,
                "paper_id": meta.get("paper_id", ""),
                "paper_title": meta.get("paper_title", "Unknown Paper"),
                "page_number": int(meta.get("page_number", 1)),
                "relevance_score": round(1.0 - float(dist), 4),
            })

        logger.info(
            "[RETRIEVAL] user=%s query=%r → %d chunks (top score %.3f)",
            user_id,
            query[:60],
            len(chunks),
            chunks[0]["relevance_score"] if chunks else 0.0,
        )
        return chunks

    except Exception as exc:
        logger.warning("Retrieval failed for user %s: %s", user_id, exc)
        return []


# ── System prompt builder ─────────────────────────────────────────────────────

_NO_PAPERS_PROMPT = (
    "You are LitLens, an AI research assistant.\n"
    "The user has not uploaded any papers yet — their library is empty.\n"
    "Kindly tell them to go to the Dashboard and upload some PDF papers first."
)


def build_system_prompt(chunks: list[dict]) -> tuple[str, list[dict]]:
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
        return _NO_PAPERS_PROMPT, []

    # ── Deduplicate sources (by paper_id + page_number) ───────────────────────
    seen: set[tuple[str, int]] = set()
    sources: list[dict] = []
    for chunk in chunks:
        key = (chunk["paper_id"], chunk["page_number"])
        if key not in seen:
            seen.add(key)
            sources.append({
                "paper_id": chunk["paper_id"],
                "paper_title": chunk["paper_title"],
                "page_number": chunk["page_number"],
                "excerpt": chunk["text"][:300].strip(),
                "relevance_score": chunk["relevance_score"],
            })

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

    system_prompt = f"""You are LitLens, an AI research assistant helping researchers understand and synthesize academic papers.

You have access to relevant excerpts from the user's uploaded papers. Use only these excerpts to answer — do not fabricate information.

INSTRUCTIONS:
- Cite every claim with: (Paper Title, p. PAGE_NUMBER)
- When multiple papers agree, note the consensus explicitly
- When papers contradict each other, highlight the disagreement and explain both positions
- If the answer is not in the excerpts, say exactly: "I couldn't find this in your uploaded papers"
- Be concise but thorough; use bullet points for multi-part answers
- Never invent paper titles, authors, or page numbers not present in the excerpts

PAPER EXCERPTS:
{context}"""

    return system_prompt, sources
