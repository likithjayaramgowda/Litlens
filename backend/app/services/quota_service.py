"""
Per-user daily query quota tracking.

Uses a Supabase table ``user_query_usage (user_id, date, count)`` plus a
SECURITY DEFINER Postgres function ``increment_query_usage`` to atomically
increment usage counts while bypassing RLS.

Run the migration in backend/supabase/migrations/003_query_usage.sql before
enabling quota enforcement.

Demo users (user_metadata.is_demo == true) are capped at DEMO_QUERY_LIMIT.
All other users are capped at DAILY_QUERY_LIMIT.
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache

from supabase import create_client, Client

from app.core.config import settings


@lru_cache(maxsize=1)
def _service_client() -> Client:
    """Cached service-role Supabase client (bypasses RLS)."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Supabase service role credentials are not configured.")
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def is_demo_user(user: dict) -> bool:
    """
    Return True if this user is a demo account.

    Set via Supabase admin: update the user's ``user_metadata`` to
    ``{"is_demo": true}``.
    """
    return bool((user.get("user_metadata") or {}).get("is_demo", False))


def get_quota_info(user_id: str, is_demo: bool = False) -> dict:
    """
    Return quota info for the user for today.

    Returns::

        {"used": int, "limit": int, "remaining": int}

    If the ``user_query_usage`` table does not exist yet (migration not run),
    returns a full-quota response so the app does not break.
    """
    limit = settings.DEMO_QUERY_LIMIT if is_demo else settings.DAILY_QUERY_LIMIT
    today = date.today().isoformat()

    try:
        sb = _service_client()
        result = (
            sb.table("user_query_usage")
            .select("count")
            .eq("user_id", user_id)
            .eq("date", today)
            .execute()
        )
        used = result.data[0]["count"] if result.data else 0
    except Exception as exc:
        print(f"[QUOTA] Could not read usage (table missing?): {exc}", flush=True)
        used = 0

    return {"used": used, "limit": limit, "remaining": max(0, limit - used)}


def increment_usage(user_id: str) -> int:
    """
    Atomically increment today's query count for the user.

    Returns the new count.  If the table / function does not exist, logs a
    warning and returns 0 (quota enforcement is a no-op in that case).
    """
    today = date.today().isoformat()
    try:
        sb = _service_client()
        result = sb.rpc(
            "increment_query_usage",
            {"p_user_id": user_id, "p_date": today},
        ).execute()
        return int(result.data or 0)
    except Exception as exc:
        print(f"[QUOTA] Could not increment usage: {exc}", flush=True)
        return 0


def check_quota(user_id: str, is_demo: bool = False) -> None:
    """
    Raise a ValueError if the user has exhausted their daily quota.

    Call this before streaming begins; if it raises, return a 429 response.
    Does NOT increment usage — call increment_usage() separately after
    confirming the request will be served.
    """
    info = get_quota_info(user_id, is_demo)
    if info["remaining"] <= 0:
        limit = info["limit"]
        raise ValueError(
            f"Daily query limit reached ({limit}/{limit}). "
            "Add your own DeepSeek API key in Advanced Settings to continue."
        )
