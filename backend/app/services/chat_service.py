"""
Conversation and message persistence in Supabase.

Requires migration 004_chat_tables.sql to be run first.

Tables:
  conversations — (id, user_id, title, created_at, updated_at)
  messages      — (id, user_id, conversation_id, role, content,
                    sources_json, model_used, created_at)

All writes use the service-role client which bypasses RLS, so they work
regardless of how the user authenticated.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache

from supabase import create_client, Client

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _service_client() -> Client:
    """Cached service-role Supabase client (bypasses RLS)."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Supabase service-role credentials are not configured.")
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# ── Conversations ─────────────────────────────────────────────────────────────

def create_conversation(user_id: str, title: str) -> str:
    """
    Insert a new conversation row and return its UUID.

    The title is auto-generated from the first user message (first 120 chars).
    """
    sb = _service_client()
    result = (
        sb.table("conversations")
        .insert({"user_id": user_id, "title": title[:120].strip() or "New Chat"})
        .execute()
    )
    return result.data[0]["id"]


def update_conversation_timestamp(conversation_id: str) -> None:
    """Touch updated_at so the sidebar sorts correctly. Best-effort."""
    try:
        sb = _service_client()
        sb.rpc("touch_conversation", {"p_conversation_id": conversation_id}).execute()
    except Exception as exc:
        logger.debug("Could not touch conversation %s: %s", conversation_id, exc)


def get_conversations(user_id: str, limit: int = 50) -> list[dict]:
    """
    Return the user's conversations ordered by most-recently-updated.

    Returns an empty list on any error (e.g. migration not yet run).
    """
    try:
        sb = _service_client()
        result = (
            sb.table("conversations")
            .select("id, title, created_at, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        logger.warning("Could not load conversations for user %s: %s", user_id, exc)
        return []


# ── Messages ──────────────────────────────────────────────────────────────────

def save_message(
    user_id: str,
    conversation_id: str,
    role: str,
    content: str,
    sources: list[dict] | None = None,
    model_used: str | None = None,
) -> str:
    """
    Persist a chat message and return its UUID.

    Parameters
    ----------
    sources   : list of source dicts (for assistant messages only)
    model_used: model identifier string stored for debugging / analytics
    """
    payload: dict = {
        "user_id": user_id,
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
    }
    if sources is not None:
        payload["sources_json"] = json.dumps(sources)
    if model_used:
        payload["model_used"] = model_used

    sb = _service_client()
    result = sb.table("messages").insert(payload).execute()
    return result.data[0]["id"]


def get_messages(conversation_id: str, user_id: str) -> list[dict]:
    """
    Load all messages for a conversation, oldest first.

    Ownership is enforced by filtering on user_id (double-check beyond RLS).
    sources_json is parsed into a list and exposed as ``sources``.

    Returns an empty list on any error.
    """
    try:
        sb = _service_client()
        result = (
            sb.table("messages")
            .select("id, role, content, sources_json, model_used, created_at")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        )
        rows: list[dict] = result.data or []

        for row in rows:
            raw = row.pop("sources_json", None)
            if raw:
                try:
                    row["sources"] = json.loads(raw) if isinstance(raw, str) else raw
                except Exception:
                    row["sources"] = []
            else:
                row["sources"] = []

        return rows
    except Exception as exc:
        logger.warning("Could not load messages for conversation %s: %s", conversation_id, exc)
        return []
