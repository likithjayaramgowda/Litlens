"""
One-time script: re-chunk and re-embed all existing papers into ChromaDB.

Run from the project root:
    python backend/scripts/reprocess_papers.py

Or from inside backend/:
    python scripts/reprocess_papers.py

What it does:
  1. Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the shared .env file.
  2. Queries all papers with status = 'ready' (skips errors/pending).
  3. For each paper, downloads the PDF from Supabase Storage and runs the full
     chunk → embed → ChromaDB upsert pipeline (same code the upload endpoint uses).
  4. Prints a summary: processed count, skipped count, any errors.
"""
from __future__ import annotations

import sys
import os
from pathlib import Path

# ── Make the backend package importable regardless of cwd ────────────────────
# This script lives at backend/scripts/reprocess_papers.py.
# Add backend/ (parent of this file's parent) to sys.path so `from app.*` works.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

# ── Load .env before importing settings ──────────────────────────────────────
# The .env file lives one level above backend/ (the project root).
_ENV_FILE = _BACKEND_DIR.parent / ".env"
if _ENV_FILE.exists():
    from dotenv import load_dotenv
    load_dotenv(str(_ENV_FILE))
    print(f"[REPROCESS] Loaded .env from {_ENV_FILE}", flush=True)
else:
    print(f"[REPROCESS] WARNING: .env not found at {_ENV_FILE} — relying on environment variables", flush=True)

# ── Now it's safe to import app modules ──────────────────────────────────────
from supabase import create_client

from app.core.config import settings
from app.services.processing_service import reprocess_paper


def main() -> None:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        print("[REPROCESS] ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Check your .env file.", flush=True)
        sys.exit(1)

    sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

    # ── Fetch all ready papers ────────────────────────────────────────────────
    print("[REPROCESS] Fetching all papers that have a storage_path from Supabase…", flush=True)
    result = (
        sb.table("papers")
        .select("id, user_id, title, storage_path, project_id, status")
        .not_.is_("storage_path", "null")
        .execute()
    )
    papers = [p for p in (result.data or []) if p.get("storage_path")]
    print(f"[REPROCESS] Found {len(papers)} papers (statuses: {set(p['status'] for p in papers)}).", flush=True)

    if not papers:
        print("[REPROCESS] Nothing to process. Exiting.", flush=True)
        return

    processed = 0
    skipped = 0
    errors: list[dict] = []

    for i, paper in enumerate(papers, start=1):
        paper_id = paper.get("id", "unknown")
        title = paper.get("title") or "Untitled"
        storage_path = paper.get("storage_path") or ""
        user_id = paper.get("user_id", "")
        project_id = paper.get("project_id")

        print(
            f"\n[REPROCESS] [{i}/{len(papers)}] paper_id={paper_id[:8]}… "
            f'title="{title[:60]}" storage_path={storage_path!r}',
            flush=True,
        )

        if not storage_path:
            print(f"[REPROCESS]   SKIP — no storage_path", flush=True)
            skipped += 1
            continue

        if not user_id:
            print(f"[REPROCESS]   SKIP — no user_id", flush=True)
            skipped += 1
            continue

        try:
            reprocess_paper(
                sb=sb,
                paper_id=paper_id,
                user_id=user_id,
                paper_title=title,
                storage_path=storage_path,
                project_id=project_id,
            )
            processed += 1
            print(f"[REPROCESS]   OK", flush=True)
        except Exception as exc:
            print(f"[REPROCESS]   ERROR — {exc}", flush=True)
            errors.append({"paper_id": paper_id, "title": title, "error": str(exc)})

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}", flush=True)
    print(f"[REPROCESS] DONE — processed={processed}  skipped={skipped}  errors={len(errors)}", flush=True)
    if errors:
        print("[REPROCESS] Failed papers:", flush=True)
        for e in errors:
            print(f"  paper_id={e['paper_id'][:8]}… title={e['title']!r} error={e['error']}", flush=True)
    print(f"{'='*60}", flush=True)

    # ── Quick ChromaDB verification ───────────────────────────────────────────
    print("\n[REPROCESS] ChromaDB collection summary after reprocessing:", flush=True)
    try:
        from app.core.chroma import get_chroma
        chroma = get_chroma()
        for col_name in chroma.list_collections():  # 0.6.x returns strings
            count = chroma.get_collection(col_name).count()
            print(f"  collection={col_name}  chunks={count}", flush=True)
    except Exception as exc:
        print(f"[REPROCESS] Could not read ChromaDB collections: {exc}", flush=True)


if __name__ == "__main__":
    main()
