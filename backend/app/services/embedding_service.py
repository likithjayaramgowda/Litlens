"""
Chunking, embedding, and pgvector storage for paper text.

Chunk size: 512 tokens ≈ 2 048 characters (4 chars/token approximation).
Overlap:     50 tokens ≈   200 characters.
Model:       all-MiniLM-L6-v2 (384-dim, cosine similarity, ~80 MB on first load).
Storage:     Supabase paper_chunks table via upsert (chunk_id is the conflict key).
"""
from __future__ import annotations

import logging

from langchain_text_splitters import RecursiveCharacterTextSplitter
from supabase import Client

from app.services.pdf_service import PageText

logger = logging.getLogger(__name__)

_CHUNK_CHARS = 2_048   # ≈ 512 tokens
_OVERLAP_CHARS = 200   # ≈  50 tokens
_MODEL_NAME = "all-MiniLM-L6-v2"
_UPSERT_BATCH = 50     # rows per Supabase upsert call

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=_CHUNK_CHARS,
    chunk_overlap=_OVERLAP_CHARS,
)

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer  # lazy — keeps startup fast
        logger.info("Loading embedding model '%s'…", _MODEL_NAME)
        _model = SentenceTransformer(_MODEL_NAME)
        logger.info("Embedding model ready.")
    return _model


def embed_paper(
    sb: Client,
    paper_id: str,
    user_id: str,
    paper_title: str,
    pages: list[PageText],
    project_id: str | None = None,
) -> int:
    """
    Chunk, embed, and upsert all pages of a paper into the paper_chunks table.

    Chunk IDs are deterministic: ``{paper_id}_p{page}_c{chunk_index}``
    so re-processing a paper is safe (upsert on chunk_id is idempotent).

    Returns the total number of chunks stored.
    """
    print(f"[EMBED] Chunking {len(pages)} pages for paper {paper_id}…", flush=True)

    chunk_ids: list[str] = []
    texts: list[str] = []
    page_numbers: list[int] = []
    chunk_indexes: list[int] = []
    chunk_index = 0

    for page in pages:
        page_text = page.text.strip()
        if not page_text:
            continue
        for chunk_text in _splitter.split_text(page_text):
            chunk_text = chunk_text.strip()
            if not chunk_text:
                continue
            chunk_ids.append(f"{paper_id}_p{page.page}_c{chunk_index}")
            texts.append(chunk_text)
            page_numbers.append(page.page)
            chunk_indexes.append(chunk_index)
            chunk_index += 1

    if not chunk_ids:
        print(f"[EMBED] WARNING: paper {paper_id} produced 0 chunks — nothing to embed.", flush=True)
        logger.warning("Paper %s produced no chunks — nothing to embed.", paper_id)
        return 0

    print(f"[EMBED] {len(chunk_ids)} chunks ready. Encoding with {_MODEL_NAME}…", flush=True)

    model = _get_model()
    embeddings: list[list[float]] = model.encode(
        texts, show_progress_bar=False, convert_to_numpy=True
    ).tolist()

    print(f"[EMBED] Encoding done. Upserting to Supabase pgvector…", flush=True)

    rows = [
        {
            "chunk_id":    chunk_ids[i],
            "paper_id":    paper_id,
            "user_id":     user_id,
            "project_id":  project_id,
            "paper_title": paper_title,
            "page_number": page_numbers[i],
            "chunk_index": chunk_indexes[i],
            "content":     texts[i],
            "embedding":   embeddings[i],
        }
        for i in range(len(chunk_ids))
    ]

    for start in range(0, len(rows), _UPSERT_BATCH):
        batch = rows[start : start + _UPSERT_BATCH]
        sb.table("paper_chunks").upsert(batch, on_conflict="chunk_id").execute()
        print(
            f"[EMBED]   upserted batch {start // _UPSERT_BATCH + 1} "
            f"({min(start + _UPSERT_BATCH, len(rows))}/{len(rows)})",
            flush=True,
        )

    print(f"[EMBED] Done — {chunk_index} chunks stored for paper {paper_id}.", flush=True)
    logger.info("Paper %s: %d chunks stored in pgvector.", paper_id, chunk_index)
    return chunk_index


def delete_paper_chunks(sb: Client, user_id: str, paper_id: str) -> None:
    """
    Remove all chunks for a paper from paper_chunks.
    Best-effort — never raises.
    """
    try:
        sb.table("paper_chunks").delete().eq("paper_id", paper_id).eq("user_id", user_id).execute()
        logger.info("Deleted chunks for paper %s from pgvector.", paper_id)
    except Exception as exc:
        logger.warning("Could not delete chunks for paper %s: %s", paper_id, exc)
