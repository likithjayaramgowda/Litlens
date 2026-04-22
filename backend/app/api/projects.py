"""
Project (workspace) endpoints.

GET    /api/v1/projects/           — list the user's projects (with paper counts)
POST   /api/v1/projects/           — create a project
PUT    /api/v1/projects/{id}       — rename / update description
DELETE /api/v1/projects/{id}       — delete project (papers remain, project_id → NULL)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.services.project_service import (
    create_project,
    delete_project,
    get_project_paper_count,
    get_projects,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Models ────────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str | None = Field(None, max_length=500)


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=500)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    created_at: str
    updated_at: str
    paper_count: int = 0


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/",
    response_model=list[ProjectOut],
    summary="List all projects for the current user",
)
async def list_projects(
    user: Annotated[dict, Depends(get_current_user)],
) -> list[dict]:
    projects = get_projects(user["sub"])
    for p in projects:
        p["paper_count"] = get_project_paper_count(p["id"])
    return projects


@router.post(
    "/",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project",
)
async def create_project_endpoint(
    body: ProjectCreate,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Project name cannot be empty.")
    project = create_project(user["sub"], body.name, body.description)
    project["paper_count"] = 0
    return project


@router.put(
    "/{project_id}",
    response_model=ProjectOut,
    summary="Update a project name or description",
)
async def update_project_endpoint(
    project_id: str,
    body: ProjectUpdate,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    try:
        project = update_project(project_id, user["sub"], body.name, body.description)
        project["paper_count"] = get_project_paper_count(project_id)
        return project
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a project (papers are unassigned, not deleted)",
)
async def delete_project_endpoint(
    project_id: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> Response:
    try:
        delete_project(project_id, user["sub"])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
