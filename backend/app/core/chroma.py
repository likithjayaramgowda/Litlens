"""
Single source of truth for ChromaDB PersistentClient initialization.

All modules that need ChromaDB must import get_chroma() from here.
Data is persisted to backend/chroma_db/ — no external server required.
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Resolves to backend/chroma_db/ regardless of where Python is invoked from.
_CHROMA_PATH = str(Path(__file__).resolve().parent.parent.parent / "chroma_db")

_chroma = None


def get_chroma():
    """Return the shared ChromaDB PersistentClient singleton."""
    global _chroma
    if _chroma is None:
        import chromadb  # lazy — keeps startup fast
        print(f"[CHROMA] Opening PersistentClient at {_CHROMA_PATH}…", flush=True)
        logger.info("Opening ChromaDB PersistentClient at %s", _CHROMA_PATH)
        _chroma = chromadb.PersistentClient(path=_CHROMA_PATH)
        cols = _chroma.list_collections()  # 0.6.x returns strings, not objects
        print(f"[CHROMA] Ready — existing collections: {cols}", flush=True)
        logger.info("ChromaDB ready — existing collections: %s", cols)
    return _chroma
