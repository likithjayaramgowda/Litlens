-- Migration 009: add project_id to paper_chunks + update RPC
--
-- Run in the Supabase SQL Editor after 008_pgvector.sql.
-- Adds a project_id column so retrieval can be scoped per-project
-- without relying solely on paper_ids.

-- ── 1. Column + index ─────────────────────────────────────────────────────────
ALTER TABLE paper_chunks ADD COLUMN IF NOT EXISTS project_id text;

CREATE INDEX IF NOT EXISTS paper_chunks_project_id_idx ON paper_chunks (project_id);

-- ── 2. Replace RPC — adds p_project_id filter parameter ──────────────────────
CREATE OR REPLACE FUNCTION match_paper_chunks(
    query_embedding vector(384),
    match_count     int    DEFAULT 15,
    p_user_id       text   DEFAULT NULL,
    p_paper_ids     text[] DEFAULT NULL,
    p_project_id    text   DEFAULT NULL
)
RETURNS TABLE (
    chunk_id    text,
    paper_id    text,
    paper_title text,
    page_number int,
    content     text,
    similarity  float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        pc.chunk_id,
        pc.paper_id,
        pc.paper_title,
        pc.page_number,
        pc.content,
        (1 - (pc.embedding <=> query_embedding))::float AS similarity
    FROM paper_chunks pc
    WHERE
        (p_user_id    IS NULL OR pc.user_id    = p_user_id)
        AND (p_paper_ids  IS NULL OR pc.paper_id  = ANY(p_paper_ids))
        AND (p_project_id IS NULL OR pc.project_id = p_project_id)
    ORDER BY pc.embedding <=> query_embedding
    LIMIT match_count;
$$;
