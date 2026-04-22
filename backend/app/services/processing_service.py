"""
Background processing pipeline: extract → chunk → embed a paper after upload.

Called as a FastAPI BackgroundTask so the upload HTTP response is returned
immediately while processing continues asynchronously.
"""
from __future__ import annotations

import logging
import traceback

import fitz  # PyMuPDF
from supabase import Client

from app.services.embedding_service import embed_paper
from app.services.pdf_service import extract_pages
from app.services.storage_service import download_pdf

logger = logging.getLogger(__name__)


def process_paper(
    sb: Client,
    paper_id: str,
    user_id: str,
    paper_title: str,
    file_bytes: bytes,
    project_id: str | None = None,
) -> None:
    """
    Full pipeline for a single paper.  Must not raise — all exceptions are
    caught, logged, and written to the ``papers`` table as status='error'.

    Steps:
    1. Set status → 'processing'
    2. Extract per-page text with PyMuPDF (reuses file_bytes already in memory)
    3. Chunk + embed + upsert into ChromaDB via embedding_service
    4. Set status → 'ready'

    On any failure → status='error', error_message persisted.
    """
    print(f"[PIPELINE] START process_paper — paper_id={paper_id}", flush=True)
    logger.info("START process_paper — paper_id=%s", paper_id)

    _set_status(sb, paper_id, "processing")
    print(f"[PIPELINE] status -> processing", flush=True)

    try:
        # ── Step 1: PDF text extraction ───────────────────────────────────────
        print(f"[PIPELINE] Opening PDF ({len(file_bytes):,} bytes)…", flush=True)
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = extract_pages(doc)
        doc.close()
        print(f"[PIPELINE] Extracted {len(pages)} pages from PDF.", flush=True)
        logger.info("Paper %s: extracted %d pages.", paper_id, len(pages))

        # ── Step 2: Chunk + embed + store ─────────────────────────────────────
        print(f"[PIPELINE] Starting embed_paper…", flush=True)
        chunk_count = embed_paper(
            paper_id=paper_id,
            user_id=user_id,
            paper_title=paper_title,
            pages=pages,
            project_id=project_id,
        )
        print(f"[PIPELINE] embed_paper done — {chunk_count} chunks stored.", flush=True)
        logger.info(
            "[CHROMA] upsert complete — collection=user_%s paper_id=%s chunks=%d",
            user_id, paper_id, chunk_count,
        )

        _set_status(sb, paper_id, "ready")
        print(f"[PIPELINE] status -> ready", flush=True)
        logger.info("Paper %s processing complete (%d chunks).", paper_id, chunk_count)

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[PIPELINE] ERROR in process_paper for {paper_id}:\n{tb}", flush=True)
        logger.exception("Paper %s: processing failed — %s", paper_id, exc)
        _set_status(sb, paper_id, "error", error_message=str(exc))


def reprocess_paper(
    sb: Client,
    paper_id: str,
    user_id: str,
    paper_title: str,
    storage_path: str,
    project_id: str | None = None,
) -> None:
    """
    Like process_paper but fetches the PDF bytes from Supabase Storage first.

    Used when re-triggering processing for papers that were uploaded before the
    embedding pipeline existed (status='uploaded') or for retrying 'error' papers.
    """
    print(f"[PIPELINE] START reprocess_paper — paper_id={paper_id} path={storage_path}", flush=True)
    logger.info("START reprocess_paper — paper_id=%s", paper_id)

    try:
        print(f"[PIPELINE] Downloading PDF from storage…", flush=True)
        file_bytes = download_pdf(sb, storage_path)
        print(f"[PIPELINE] Downloaded {len(file_bytes):,} bytes.", flush=True)
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[PIPELINE] ERROR downloading PDF for {paper_id}:\n{tb}", flush=True)
        logger.error("Paper %s: failed to download from storage — %s", paper_id, exc)
        _set_status(sb, paper_id, "error", error_message=f"Storage download failed: {exc}")
        return

    process_paper(
        sb=sb,
        paper_id=paper_id,
        user_id=user_id,
        paper_title=paper_title,
        file_bytes=file_bytes,
        project_id=project_id,
    )


def _set_status(
    sb: Client,
    paper_id: str,
    status: str,
    error_message: str | None = None,
) -> None:
    """Update the status (and optionally error_message) for a paper row."""
    row: dict = {"status": status}
    if error_message is not None:
        row["error_message"] = error_message[:500]
    try:
        sb.table("papers").update(row).eq("id", paper_id).execute()
    except Exception as exc:
        print(f"[PIPELINE] WARNING: could not set status={status} for {paper_id}: {exc}", flush=True)
        logger.error(
            "Could not update status for paper %s to '%s': %s",
            paper_id, status, exc,
        )
