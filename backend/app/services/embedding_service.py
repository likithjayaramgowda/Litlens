"""
Chunking, embedding, and ChromaDB storage for paper text.

Chunk size: 512 tokens ≈ 2 048 characters (4 chars/token approximation).
Overlap:     50 tokens ≈   200 characters.
Model:       all-MiniLM-L6-v2 (384-dim, cosine similarity, ~80 MB on first load).
Collection:  one per user — ``user_{user_id}`` — with cosine distance space.
"""
from __future__ import annotations

import logging

import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

from app.core.config import settings
from app.services.pdf_service import PageText

logger = logging.getLogger(__name__)

_CHUNK_CHARS = 2_048   # ≈ 512 tokens
_OVERLAP_CHARS = 200   # ≈  50 tokens
_MODEL_NAME = "all-MiniLM-L6-v2"
_UPSERT_BATCH = 100    # rows per ChromaDB upsert call

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=_CHUNK_CHARS,
    chunk_overlap=_OVERLAP_CHARS,
)

# Module-level singletons — initialized lazily to avoid startup delay.
_model: SentenceTransformer | None = None
_chroma: chromadb.HttpClient | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info("Loading embedding model '%s'…", _MODEL_NAME)
        _model = SentenceTransformer(_MODEL_NAME)
        logger.info("Embedding model ready.")
    return _model


def _get_chroma() -> chromadb.HttpClient:
    global _chroma
    if _chroma is None:
        host = settings.CHROMA_HOST
        port = settings.CHROMA_PORT
        print(f"[EMBED] Connecting to ChromaDB at {host}:{port}…", flush=True)
        logger.info("Connecting to ChromaDB at %s:%s", host, port)
        client = chromadb.HttpClient(host=host, port=port)
        # Probe the connection immediately so a bad host fails fast here
        # instead of hanging silently inside get_or_create_collection later.
        try:
            client.heartbeat()
            print(f"[EMBED] ChromaDB heartbeat OK ({host}:{port}).", flush=True)
            logger.info("ChromaDB heartbeat OK at %s:%s", host, port)
        except Exception as exc:
            # Clear the cached client so the next call retries the connection.
            print(
                f"[EMBED] ERROR: ChromaDB not reachable at {host}:{port} — {exc}\n"
                f"  If running locally (not Docker), set CHROMA_HOST=localhost and CHROMA_PORT=8001 in .env",
                flush=True,
            )
            raise RuntimeError(
                f"ChromaDB not reachable at {host}:{port}. "
                f"If running locally (not Docker), set CHROMA_HOST=localhost CHROMA_PORT=8001 in .env. "
                f"Original error: {exc}"
            ) from exc
        _chroma = client
    return _chroma


def embed_paper(
    paper_id: str,
    user_id: str,
    paper_title: str,
    pages: list[PageText],
) -> int:
    """
    Chunk, embed, and upsert all pages of a paper into ChromaDB.

    Each chunk gets metadata:
      paper_id, user_id, paper_title, page_number, chunk_index

    Chunk IDs are deterministic: ``{paper_id}_p{page}_c{chunk_index}``
    so re-processing a paper is safe (upsert is idempotent).

    Returns the total number of chunks stored.
    """
    # ── Chunking ──────────────────────────────────────────────────────────────
    print(f"[EMBED] Chunking {len(pages)} pages for paper {paper_id}…", flush=True)
    ids: list[str] = []
    texts: list[str] = []
    metadatas: list[dict] = []
    chunk_index = 0

    for page in pages:
        page_text = page.text.strip()
        if not page_text:
            continue
        for chunk_text in _splitter.split_text(page_text):
            chunk_text = chunk_text.strip()
            if not chunk_text:
                continue
            ids.append(f"{paper_id}_p{page.page}_c{chunk_index}")
            texts.append(chunk_text)
            metadatas.append({
                "paper_id": paper_id,
                "user_id": user_id,
                "paper_title": paper_title,
                "page_number": page.page,
                "chunk_index": chunk_index,
            })
            chunk_index += 1

    if not ids:
        print(f"[EMBED] WARNING: paper {paper_id} produced 0 chunks — nothing to embed.", flush=True)
        logger.warning("Paper %s produced no chunks — nothing to embed.", paper_id)
        return 0

    print(f"[EMBED] {len(ids)} chunks ready. Loading embedding model…", flush=True)

    # ── Embedding ─────────────────────────────────────────────────────────────
    model = _get_model()
    print(f"[EMBED] Encoding {len(texts)} chunks…", flush=True)
    embeddings: list[list[float]] = model.encode(
        texts, show_progress_bar=False, convert_to_numpy=True
    ).tolist()
    print(f"[EMBED] Encoding done. Connecting to ChromaDB…", flush=True)

    # ── ChromaDB upsert ───────────────────────────────────────────────────────
    chroma = _get_chroma()
    collection_name = f"user_{user_id}"
    print(f"[EMBED] Getting/creating collection '{collection_name}'…", flush=True)
    collection = chroma.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    print(f"[EMBED] Upserting {len(ids)} chunks in batches of {_UPSERT_BATCH}…", flush=True)
    for i in range(0, len(ids), _UPSERT_BATCH):
        s = slice(i, i + _UPSERT_BATCH)
        collection.upsert(
            ids=ids[s],
            documents=texts[s],
            embeddings=embeddings[s],
            metadatas=metadatas[s],
        )
        print(f"[EMBED]   upserted batch {i // _UPSERT_BATCH + 1} ({min(i + _UPSERT_BATCH, len(ids))}/{len(ids)})", flush=True)

    print(f"[EMBED] Done — {chunk_index} chunks stored for paper {paper_id}.", flush=True)
    logger.info("Paper %s: %d chunks stored in ChromaDB.", paper_id, chunk_index)
    return chunk_index


def delete_paper_chunks(user_id: str, paper_id: str) -> None:
    """
    Remove all chunks for a paper from the user's ChromaDB collection.
    Best-effort — never raises.
    """
    try:
        chroma = _get_chroma()
        col = chroma.get_or_create_collection(name=f"user_{user_id}")
        col.delete(where={"paper_id": paper_id})
        logger.info("Deleted chunks for paper %s from ChromaDB.", paper_id)
    except Exception as exc:
        logger.warning("Could not delete chunks for paper %s: %s", paper_id, exc)
