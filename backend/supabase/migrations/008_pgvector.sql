-- Migration 008: pgvector — replace ChromaDB with Supabase vector storage
--
-- Run in the Supabase SQL Editor (once, in order after 007_drafts.sql).
-- Requires the pgvector extension, which is available on all Supabase projects.

-- ── 1. Extension ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_chunks (
    id          bigserial   PRIMARY KEY,
    chunk_id    text        UNIQUE NOT NULL,  -- {paper_id}_p{page}_c{chunk_index}
    paper_id    text        NOT NULL,
    user_id     text        NOT NULL,
    paper_title text        NOT NULL DEFAULT '',
    page_number int         NOT NULL DEFAULT 1,
    chunk_index int         NOT NULL DEFAULT 0,
    content     text        NOT NULL,
    embedding   vector(384),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS paper_chunks_user_id_idx  ON paper_chunks (user_id);
CREATE INDEX IF NOT EXISTS paper_chunks_paper_id_idx ON paper_chunks (paper_id);

-- IVFFlat cosine index — good for ≤1M rows.
-- Re-run VACUUM ANALYZE on the table after a large bulk import.
CREATE INDEX IF NOT EXISTS paper_chunks_embedding_idx
    ON paper_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ── 4. Row-level security ─────────────────────────────────────────────────────
-- All server-side writes use the service-role key (bypasses RLS).
-- RLS here is defence-in-depth for direct client access.
ALTER TABLE paper_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own chunks" ON paper_chunks;
CREATE POLICY "Users can read their own chunks"
    ON paper_chunks FOR SELECT
    USING (user_id = auth.uid()::text);

-- ── 5. Semantic search RPC ────────────────────────────────────────────────────
-- Called by retrieval_service.retrieve_chunks() via supabase.rpc("match_paper_chunks", {...})
CREATE OR REPLACE FUNCTION match_paper_chunks(
    query_embedding vector(384),
    match_count     int    DEFAULT 15,
    p_user_id       text   DEFAULT NULL,
    p_paper_ids     text[] DEFAULT NULL
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
        (p_user_id  IS NULL OR pc.user_id  = p_user_id)
        AND (p_paper_ids IS NULL OR pc.paper_id = ANY(p_paper_ids))
    ORDER BY pc.embedding <=> query_embedding
    LIMIT match_count;
$$;
