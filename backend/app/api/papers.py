"""
Paper management endpoints.

POST   /api/v1/papers/upload   — upload one or more PDFs (auth required)
GET    /api/v1/papers/         — list the caller's papers (auth required)
DELETE /api/v1/papers/{id}     — delete a paper (auth required, owner only)

After a successful upload, a FastAPI BackgroundTask runs the chunking +
embedding pipeline asynchronously, updating the paper status from
'uploaded' → 'processing' → 'ready' (or 'error').
"""
from __future__ import annotations

import re
from typing import Annotated, Any

import fitz  # PyMuPDF
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from supabase import create_client, Client

from app.core.auth import get_current_user
from app.core.config import settings
from app.services.pdf_service import extract_metadata
from app.services.processing_service import process_paper, reprocess_paper
from app.services.storage_service import delete_pdf, upload_pdf
from app.services.embedding_service import delete_paper_chunks

router = APIRouter(prefix="/papers", tags=["papers"])

_MAX_FILE_BYTES = 100 * 1024 * 1024  # 100 MB per file
_PDF_MAGIC = b"%PDF"
_UNSAFE_FILENAME_CHARS = re.compile(r'[/\\:\*\?"<>|\x00-\x1f]')


def _sanitize_filename(name: str) -> str:
    """Strip path separators, null bytes, and shell-unsafe characters."""
    name = _UNSAFE_FILENAME_CHARS.sub("", name)
    return name.strip()[:255] or "upload.pdf"


# ── Supabase service-role client ──────────────────────────────────────────────

def _supabase() -> Client:
    """Return a service-role Supabase client (bypasses RLS for server ops)."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase is not configured on the server.",
        )
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# ── Response model ────────────────────────────────────────────────────────────

class PaperOut(BaseModel):
    id: str
    title: str
    authors: str
    year: int | None
    filename: str
    storage_path: str
    file_size_bytes: int
    page_count: int
    status: str
    created_at: str
    project_id: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=list[PaperOut],
    status_code=status.HTTP_201_CREATED,
    summary="Upload one or more PDF files",
)
async def upload_papers(
    background_tasks: BackgroundTasks,
    user: Annotated[dict, Depends(get_current_user)],
    files: list[UploadFile] = File(..., description="PDF files to upload"),
    project_id: str | None = Form(None, description="Project to assign these papers to"),
) -> list[PaperOut]:
    """
    Accept **one or more** PDF files via multipart/form-data.

    For each file:
    1. Validate MIME type and PDF magic bytes.
    2. Parse metadata (title, authors, year, page count) with PyMuPDF.
    3. Upload raw bytes to Supabase Storage bucket ``Papers``.
    4. Insert a row into the ``papers`` Postgres table (status='uploaded').
    5. Enqueue a BackgroundTask to chunk, embed, and index the paper
       (status transitions: uploaded → processing → ready | error).

    Returns the list of created paper records immediately (status='uploaded').
    The frontend should poll GET /papers/ until status='ready'.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    user_id: str = user["sub"]
    sb = _supabase()
    results: list[PaperOut] = []

    for upload in files:
        fname = _sanitize_filename(upload.filename or "upload.pdf")

        # ── 1. Validate ───────────────────────────────────────────────────────
        content_type = upload.content_type or ""
        if content_type not in ("application/pdf", "application/octet-stream", ""):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"'{fname}': only PDF files are accepted (got {content_type}).",
            )

        raw = await upload.read()

        if len(raw) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{fname}': file is empty.",
            )

        if len(raw) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"'{fname}': file exceeds the 100 MB limit ({len(raw) // 1_048_576} MB).",
            )

        if not raw.startswith(_PDF_MAGIC):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"'{fname}': file does not appear to be a valid PDF.",
            )

        # ── 2. Parse PDF ──────────────────────────────────────────────────────
        try:
            doc = fitz.open(stream=raw, filetype="pdf")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"'{fname}': could not open PDF — {exc}",
            ) from exc

        meta = extract_metadata(doc, fname)
        doc.close()

        # ── 3. Upload to Storage ──────────────────────────────────────────────
        try:
            storage_path = upload_pdf(
                client=sb,
                user_id=user_id,
                filename=fname,
                file_bytes=raw,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"'{fname}': storage upload failed — {exc}",
            ) from exc

        # ── 4. Persist metadata ───────────────────────────────────────────────
        row: dict[str, Any] = {
            "user_id": user_id,
            "title": meta.title,
            "authors": meta.authors,
            "year": meta.year,
            "filename": fname,
            "storage_path": storage_path,
            "file_size_bytes": len(raw),
            "page_count": meta.page_count,
            "status": "uploaded",
        }
        if project_id:
            row["project_id"] = project_id

        try:
            db_result = sb.table("papers").insert(row).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"'{fname}': database insert failed — {exc}",
            ) from exc

        paper = PaperOut(**db_result.data[0])
        results.append(paper)

        # ── 5. Enqueue background processing ─────────────────────────────────
        # Pass raw bytes so the background task can re-open the PDF for text
        # extraction without another Storage round-trip.
        background_tasks.add_task(
            process_paper,
            sb=sb,
            paper_id=paper.id,
            user_id=user_id,
            paper_title=paper.title,
            file_bytes=raw,
            project_id=project_id or None,
        )

    return results


@router.get(
    "/",
    response_model=list[PaperOut],
    summary="List the current user's papers",
)
async def list_papers(
    background_tasks: BackgroundTasks,
    user: Annotated[dict, Depends(get_current_user)],
    project_id: str | None = Query(None, description="Filter papers by project"),
) -> list[PaperOut]:
    """
    Return papers owned by the authenticated user, newest first.

    Pass ?project_id=<uuid> to filter by project.

    Any papers still in status='uploaded' (i.e. uploaded before the embedding
    pipeline existed, or whose background task never ran) are automatically
    re-queued: their status is immediately flipped to 'processing' so that
    subsequent polls do not re-trigger them.
    """
    user_id: str = user["sub"]
    sb = _supabase()

    try:
        query = (
            sb.table("papers")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
        )
        if project_id:
            query = query.eq("project_id", project_id)
        db_result = query.execute()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Database query failed — {exc}",
        ) from exc

    papers: list[PaperOut] = []
    for row in db_result.data:
        paper = PaperOut(**row)

        if paper.status == "uploaded":
            # Atomically flip to 'processing' before enqueueing so the next
            # poll does not trigger this branch again.
            try:
                sb.table("papers").update({"status": "processing"}).eq("id", paper.id).execute()
                paper = PaperOut(**{**row, "status": "processing"})
            except Exception:
                pass  # best-effort; will retry next poll

            background_tasks.add_task(
                reprocess_paper,
                sb=sb,
                paper_id=paper.id,
                user_id=user_id,
                paper_title=paper.title,
                storage_path=row["storage_path"],
                project_id=row.get("project_id"),
            )

        papers.append(paper)

    return papers


@router.post(
    "/{paper_id}/reprocess",
    response_model=PaperOut,
    summary="Re-trigger chunking + embedding for a paper",
)
async def reprocess_paper_endpoint(
    paper_id: str,
    background_tasks: BackgroundTasks,
    user: Annotated[dict, Depends(get_current_user)],
) -> PaperOut:
    """
    Manually re-queue a paper for chunking and embedding.

    Useful for retrying papers whose status is 'error' or 'uploaded'.
    Returns the updated paper record (status='processing') immediately;
    the pipeline runs in the background.
    """
    user_id: str = user["sub"]
    sb = _supabase()

    result = (
        sb.table("papers")
        .select("*")
        .eq("id", paper_id)
        .maybe_single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")

    if result.data["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")

    if result.data["status"] == "processing":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Paper is already being processed.",
        )

    sb.table("papers").update({"status": "processing"}).eq("id", paper_id).execute()
    paper = PaperOut(**{**result.data, "status": "processing"})

    background_tasks.add_task(
        reprocess_paper,
        sb=sb,
        paper_id=paper.id,
        user_id=user_id,
        paper_title=paper.title,
        storage_path=result.data["storage_path"],
    )

    return paper


@router.delete(
    "/{paper_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a paper, its stored file, and its embeddings",
)
async def delete_paper(
    paper_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> Response:
    """
    Delete the paper record, raw PDF from Supabase Storage, and all
    ChromaDB chunks.

    Returns 404 if the paper does not exist or belongs to a different user.
    Storage and ChromaDB deletions are best-effort — they do not block the
    DB row deletion.
    """
    user_id: str = user["sub"]
    sb = _supabase()

    result = (
        sb.table("papers")
        .select("id, user_id, storage_path")
        .eq("id", paper_id)
        .maybe_single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")

    if result.data["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")

    # Remove PDF from storage (best-effort).
    try:
        delete_pdf(sb, result.data["storage_path"])
    except Exception:
        pass

    # Remove embeddings from ChromaDB (best-effort).
    delete_paper_chunks(user_id=user_id, paper_id=paper_id)

    sb.table("papers").delete().eq("id", paper_id).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
