"""Supabase Storage helpers (runs with the service-role key)."""
from __future__ import annotations

import uuid

from supabase import Client

BUCKET = "Papers"


def upload_pdf(
    client: Client,
    user_id: str,
    filename: str,
    file_bytes: bytes,
) -> str:
    """
    Upload *file_bytes* to the ``papers`` bucket.

    Files are stored at ``{user_id}/{uuid4hex}_{safe_filename}`` so that:
    - Each user's files are namespaced under their own prefix.
    - Filenames cannot collide even when the same paper is re-uploaded.

    Returns the storage path (relative to the bucket root).
    """
    safe_name = filename.replace(" ", "_")
    path = f"{user_id}/{uuid.uuid4().hex}_{safe_name}"

    client.storage.from_(BUCKET).upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": "application/pdf", "upsert": "false"},
    )
    return path


def delete_pdf(client: Client, storage_path: str) -> None:
    """Remove a single file from storage.  Used by the delete-paper endpoint."""
    client.storage.from_(BUCKET).remove([storage_path])
