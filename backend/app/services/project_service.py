"""
Project (workspace) CRUD — service layer.

Requires migration 005_projects.sql to be run first.

Tables:
  projects — (id, user_id, name, description, created_at, updated_at)

All writes use the service-role client which bypasses RLS.
"""
from __future__ import annotations

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


# ── Read ──────────────────────────────────────────────────────────────────────

def get_projects(user_id: str) -> list[dict]:
    """Return all projects for a user, oldest first. Empty list on error."""
    try:
        sb = _service_client()
        result = (
            sb.table("projects")
            .select("id, name, description, created_at, updated_at")
            .eq("user_id", user_id)
            .order("created_at", desc=False)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        logger.warning("Could not load projects for user %s: %s", user_id, exc)
        return []


def get_project(project_id: str, user_id: str) -> dict | None:
    """Return a single project by id, owner-checked. None if not found."""
    try:
        sb = _service_client()
        result = (
            sb.table("projects")
            .select("id, name, description, created_at, updated_at")
            .eq("id", project_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data
    except Exception as exc:
        logger.warning("Could not load project %s: %s", project_id, exc)
        return None


def get_project_paper_ids(project_id: str, user_id: str) -> list[str]:
    """
    Return paper_ids for all *ready* papers in a project.

    Only includes papers with status='ready' so ChromaDB lookups are never
    attempted for papers whose chunks haven't been embedded yet.
    Returns empty list on any error.
    """
    try:
        sb = _service_client()
        result = (
            sb.table("papers")
            .select("id")
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .eq("status", "ready")
            .execute()
        )
        return [row["id"] for row in (result.data or [])]
    except Exception as exc:
        logger.warning("Could not get paper IDs for project %s: %s", project_id, exc)
        return []


def get_project_paper_count(project_id: str) -> int:
    """Return the number of papers in a project. 0 on error."""
    try:
        sb = _service_client()
        result = (
            sb.table("papers")
            .select("id", count="exact")
            .eq("project_id", project_id)
            .execute()
        )
        return result.count or 0
    except Exception:
        return 0


# ── Write ─────────────────────────────────────────────────────────────────────

def create_project(user_id: str, name: str, description: str | None = None) -> dict:
    """Insert a new project and return the created row."""
    sb = _service_client()
    payload: dict = {"user_id": user_id, "name": name[:100].strip() or "Untitled Project"}
    if description:
        payload["description"] = description[:500].strip()
    result = sb.table("projects").insert(payload).execute()
    return result.data[0]


def update_project(
    project_id: str,
    user_id: str,
    name: str | None = None,
    description: str | None = None,
) -> dict:
    """
    Update project name and/or description.

    Raises ValueError if the project does not exist or is not owned by user.
    """
    sb = _service_client()
    check = (
        sb.table("projects")
        .select("id")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not check.data:
        raise ValueError(f"Project {project_id!r} not found.")

    payload: dict = {"updated_at": "now()"}
    if name is not None:
        payload["name"] = name[:100].strip() or "Untitled Project"
    if description is not None:
        payload["description"] = description[:500].strip()

    result = sb.table("projects").update(payload).eq("id", project_id).execute()
    return result.data[0]


def delete_project(project_id: str, user_id: str) -> None:
    """
    Delete a project (papers/conversations get project_id = NULL via ON DELETE SET NULL).

    Raises ValueError if not found or not owned.
    """
    sb = _service_client()
    check = (
        sb.table("projects")
        .select("id")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not check.data:
        raise ValueError(f"Project {project_id!r} not found.")
    sb.table("projects").delete().eq("id", project_id).execute()
