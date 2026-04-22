"""
Chat endpoints.

POST /api/v1/chat/stream
    Stream an LLM response via Server-Sent Events (SSE).
    Body: {message, tier, conversation_id?}
    Headers (optional BYOK): X-LLM-Provider, X-LLM-Model, X-LLM-API-Key

GET  /api/v1/chat/conversations
    List the authenticated user's conversations (newest first).

GET  /api/v1/chat/conversations/{id}/messages
    Fetch all messages in a conversation (oldest first).

SSE event format — each event is:
    data: <json_object>\\n\\n

JSON types:
    {"type": "sources",  "sources": [...]}
    {"type": "token",    "content": "..."}
    {"type": "done",     "conversation_id": "..."}
    {"type": "error",    "message": "..."}
"""
from __future__ import annotations

import json
import logging
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.rate_limit import rate_limit_check

from app.core.auth import get_current_user
from app.services.quota_service import is_demo_user, check_quota, increment_usage
from app.services.retrieval_service import retrieve_chunks, build_system_prompt
from app.services.chat_service import (
    create_conversation,
    delete_conversation,
    get_conversations,
    get_messages,
    save_message,
    update_conversation_timestamp,
)
from app.services.project_service import get_project_paper_ids
from app.services.llm_router import stream_free_tier, stream_byok, TIERS

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


# ── Request / response models ──────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., max_length=10_000)
    tier: str = "quick"
    conversation_id: str | None = None
    project_id: str | None = None


class ConversationItem(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    project_id: str | None = None


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/stream",
    summary="Stream a RAG chat response via Server-Sent Events",
)
async def chat_stream(
    body: ChatRequest,
    user: Annotated[dict, Depends(get_current_user)],
    x_llm_provider: str = Header(alias="X-LLM-Provider", default=""),
    x_llm_model: str = Header(alias="X-LLM-Model", default=""),
    x_llm_api_key: str = Header(alias="X-LLM-API-Key", default=""),
) -> StreamingResponse:
    """
    Full RAG pipeline:

    1. Quota check (skipped for BYOK)
    2. Semantic retrieval — top-15 chunks from user's ChromaDB collection
    3. Build system prompt with paper excerpts
    4. Load recent conversation history (if continuing a conversation)
    5. Stream LLM response
    6. Persist user + assistant messages; increment quota
    7. Emit ``done`` SSE event with ``conversation_id``
    """
    user_id: str = user["sub"]
    demo = is_demo_user(user)
    use_byok = bool(x_llm_api_key and x_llm_provider)

    # ── Rate limit ────────────────────────────────────────────────────────────
    if not rate_limit_check(user_id, "chat", max_calls=30, window_secs=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment.",
        )

    # ── Quota guard ───────────────────────────────────────────────────────────
    if not use_byok:
        try:
            check_quota(user_id, is_demo=demo)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
            )

    # ── Retrieval (done before streaming so sources arrive in first SSE event) ──
    print(
        f"[CHAT] user={user_id} project_id={body.project_id!r} message={body.message[:60]!r}",
        flush=True,
    )
    project_scoped = bool(body.project_id)
    chunks: list[dict] = []
    if project_scoped:
        paper_ids = get_project_paper_ids(body.project_id, user_id)
        print(f"[CHAT] ready paper_ids for project={body.project_id}: {paper_ids}", flush=True)
        logger.info(
            "[CHAT] project_id=%s user=%s ready_paper_ids=%s",
            body.project_id, user_id, paper_ids,
        )
        if paper_ids:
            chunks = retrieve_chunks(
                user_id,
                body.message,
                n_results=25,
                paper_ids=paper_ids,
                project_id=body.project_id,
            )
            if not chunks:
                # paper_ids were found in Supabase (status=ready) but ChromaDB
                # returned nothing — most likely the vector store was reset.
                # Fall back to a global search so the user isn't left with silence.
                logger.warning(
                    "[CHAT] project_id=%s: paper_ids non-empty but ChromaDB returned 0 chunks "
                    "— falling back to global retrieval",
                    body.project_id,
                )
                print(f"[CHAT] fallback: global retrieval", flush=True)
                chunks = retrieve_chunks(user_id, body.message, n_results=15)
        # else: project has no ready papers yet — chunks stays [], prompt will say so
    else:
        chunks = retrieve_chunks(user_id, body.message, n_results=15)

    print(f"[CHAT] total chunks retrieved: {len(chunks)}", flush=True)
    system_prompt, sources = build_system_prompt(chunks, project_scoped=project_scoped)

    # ── Build message list with conversation history ───────────────────────────
    history: list[dict] = []
    if body.conversation_id:
        prior = get_messages(body.conversation_id, user_id)
        # Keep last 10 turns (20 messages) to stay within context limits
        for m in prior[-20:]:
            history.append({"role": m["role"], "content": m["content"]})

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": body.message},
    ]

    # ── Determine model label for storage ─────────────────────────────────────
    if use_byok:
        model_label = f"{x_llm_provider}/{x_llm_model}"
    else:
        tier_entry = next((t for t in TIERS if t["id"] == body.tier), TIERS[0])
        model_label = tier_entry["model"]

    # ── SSE generator ─────────────────────────────────────────────────────────
    async def event_stream() -> AsyncIterator[str]:
        conversation_id = body.conversation_id

        # Create conversation + persist user message (best-effort)
        try:
            if not conversation_id:
                title = body.message[:80].strip()
                logger.info("project_id on conversation create: %s", body.project_id)
                conversation_id = create_conversation(
                    user_id, title, project_id=body.project_id
                )
            save_message(user_id, conversation_id, "user", body.message)
        except Exception as exc:
            logger.warning("Could not persist user message: %s", exc)
            # Continue streaming even if persistence fails

        # Send sources as the first event so the UI can show them immediately
        yield _sse({"type": "sources", "sources": sources})

        # Stream tokens
        full_response: list[str] = []
        try:
            if use_byok:
                gen = stream_byok(
                    provider=x_llm_provider,
                    model=x_llm_model,
                    api_key=x_llm_api_key,
                    messages=messages,
                    max_tokens=4_096,
                )
            else:
                gen = stream_free_tier(
                    messages=messages,
                    max_tokens=4_096,
                    tier=body.tier,
                )

            async for token in gen:
                full_response.append(token)
                yield _sse({"type": "token", "content": token})

        except Exception as exc:
            logger.error("LLM streaming error: %s", exc)
            yield _sse({"type": "error", "message": str(exc)})
            return

        # Persist assistant message + increment quota (best-effort)
        assistant_content = "".join(full_response)
        try:
            save_message(
                user_id,
                conversation_id,
                "assistant",
                assistant_content,
                sources=sources,
                model_used=model_label,
            )
            update_conversation_timestamp(conversation_id)
            if not use_byok and assistant_content:
                increment_usage(user_id)
        except Exception as exc:
            logger.warning("Could not persist assistant message: %s", exc)

        yield _sse({"type": "done", "conversation_id": conversation_id})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering in production
        },
    )


@router.get(
    "/conversations",
    response_model=list[ConversationItem],
    summary="List the user's conversations (newest first)",
)
async def list_conversations(
    user: Annotated[dict, Depends(get_current_user)],
    project_id: str | None = Query(None, description="Filter by project"),
) -> list[dict]:
    return get_conversations(user["sub"], project_id=project_id)


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a conversation and all its messages",
)
async def delete_conversation_endpoint(
    conversation_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> Response:
    success = delete_conversation(conversation_id, user["sub"])
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/conversations/{conversation_id}/messages",
    summary="Get all messages in a conversation",
)
async def get_conversation_messages(
    conversation_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> list[dict]:
    return get_messages(conversation_id, user["sub"])
