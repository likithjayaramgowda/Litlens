"""
Paper management endpoints.

POST  /api/v1/papers/upload   — upload one or more PDFs (auth required)
GET   /api/v1/papers/         — list the caller's papers (auth required)
DELETE /api/v1/papers/{id}    — delete a paper (auth required, owner only)
"""
from __future__ import annotations

from typing import Annotated, Any

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from supabase import create_client, Client

from app.core.auth import get_current_user
from app.core.config import settings
from app.services.pdf_service import extract_metadata
from app.services.storage_service import delete_pdf, upload_pdf

router = APIRouter(prefix="/papers", tags=["papers"])

_MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB per file
_PDF_MAGIC = b"%PDF"


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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=list[PaperOut],
    status_code=status.HTTP_201_CREATED,
    summary="Upload one or more PDF files",
)
async def upload_papers(
    user: Annotated[dict, Depends(get_current_user)],
    files: list[UploadFile] = File(..., description="PDF files to upload"),
) -> list[PaperOut]:
    """
    Accept **one or more** PDF files via multipart/form-data.

    For each file:
    1. Validate MIME type and PDF magic bytes.
    2. Parse metadata (title, authors, year, page count) with PyMuPDF.
    3. Upload raw bytes to Supabase Storage bucket ``papers``.
    4. Insert a row into the ``papers`` Postgres table.

    Returns the list of created paper records.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    user_id: str = user["sub"]
    sb = _supabase()
    results: list[PaperOut] = []

    for upload in files:
        fname = upload.filename or "upload.pdf"

        # ── 1. Validate ───────────────────────────────────────────────────────
        content_type = upload.content_type or ""
        if content_type not in ("application/pdf", "application/octet-stream", ""):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"'{fname}': only PDF files are accepted (got {content_type}).",
            )

        raw = await upload.read()

        if len(raw) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"'{fname}': file exceeds the 50 MB limit ({len(raw) // 1_048_576} MB).",
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

        try:
            db_result = sb.table("papers").insert(row).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"'{fname}': database insert failed — {exc}",
            ) from exc

        results.append(PaperOut(**db_result.data[0]))

    return results


@router.get(
    "/",
    response_model=list[PaperOut],
    summary="List the current user's papers",
)
async def list_papers(
    user: Annotated[dict, Depends(get_current_user)],
) -> list[PaperOut]:
    """Return all papers owned by the authenticated user, newest first."""
    user_id: str = user["sub"]
    sb = _supabase()

    try:
        db_result = (
            sb.table("papers")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [PaperOut(**row) for row in db_result.data]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Database query failed — {exc}",
        ) from exc


@router.delete(
    "/{paper_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a paper and its stored file",
)
async def delete_paper(
    paper_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> Response:
    """
    Delete the paper record **and** the raw PDF from Supabase Storage.

    Returns 404 if the paper does not exist or belongs to a different user.
    """
    user_id: str = user["sub"]
    sb = _supabase()

    # Fetch the row first to verify ownership and get the storage path.
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

    # Remove from storage (best-effort — don't fail the delete if storage errors).
    try:
        delete_pdf(sb, result.data["storage_path"])
    except Exception:
        pass

    sb.table("papers").delete().eq("id", paper_id).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
