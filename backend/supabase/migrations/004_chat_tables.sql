-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004 — Conversations + Messages tables for Phase 4 RAG Chat
-- Run this in the Supabase SQL Editor (Database → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── conversations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversations (
    id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       TEXT         NOT NULL DEFAULT 'New Chat',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_updated_at_idx
    ON public.conversations (user_id, updated_at DESC);

-- ── messages ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.messages (
    id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id  UUID         NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    role             TEXT         NOT NULL CHECK (role IN ('user', 'assistant')),
    content          TEXT         NOT NULL,
    sources_json     JSONB,       -- [{paper_id, paper_title, page_number, excerpt, relevance_score}]
    model_used       TEXT,        -- e.g. "deepseek/deepseek-r1:free"
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx
    ON public.messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS messages_user_id_idx
    ON public.messages (user_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages      ENABLE ROW LEVEL SECURITY;

-- Users can read/write only their own conversations.
CREATE POLICY "conversations: owner access"
    ON public.conversations
    FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can read/write only their own messages.
CREATE POLICY "messages: owner access"
    ON public.messages
    FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service role (used by FastAPI) bypasses RLS automatically — no extra policy needed.

-- ── Helper: touch conversation updated_at ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.conversations
       SET updated_at = NOW()
     WHERE id = p_conversation_id;
END;
$$;
