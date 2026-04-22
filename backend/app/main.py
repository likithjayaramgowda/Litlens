import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.auth import get_current_user

from app.api.routes import router
from app.api.papers import router as papers_router
from app.api.llm import router as llm_router
from app.api.chat import router as chat_router
from app.api.projects import router as projects_router
from app.api.citations import router as citations_router
from app.api.graph import router as graph_router
from app.api.compare import router as compare_router
from app.api.timeline import router as timeline_router
from app.api.themes import router as themes_router
from app.core.config import settings

# ── Logging setup ─────────────────────────────────────────────────────────────
# Uvicorn configures its own loggers but does NOT add handlers to the root
# logger or to app.* loggers. Wire them up explicitly so all logger.info/error
# calls from app.services.* are visible in the terminal.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(name)s — %(message)s",
)
# Quiet down noisy third-party libraries.
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logging.getLogger("chromadb").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="LitLens API",
    version="0.1.0",
    description="Backend API for LitLens — intelligent document search and analysis.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all for any exception that escapes route handlers.

    Registering this handler with FastAPI means it runs inside ExceptionMiddleware,
    which is wrapped by CORSMiddleware — so CORS headers ARE present on the response.
    Without this, unhandled exceptions bubble up to Starlette's ServerErrorMiddleware
    (outside CORSMiddleware) and the browser sees a CORS error on top of the 500.
    """
    logger.exception("Unhandled exception: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
    )


app.include_router(router, prefix="/api/v1")
app.include_router(papers_router, prefix="/api/v1")
app.include_router(llm_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(citations_router, prefix="/api/v1")
app.include_router(graph_router, prefix="/api/v1")
app.include_router(compare_router, prefix="/api/v1")
app.include_router(timeline_router, prefix="/api/v1")
app.include_router(themes_router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/debug/conversations")
async def debug_conversations(
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Debug endpoint — returns all conversations for the current user with project_id."""
    from supabase import create_client
    user_id: str = user["sub"]
    try:
        sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
        result = (
            sb.table("conversations")
            .select("id, title, project_id, created_at, updated_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = result.data or []
        return {"user_id": user_id, "count": len(rows), "conversations": rows}
    except Exception as exc:
        logger.exception("debug/conversations failed")
        return {"error": str(exc)}


@app.post("/api/v1/debug/reprocess-all")
async def reprocess_all(
    _: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """
    Debug endpoint — reprocesses every paper in Supabase through the full
    chunk → embed → ChromaDB upsert pipeline.  No auth required.
    Returns {"processed": N, "errors": [{"paper_id": ..., "error": ...}]}.
    """
    import asyncio
    from supabase import create_client
    from app.services.processing_service import reprocess_paper

    if not settings.SUPABASE_SERVICE_ROLE_KEY:
        return {"error": "SUPABASE_SERVICE_ROLE_KEY not configured", "processed": 0, "errors": []}

    # ── Fetch paper list ──────────────────────────────────────────────────────
    try:
        sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
        result = sb.table("papers").select("id, user_id, title, storage_path, project_id").execute()
        papers = result.data or []
    except Exception as exc:
        logger.exception("[REPROCESS-ALL] Failed to fetch papers from Supabase")
        return {"error": f"Supabase fetch failed: {exc}", "processed": 0, "errors": []}

    logger.info("[REPROCESS-ALL] Found %d papers to reprocess", len(papers))
    processed = 0
    errors: list[dict] = []

    # ── Process each paper independently ─────────────────────────────────────
    for paper in papers:
        paper_id = paper.get("id", "unknown")
        logger.info("[REPROCESS-ALL] Starting paper_id=%s title=%r storage_path=%r",
                    paper_id, paper.get("title"), paper.get("storage_path"))
        try:
            await asyncio.to_thread(
                reprocess_paper,
                sb=sb,
                paper_id=paper_id,
                user_id=paper["user_id"],
                paper_title=paper.get("title") or "Untitled",
                storage_path=paper["storage_path"],
                project_id=paper.get("project_id"),
            )
            processed += 1
            logger.info("[REPROCESS-ALL] ✓ paper_id=%s", paper_id)
        except Exception as exc:
            logger.exception("[REPROCESS-ALL] ✗ paper_id=%s", paper_id)
            errors.append({"paper_id": paper_id, "error": str(exc)})

    logger.info("[REPROCESS-ALL] Done — processed=%d errors=%d", processed, len(errors))
    return {"processed": processed, "errors": errors}


@app.get("/api/v1/debug/chroma-status")
async def chroma_status(
    _: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Debug endpoint — lists all ChromaDB collections and their document counts."""
    try:
        from app.core.chroma import get_chroma
        chroma = get_chroma()
        col_names = chroma.list_collections()  # 0.6.x returns strings
        return {
            "collections": [
                {"name": name, "count": chroma.get_collection(name).count()}
                for name in col_names
            ]
        }
    except Exception as e:
        logger.error("chroma-status failed: %s", e)
        return {"error": str(e)}
