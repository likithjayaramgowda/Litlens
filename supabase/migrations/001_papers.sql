-- ============================================================
-- Migration 001: papers table
-- Run this in the Supabase SQL editor:
--   Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.papers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text        NOT NULL DEFAULT '',
  authors         text        NOT NULL DEFAULT '',
  year            integer,
  filename        text        NOT NULL,
  storage_path    text        NOT NULL,
  file_size_bytes integer     NOT NULL DEFAULT 0,
  page_count      integer     NOT NULL DEFAULT 0,
  -- uploaded  = file stored, metadata extracted
  -- processing = chunking / embedding in progress  (Phase 2.2)
  -- ready      = fully indexed, available for search (Phase 2.2)
  -- error      = pipeline failed
  status          text        NOT NULL DEFAULT 'uploaded'
                  CHECK (status IN ('uploaded', 'processing', 'ready', 'error')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by user, newest-first
CREATE INDEX IF NOT EXISTS papers_user_id_created_at_idx
  ON public.papers (user_id, created_at DESC);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own papers"
  ON public.papers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own papers"
  ON public.papers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own papers"
  ON public.papers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own papers"
  ON public.papers FOR DELETE
  USING (auth.uid() = user_id);

-- ── Auto-update updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER papers_set_updated_at
  BEFORE UPDATE ON public.papers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
