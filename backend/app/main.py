import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.api.papers import router as papers_router
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
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


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


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
