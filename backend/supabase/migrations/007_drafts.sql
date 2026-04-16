-- Migration 007: Drafts table for Citation Assistant (Phase 5)
-- Run AFTER migration 005_projects.sql.
--
-- One draft document per project per user. Stores the Tiptap editor content
-- (HTML string), the chosen citation style, and an optional title.

CREATE TABLE IF NOT EXISTS public.drafts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id      UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    title           TEXT        NOT NULL DEFAULT 'Untitled Draft',
    content         TEXT        NOT NULL DEFAULT '',
    citation_style  TEXT        NOT NULL DEFAULT 'APA'
                                CHECK (citation_style IN ('APA', 'MLA', 'IEEE', 'Harvard', 'Chicago')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One draft per (user, project) pair.  Extend to a list in a later phase if needed.
CREATE UNIQUE INDEX IF NOT EXISTS drafts_user_project_unique
    ON public.drafts (user_id, project_id);

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS drafts_user_id_idx
    ON public.drafts (user_id);

-- Reuse the set_updated_at() trigger function created in migration 001
CREATE TRIGGER set_drafts_updated_at
    BEFORE UPDATE ON public.drafts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own drafts"
    ON public.drafts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own drafts"
    ON public.drafts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own drafts"
    ON public.drafts FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own drafts"
    ON public.drafts FOR DELETE
    USING (auth.uid() = user_id);
