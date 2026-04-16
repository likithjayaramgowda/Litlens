-- Migration 005: Project Spaces (Phase 2.3)
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Creates:
--   table  projects          — per-user named workspaces (max 50 papers each)
--   column papers.project_id — nullable FK to projects
--   column conversations.project_id — nullable FK to projects
--
-- Backward-compatible: NULL project_id means "unassigned / default workspace".
-- No existing rows are modified; RLS policies mirror those on papers/conversations.

-- ── Projects table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.projects (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Full CRUD for own rows (service role bypasses RLS automatically).
CREATE POLICY "Users manage own projects"
    ON public.projects
    FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_projects_user_id
    ON public.projects (user_id);

-- ── papers.project_id ─────────────────────────────────────────────────────────

ALTER TABLE public.papers
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_papers_project_id
    ON public.papers (project_id)
    WHERE project_id IS NOT NULL;

-- ── conversations.project_id ──────────────────────────────────────────────────

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_project_id
    ON public.conversations (project_id)
    WHERE project_id IS NOT NULL;

-- ── touch_project helper ──────────────────────────────────────────────────────
-- SECURITY DEFINER so the service-role RPC can always update updated_at.

CREATE OR REPLACE FUNCTION public.touch_project(p_project_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.projects
       SET updated_at = NOW()
     WHERE id = p_project_id;
END;
$$;
