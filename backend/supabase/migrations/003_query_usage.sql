-- Migration 003: per-user daily query usage tracking
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Creates:
--   table  user_query_usage     — one row per (user, date), stores query count
--   func   increment_query_usage — atomic upsert-increment (SECURITY DEFINER)
--
-- The backend uses the service-role key to call the function directly,
-- bypassing RLS. Users can only SELECT their own rows.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_query_usage (
    user_id UUID  NOT NULL,
    date    DATE  NOT NULL DEFAULT CURRENT_DATE,
    count   INT   NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

ALTER TABLE public.user_query_usage ENABLE ROW LEVEL SECURITY;

-- Users may read their own rows (service role bypasses RLS automatically).
CREATE POLICY "Users can read own query usage"
    ON public.user_query_usage
    FOR SELECT
    USING (auth.uid() = user_id);

-- ── Atomic increment function ─────────────────────────────────────────────────
-- SECURITY DEFINER: runs with the privileges of the function owner (postgres),
-- so the backend's service-role calls can write regardless of RLS.

CREATE OR REPLACE FUNCTION public.increment_query_usage(
    p_user_id UUID,
    p_date    DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    INSERT INTO public.user_query_usage (user_id, date, count)
    VALUES (p_user_id, p_date, 1)
    ON CONFLICT (user_id, date)
    DO UPDATE SET count = public.user_query_usage.count + 1
    RETURNING count INTO new_count;

    RETURN new_count;
END;
$$;

-- Grant execute to authenticated role so Supabase client calls work too
-- (the service role already has EXECUTE by default).
GRANT EXECUTE ON FUNCTION public.increment_query_usage(UUID, DATE)
    TO authenticated;
