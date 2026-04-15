# LitLens — Project Progress & Context Tracker

> **CRITICAL RULE**: Before starting ANY new task, read this file first.
> After finishing ANY task, update this file before doing anything else.

---

## Project Overview

| Field | Value |
|---|---|
| **Project** | LitLens — AI-powered document search & analysis |
| **Current Phase** | Phase 3.5: OpenRouter free-tier + quota system (Phase 1 ✅, Phase 2 ✅, Phase 3 ✅) |
| **Frontend** | Next.js 14, App Router, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | FastAPI (Python 3.11), pydantic-settings |
| **Vector DB** | ChromaDB |
| **Auth / DB** | Supabase (auth + Postgres) |
| **LLM Layer** | OpenRouter free-tier (3 model tiers, one server key) + optional DeepSeek BYOK |
| **Infrastructure** | Docker Compose (local), Render (backend), Vercel (frontend) |

---

## Full Phase Checklist

### Phase 1: Foundation
- ✅ Scaffold monorepo structure (frontend/, backend/, root config)
- ✅ Next.js 14 app (App Router, TypeScript, Tailwind, shadcn/ui)
- ✅ FastAPI app with CORS, health check, pydantic-settings config
- ✅ docker-compose.yml (frontend + backend + ChromaDB services)
- ✅ .env.example with SUPABASE_URL, SUPABASE_KEY placeholders
- ✅ Supabase auth integration (backend: JWT verification middleware)
- ✅ Supabase auth integration (frontend: login/signup UI, session handling)
- ✅ Landing page (hero, features, CTA)

### Phase 2: PDF Pipeline
- ✅ File upload UI (drag-and-drop, progress indicator)
- ✅ Backend upload endpoint (multipart/form-data → Supabase Storage)
- ✅ PDF metadata extraction (PyMuPDF — title, authors, year, page count)
- ✅ Supabase Postgres papers table (migration SQL provided)
- ✅ PDF chunking (RecursiveCharacterTextSplitter, 512-token chunks, 50-token overlap)
- ✅ Embedding generation (all-MiniLM-L6-v2 via sentence-transformers, stored in ChromaDB)
- ⬜ Dashboard layout (sidebar nav, workspace list)
- ⬜ Workspaces (create / rename / delete, per-user isolation)

### Phase 3: BYOK LLM Router
- ✅ Provider abstraction layer (OpenAI / Anthropic / Gemini / Groq / Ollama)
- ✅ LLM router — select active provider + model via request headers
- ✅ Settings UI (provider picker, masked key input, model dropdown, test connection)
- ✅ OpenRouter free-tier: one OPENROUTER_API_KEY, 28+ free models, auto-fallback to openrouter/auto on 429
- ✅ Three model tiers: Quick (GLM-4.5 Air), Deep Thinking (DeepSeek R1), Long Context (Nemotron 120B)
- ✅ Server-side API key (OPENROUTER_API_KEY) — never exposed to browser
- ✅ Per-user daily quota: 50 queries/day (10 for demo users), tracked in Supabase
- ✅ BYOK narrowed to DeepSeek only (V3 / R1) — optional advanced settings
- ✅ QuotaBadge component in dashboard header with mini progress bar
- ✅ Settings modal redesigned as unobtrusive "Advanced" gear button
- ⬜ API key storage (encrypted, per-user in Supabase) — deferred; sessionStorage used instead

### Phase 4: Cross-Paper RAG Chat
- ⬜ Retrieval engine (multi-doc semantic search over ChromaDB)
- ⬜ Chat API endpoint with streaming (SSE / WebSocket)
- ⬜ Chat frontend (message list, streaming token display)
- ⬜ Source citations inline with each response
- ⬜ Specialized system prompts (summarize, compare, explain)

### Phase 5: Citation Assistant
- ⬜ Tiptap rich-text editor integration
- ⬜ Real-time citation suggestions (trigger on selection / command)
- ⬜ Citation verification (check claim against source chunks)
- ⬜ Bibliography formatter (APA / MLA / Chicago / BibTeX export)

### Phase 6: Visualizations
- ⬜ Knowledge graph (D3.js or react-force-graph, concept nodes + edges)
- ⬜ Comparison tables (side-by-side paper attributes, auto-generated)
- ⬜ Paper timeline (chronological view of references / publications)
- ⬜ Theme clustering (topic grouping across uploaded papers)

### Phase 7: Demo + Polish
- ⬜ Demo workspace (pre-loaded sample papers)
- ⬜ Onboarding flow (first-run tour / empty states)
- ⬜ Loading states & skeletons across all async UI
- ⬜ Dark mode (Tailwind `dark:` classes + theme toggle)
- ⬜ Error handling (toast notifications, API error boundaries)

### Phase 8: Deployment
- ⬜ Dockerize backend for Render (production Dockerfile, env config)
- ⬜ Deploy frontend to Vercel (next.config.js tuning, env vars)
- ⬜ README with architecture diagram and screenshots
- ⬜ Smoke-test full stack in production

---

## Completed Task Log

### [Phase 3.5b] OpenRouter simplification
**Date**: 2026-04-15
**What was done**:

Replaced direct Gemini + Groq SDK integration with OpenRouter (single API key, OpenAI-compatible). Simpler dependency tree, broader free model access, automatic fallback.

**Backend:**
- `backend/app/core/config.py`: Removed `GEMINI_API_KEY`, `GROQ_API_KEY`; added `OPENROUTER_API_KEY`.
- `backend/app/services/llm_router.py` (rewrite):
  - Single `_stream_openai_compat(base_url, api_key, model, messages, max_tokens, extra_headers)` handles all OpenAI-compatible endpoints.
  - `TIERS` list — 3 entries: `quick` (zhipu/glm-4.5-air:free), `deep` (deepseek/deepseek-r1:free), `long-context` (nvidia/nemotron-3-super-120b-a12b:free).
  - `stream_free_tier(messages, max_tokens, tier)` — calls OpenRouter with the tier's model; on any error falls back to `openrouter/auto` (OpenRouter picks an available free model).
  - All OpenRouter requests include `HTTP-Referer: https://litlens.app` and `X-Title: LitLens` headers.
  - `stream_byok` now also handles Ollama via OpenAI-compat `/v1` endpoint (no separate httpx NDJSON path).
- `backend/app/api/llm.py`: Added `GET /api/v1/llm/tiers` (public) returning tier catalogue.
- `backend/requirements.txt`: Removed `google-generativeai>=0.7.0`, `anthropic>=0.25.0`, `groq>=0.9.0`. Only `openai>=1.30.0` needed.
- `backend/.env.example`: Updated to `OPENROUTER_API_KEY`.
- `.env`: Renamed `OPEN_ROUTER_KEY` → `OPENROUTER_API_KEY` to match config.

**Frontend:**
- `frontend/components/settings-modal.tsx`: Updated free-tier notice copy to mention OpenRouter and the tier toggle.

**Key decisions:**
- OpenRouter is OpenAI-SDK-compatible, so zero new dependencies. The same `AsyncOpenAI` client handles OpenRouter, DeepSeek, and Ollama via different `base_url` values.
- `openrouter/auto` as fallback: OpenRouter dynamically routes to whichever free model has capacity. Better than a hardcoded secondary list.
- 3 tiers instead of 5-provider rotation: Users get a meaningful choice (speed vs depth vs context length) rather than invisible infrastructure rotation.
- Tier toggle is frontend-only state; the chosen tier ID is sent to the Phase 4 chat endpoint as a parameter.

**Files modified:** `config.py`, `llm_router.py`, `llm.py` (API), `requirements.txt`, `.env`, `.env.example`, `settings-modal.tsx`

**Blockers:** None.

---

### [Phase 3.5] Free-tier LLM auto-rotation + daily quota system
**Date**: 2026-04-15
**What was done**:

**Architecture change — replaced BYOK-only with free-tier + optional BYOK:**
- LitLens now works out-of-the-box with no user setup. Free-tier providers are tried in order; rate-limited providers are skipped automatically.
- BYOK is narrowed to DeepSeek only, presented as an optional "Advanced Settings" for users who want better reasoning.

**Backend — modified files:**
- `backend/app/core/config.py`: Added `GEMINI_API_KEY`, `GROQ_API_KEY` (server-side keys), `DAILY_QUERY_LIMIT=50`, `DEMO_QUERY_LIMIT=10`.
- `backend/app/core/auth.py`: `get_current_user` now also returns `user_metadata` dict so quota service can detect demo users.
- `backend/app/services/llm_router.py` (full rewrite):
  - Removed BYOK for OpenAI, Anthropic (not used in free tier or BYOK).
  - `_free_chain()` — returns ordered list of `(label, provider, model, api_key)` tuples: Gemini 2.0 Flash-Lite → Gemini 2.0 Flash → Groq Llama 4 Scout → Groq Llama 3.3 70B → Groq Qwen3-32B.
  - `_is_rate_limit(exc)` — detects 429/quota errors by inspecting exception class name and message string.
  - `stream_free_tier(messages, max_tokens)` — probes first token of each provider; on 429 falls through to next; logs which provider served the request.
  - `_stream_deepseek(model, api_key, messages, max_tokens)` — uses OpenAI SDK with `base_url="https://api.deepseek.com"`.
  - `stream_byok(provider, model, api_key, messages, max_tokens)` — for user BYOK (currently DeepSeek + Ollama).
  - `test_connection(provider, model, api_key)` — updated; dispatches to `stream_byok`.
  - `BYOK_PROVIDERS` dict — now only contains DeepSeek.
- `backend/app/api/llm.py` (rewrite):
  - Removed `GET /providers` (no longer needed; frontend hardcodes DeepSeek UI).
  - Added `GET /api/v1/llm/quota` — returns `{used, limit, remaining}` for the authenticated user.
  - Updated `POST /api/v1/llm/test-connection` — only accepts `deepseek` provider; reads `BYOK_PROVIDERS` for validation.

**Backend — new files:**
- `backend/app/services/quota_service.py`:
  - `_service_client()` — cached Supabase service-role client (bypasses RLS).
  - `is_demo_user(user_dict)` — checks `user_metadata.is_demo`.
  - `get_quota_info(user_id, is_demo)` — reads `user_query_usage` table; returns `{used, limit, remaining}`. Gracefully returns full quota if table doesn't exist yet.
  - `increment_usage(user_id)` — calls `increment_query_usage` Postgres RPC (atomic upsert-increment). Returns new count.
  - `check_quota(user_id, is_demo)` — raises `ValueError` with friendly message if remaining == 0 (used by Phase 4 chat endpoint).
- `backend/supabase/migrations/003_query_usage.sql`:
  - Creates `user_query_usage (user_id UUID, date DATE, count INT, PRIMARY KEY (user_id, date))`.
  - Enables RLS with SELECT-only policy for authenticated users.
  - Creates `increment_query_usage(p_user_id, p_date)` SECURITY DEFINER function for atomic increments.

**Backend — new files:**
- `backend/.env.example`: Full template with all env vars including `GEMINI_API_KEY`, `GROQ_API_KEY`, `DAILY_QUERY_LIMIT`, `DEMO_QUERY_LIMIT`.

**Frontend — modified files:**
- `frontend/components/settings-modal.tsx` (rewrite):
  - Removed provider sidebar (5 providers → DeepSeek only).
  - `LLMSettings` interface changed: `{deepseekKey, deepseekModel}` (removed `provider`, `model`, `apiKey`, `ollamaModel`).
  - Added free-tier info notice inside modal ("LitLens uses free AI models by default...").
  - Trigger button changed from "LLM Settings" (prominent) to small "Advanced" gear icon.
  - Added "Use free tier" button to clear the key.
  - `loadLLMSettings()` still exported for Phase 4 chat — Phase 4 checks `deepseekKey` to decide free-tier vs BYOK.
- `frontend/app/dashboard/page.tsx`: Imports `QuotaBadge` and renders it alongside the "Advanced" settings trigger in the page header.

**Frontend — new files:**
- `frontend/components/quota-badge.tsx`:
  - Client component; fetches `GET /api/v1/llm/quota` on mount.
  - Displays mini progress bar + `"{remaining}/{limit} queries left"` text.
  - Color-coded: violet (normal) → amber (≤20%) → red (exhausted).
  - Silently hides itself if the quota endpoint fails (migration not yet run).

**Files created**:
- `backend/app/services/quota_service.py`
- `backend/supabase/migrations/003_query_usage.sql`
- `backend/.env.example`
- `frontend/components/quota-badge.tsx`

**Files modified**:
- `backend/app/core/config.py` — new env vars
- `backend/app/core/auth.py` — expose user_metadata
- `backend/app/services/llm_router.py` — full rewrite
- `backend/app/api/llm.py` — new endpoints
- `frontend/components/settings-modal.tsx` — full rewrite
- `frontend/app/dashboard/page.tsx` — QuotaBadge in header

**Key decisions**:
- **Free-tier first**: Users get immediate value without any setup. The free chain auto-rotates on 429 — no manual intervention needed.
- **DeepSeek as BYOK**: Chosen because it has the best price-performance ratio among reasoning models; OpenAI/Anthropic BYOK removed to keep the UX simple.
- **Quota graceful degradation**: If the migration SQL hasn't been run, `get_quota_info` returns full quota and `increment_usage` logs a warning. The app works end-to-end without requiring the migration — quota enforcement is opt-in.
- **`_is_rate_limit` string-based check**: Avoids importing provider SDKs at module level while still correctly classifying Groq `RateLimitError` and Google `ResourceExhausted`.
- **`stream_free_tier` first-token probe**: Gets `__anext__()` before starting to yield — if the first token raises 429, the generator is closed immediately and the next provider is tried. Once the first token arrives, the caller is committed to that provider for the stream.
- **Demo users via `user_metadata`**: Set `{"is_demo": true}` in Supabase admin → user gets 10 queries/day instead of 50. No code changes needed.

**Required migration**:
Run `backend/supabase/migrations/003_query_usage.sql` in Supabase SQL Editor to enable quota tracking.

**Deviations from plan**:
- Ollama kept in `_dispatch` (not removed) so it's available for potential future Ollama BYOK support.

**Blockers**: None.

---

### [Phase 3] BYOK LLM Router
**Date**: 2026-04-14
**What was done**:

**Backend — new files:**
- `backend/app/services/llm_router.py`:
  - `PROVIDER_MODELS` dict — catalogue of every provider with name, models, `needs_key`, `needs_url`, `key_label`, `key_placeholder`.
  - Per-provider async streaming functions: `_stream_openai`, `_stream_anthropic`, `_stream_google`, `_stream_groq`, `_stream_ollama`. All use lazy imports (provider SDK imported inside the function) to avoid startup cost when a provider isn't used.
  - `stream_llm(provider, model, api_key, messages, max_tokens)` — public async generator that dispatches to the correct provider. For Ollama, `api_key` carries the base URL; falls back to `http://localhost:11434`.
  - `test_connection(provider, model, api_key)` — sends `"Reply with just the word 'ok'"`, consumes the first token, cleans up the generator with `aclose()`. Returns `{"ok": True}` or `{"ok": False, "error": "..."}`. Never raises.
  - Ollama streaming via raw `httpx.AsyncClient` (NDJSON response, `aiter_lines`). All other providers use their official Python SDKs.
  - Anthropic: system messages extracted and passed via the separate `system=` parameter (Anthropic API requirement). OpenAI/Groq: messages passed as-is. Google: messages converted to Gemini `{"role": "user"|"model", "parts": [...]}` format; system messages prepended to first user turn.

- `backend/app/api/llm.py`:
  - `GET /api/v1/llm/providers` — public, returns `list[ProviderInfo]` so the frontend can build the UI dynamically. No auth required.
  - `POST /api/v1/llm/test-connection` — auth required. Reads `X-LLM-Provider`, `X-LLM-Model`, `X-LLM-API-Key` headers. Validates required fields, delegates to `test_connection()`. Returns `{"ok": bool, "error": str | null}`.

**Backend — updated files:**
- `backend/requirements.txt`: added `openai>=1.30.0`, `anthropic>=0.25.0`, `google-generativeai>=0.7.0`, `groq>=0.9.0`.
- `backend/app/main.py`: registered `llm_router` at `/api/v1`.

**Frontend — new files:**
- `frontend/components/settings-modal.tsx` (Client Component):
  - `SettingsModal` — renders a trigger button ("LLM Settings" + gear icon) and a full-screen modal.
  - **Provider sidebar**: 5 provider buttons (OpenAI, Anthropic, Google, Groq, Ollama) each with an inline SVG brand icon, coloured chip, and active highlight. Selecting a provider resets the model to its first option.
  - **Config panel**:
    - For key providers: `<input type="password">` with eye/eye-off toggle (show/hide key).
    - For Ollama: URL input (no masking) + free-text model name field (any Ollama model).
    - Model dropdown with chevron animation and checkmark on selected item. Closes on outside click via `useRef`.
    - Info tooltip on the key label explaining the key is never stored server-side.
  - **Test connection**: calls `POST /api/v1/llm/test-connection` with the provider headers. Shows green "Connection successful!" or red error message inline.
  - **Save**: writes `LLMSettings` to `sessionStorage` under `litlens_llm_settings`. Closes modal.
  - `loadLLMSettings()` exported for use by chat interface in Phase 4.
  - Closes on `Escape` key or clicking the backdrop.

**Frontend — updated files:**
- `frontend/app/dashboard/page.tsx`: imports `<SettingsModal />` and renders it in the page header (flex row, right-aligned). Server Component can render Client Component children.

**Files created**:
- `backend/app/services/llm_router.py`
- `backend/app/api/llm.py`
- `frontend/components/settings-modal.tsx`

**Files modified**:
- `backend/requirements.txt` — four new LLM SDK deps
- `backend/app/main.py` — registered llm_router
- `frontend/app/dashboard/page.tsx` — SettingsModal in header

**Key decisions**:
- **API key in headers, not body/DB**: key is transmitted only for the lifetime of the HTTP request, never written to any log or database. Server reads it from `X-LLM-API-Key` header which is not logged by default in FastAPI/uvicorn access logs.
- **sessionStorage (not localStorage)**: key is cleared when the browser tab closes. Intentionally not persisted across sessions — user must re-enter the key each session. This matches the BYOK security model.
- **Lazy SDK imports**: each provider's SDK is imported inside its streaming function, not at module load. This means a missing SDK (e.g. `google-generativeai` not installed) only fails at call time for that provider, not on startup.
- **`test_connection` consumes one token then `aclose()`**: avoids generating a full response just to validate the key. `aclose()` in `finally` ensures the underlying HTTP connection is properly cleaned up even if `__anext__` raises.
- **Ollama uses httpx directly**: avoids a dependency on the `ollama` Python package; httpx is already in the dependency tree. The Ollama `/api/chat` endpoint returns NDJSON (newline-delimited JSON) which we parse line-by-line.
- **Google Gemini format conversion**: Gemini uses `"model"` instead of `"assistant"` for the AI role, and wraps content in `"parts": [{"text": ...}]`. System messages don't have a Gemini equivalent role — they're prepended to the first user turn.
- **No Supabase key storage yet**: the original plan included encrypted per-user key storage in Supabase. Deferred — sessionStorage is sufficient for Phase 4 (RAG chat) and avoids the complexity of server-side encryption. Can be added in Phase 3.5 if needed.

**Deviations from plan**:
- API key storage in Supabase deferred; sessionStorage used instead (documented as backlog item).
- `GET /api/v1/llm/providers` endpoint added (not in original spec) — makes the frontend independent of hardcoded provider lists.

**Blockers**: None.

---

### [Phase 2.2] Background processing debug + reprocess endpoint
**Date**: 2026-04-14
**What was done**:

**Root cause of silent hang**: `.env` had `CHROMA_HOST=chromadb` (the Docker Compose internal service hostname). Running the backend locally, the OS tried to DNS-resolve `chromadb`, found nothing, and timed out after ~15 minutes. The exception was eventually caught by `process_paper`'s try/except but by then the hang had already occurred. No output appeared because `app.*` loggers had no handlers configured — `logging.basicConfig` was never called, so `logger.info/error` calls went nowhere.

**Fixes applied**:
- **`.env`**: Changed `CHROMA_HOST=chromadb` → `CHROMA_HOST=localhost`. Local dev needs `localhost:8001` (Docker maps container 8000 → host 8001).
- **`.env.example`**: Updated default to `CHROMA_HOST=localhost, CHROMA_PORT=8001` with comments explaining Docker vs local dev.
- **`backend/app/main.py`**: Added `logging.basicConfig(level=logging.INFO)` so all `app.*` logger output appears in the terminal. Also quieted noisy third-party loggers (`sentence_transformers`, `chromadb`, `httpx` → WARNING).
- **`backend/app/services/processing_service.py`**: Added `print(..., flush=True)` at every pipeline stage (start, status flip, PDF open, page extraction, embed_paper call, completion, error with full traceback). `print` guarantees output even when logging is misconfigured.
- **`backend/app/services/embedding_service.py`**: Added prints before chunking, before model load, before encoding, before ChromaDB connect, before collection create, per-batch upsert progress. Added a **heartbeat probe** inside `_get_chroma()`: after constructing `HttpClient`, immediately calls `client.heartbeat()`. If ChromaDB is unreachable, raises a clear `RuntimeError` with the host:port and instructions — fails in <1 s instead of hanging for 15 minutes.

**Reprocess endpoint + auto-trigger** (also built this session):
- **`backend/app/services/storage_service.py`**: Added `download_pdf(client, storage_path) -> bytes`.
- **`backend/app/services/processing_service.py`**: Added `reprocess_paper(sb, paper_id, user_id, paper_title, storage_path)` — downloads PDF from Supabase Storage then runs `process_paper`.
- **`backend/app/api/papers.py`**:
  - `GET /api/v1/papers/` now accepts `BackgroundTasks`. For any paper with `status='uploaded'`, atomically updates to `'processing'` in the DB (prevents re-trigger on next poll), then enqueues `reprocess_paper` as a background task. Returns the updated list.
  - New `POST /api/v1/papers/{paper_id}/reprocess` — manually re-queues a paper in `'uploaded'` or `'error'` state. Returns 409 if already processing.
- **`frontend/components/upload-zone.tsx`**: Added `RefreshCw` icon import. `PaperCard` now accepts `onStatusChange` prop. Added a "Retry" button (hover-reveal, top-right corner) for papers with `status === 'error'` — calls `/reprocess` and optimistically sets local state to `'processing'`. Delete and retry buttons share a top-right button group.

**Files modified**:
- `.env` — CHROMA_HOST=localhost
- `.env.example` — CHROMA_HOST/PORT docs for local vs Docker
- `backend/app/main.py` — logging.basicConfig, quieted third-party loggers
- `backend/app/services/processing_service.py` — print statements throughout, reprocess_paper added
- `backend/app/services/embedding_service.py` — print statements + heartbeat probe in _get_chroma
- `backend/app/services/storage_service.py` — download_pdf added
- `backend/app/api/papers.py` — auto-trigger in list_papers, reprocess endpoint
- `frontend/components/upload-zone.tsx` — Retry button, onStatusChange prop

**Key decisions**:
- `print(..., flush=True)` preferred over `logger.*` for debug output because it bypasses all logging configuration and is guaranteed to appear regardless of handler setup.
- Heartbeat probe in `_get_chroma()` caches the client only after a successful heartbeat — a failed client is never stored, so the next call retries the connection.
- Auto-trigger in `GET /papers/` (not a separate startup event) means papers created before Phase 2.2 are picked up on first dashboard load without any manual action. Status is atomically flipped to `'processing'` before enqueueing to prevent duplicate triggers across polls.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 2.2] PDF chunking + embedding pipeline
**Date**: 2026-04-14
**What was done**:

**Backend — new files:**
- Created `backend/app/services/embedding_service.py`:
  - `RecursiveCharacterTextSplitter` with `chunk_size=2048` chars (≈ 512 tokens at 4 chars/token), `chunk_overlap=200` chars (≈ 50 tokens).
  - Sentence-transformers model `all-MiniLM-L6-v2` (384-dim, cosine similarity). Lazy-loaded at module level — first request takes ~2–5 s for model load; subsequent calls are instant.
  - `embed_paper(paper_id, user_id, paper_title, pages)` — iterates pages, splits each page's text into chunks, batch-encodes with sentence-transformers, upserts into ChromaDB in batches of 100. Chunk IDs are deterministic (`{paper_id}_p{page}_c{chunk_index}`) so re-processing is safe (idempotent upsert).
  - Collection naming: `user_{user_id}` — one collection per user, `hnsw:space=cosine`.
  - `delete_paper_chunks(user_id, paper_id)` — removes all chunks for a paper using ChromaDB `where` filter on `paper_id`. Best-effort (never raises).
- Created `backend/app/services/processing_service.py`:
  - `process_paper(sb, paper_id, user_id, paper_title, file_bytes)` — full pipeline orchestrator. Sets `status='processing'`, re-opens the PDF bytes with PyMuPDF, calls `extract_pages()` then `embed_paper()`, sets `status='ready'`. On any exception: sets `status='error'` with truncated `error_message`. Must not raise — all exceptions are caught.
  - `_set_status(sb, paper_id, status, error_message?)` — helper to update the papers row without raising on Supabase errors.

**Backend — updated files:**
- `backend/app/api/papers.py`:
  - Upload endpoint now accepts `background_tasks: BackgroundTasks`. After a successful DB insert, calls `background_tasks.add_task(process_paper, ...)` passing the raw bytes already in memory (avoids a second Storage round-trip).
  - Delete endpoint now calls `delete_paper_chunks(user_id, paper_id)` before removing the DB row (best-effort, matching storage delete pattern).
- `backend/requirements.txt`:
  - `chromadb==0.5.0` → `chromadb>=1.0.0` (0.5.x uses `np.float_` removed in NumPy 2.0; 1.0+ is compatible).
  - Added `langchain-text-splitters>=0.2.0`.
  - Added `sentence-transformers>=3.0.0`.

**Frontend — updated files:**
- `frontend/components/upload-zone.tsx`:
  - Added `StatusBadge` component: shows a colored pill per paper status — "Queued" (gray spinner) for `uploaded`, "Indexing…" (amber spinner) for `processing`, "Ready" (green + Zap icon) for `ready`, "Error" (red + XCircle) for `error`.
  - `PaperCard` now renders `<StatusBadge>` in the meta row. Delete button is hidden while a paper is processing/uploaded (can't delete mid-index).
  - Added polling `useEffect`: when any paper has `status === 'processing'` or `'uploaded'`, re-fetches `GET /api/v1/papers/` every 3 seconds and updates state. The interval is cleaned up automatically when the effect re-runs or the component unmounts.
  - Added "Indexing N papers…" counter in the library header while any papers are in-flight.
  - Upload row success message updated to "Uploaded — indexing in background".

**Files created**:
- `backend/app/services/embedding_service.py`
- `backend/app/services/processing_service.py`

**Files modified**:
- `backend/app/api/papers.py` — BackgroundTasks trigger, delete_paper_chunks on delete
- `backend/requirements.txt` — chromadb version bump, langchain-text-splitters, sentence-transformers
- `frontend/components/upload-zone.tsx` — StatusBadge, polling, processing counter

**Key decisions**:
- `BackgroundTasks` (Starlette's built-in, same process) chosen over Celery/RQ for Phase 2.2. Simple, no extra infrastructure. Adequate for sequential single-user uploads. Can migrate to a proper task queue in Phase 3+ if needed.
- Raw PDF bytes passed directly to the background task — avoids a Storage download round-trip. The bytes are already in memory from the upload validation step.
- Chunk IDs are deterministic: same paper re-uploaded produces same IDs → ChromaDB upsert is idempotent. Safe to re-process without duplicating chunks.
- Character-based chunking (2 048 chars) approximates 512 tokens. Accurate token counting would require tiktoken, adding a dependency. The approximation is sufficient for semantic search quality.
- One ChromaDB collection per user (`user_{user_id}`): keeps retrieval scoped to the authenticated user without needing a `where` filter on every query. Makes Phase 4 (RAG search) straightforward.
- `chromadb>=1.0.0` required: 0.5.x references `np.float_` which was removed in NumPy 2.0 (the installed NumPy on Python 3.14). Updated to 1.5.7 (current latest).
- For local dev without Docker: ChromaDB runs on host port 8001 (mapped from container's 8000). Set `CHROMA_HOST=localhost` and `CHROMA_PORT=8001` in `.env`. Docker compose overrides `CHROMA_PORT=8000` for the backend container.
- model `all-MiniLM-L6-v2` is downloaded to the sentence-transformers cache (~80 MB) on first use. Subsequent server restarts reuse the cache — no re-download.

**Required setup before this works**:
1. ChromaDB must be running: `docker compose up chromadb` (or `docker compose up` for full stack).
2. For local dev without Docker: start ChromaDB separately and set `CHROMA_PORT=8001` in `.env`.
3. No DB migration needed — `papers` table already has `status` + `error_message` columns from migration 001.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 2.1] Integration bug-fixes — auth, CORS, storage, env loading
**Date**: 2026-04-14
**What was done**:

End-to-end integration revealed a series of issues after Phase 2.1 code was written. All were diagnosed and fixed before Phase 2.2 begins.

**1. Docker build — npm ci needed package-lock.json**
- `npm ci` in `frontend/Dockerfile` fails when `package-lock.json` is absent.
- Fix: replaced `npm ci` with `npm install --legacy-peer-deps`.
- `--legacy-peer-deps` relaxes peer-resolution without forcing conflicts.

**2. Docker build — missing `public/` folder**
- Next.js build failed because the `COPY public ./public` Dockerfile step had no source directory.
- Fix: created an empty `frontend/public/` directory so the COPY step succeeds.

**3. ChromaDB health check failing**
- `docker-compose.yml` health check was using an HTTP probe that ChromaDB doesn't expose on the configured port/path, causing the container to always report unhealthy.
- Fix: changed ChromaDB health check condition from `service_healthy` to `service_started`.

**4. TypeScript errors in auth callback**
- `app/auth/callback/route.ts` had `options?: any` for Supabase cookie options.
- Fix: imported `type CookieOptions` from `@supabase/ssr` and typed the parameter explicitly. Build passes with strict TypeScript.

**5. Frontend `.env` not loaded — `NEXT_PUBLIC_SUPABASE_URL` undefined**
- Root `.env` was not visible to the Next.js dev server because it was looking in `frontend/`.
- Fix: copied root `.env` to `frontend/.env.local` so Next.js picks it up.
- Also fixed backend `config.py` to locate `.env` using `Path(__file__).resolve().parent.parent.parent.parent` (absolute path relative to config.py) rather than a CWD-relative path, so uvicorn always loads the correct file regardless of working directory. Added `AliasChoices` to accept both `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` (and `SUPABASE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) from the same `.env`.

**6. Supabase Storage bucket case sensitivity — `Papers` vs `papers`**
- `storage_service.py` had `BUCKET = "papers"` but the bucket was created in the Supabase dashboard as `"Papers"`.
- Fix: changed to `BUCKET = "Papers"`. Supabase Storage bucket names are case-sensitive.

**7. CORS blocking requests from port 3001**
- Frontend dev server ran on port 3001 (3000 was occupied). Backend `allow_origins` only listed `localhost:3000`.
- Fix: added `"http://localhost:3001"` to `allow_origins` in `main.py` and `config.py` defaults.
- Also added a global `@app.exception_handler(Exception)` in `main.py` so unhandled 500s return a `JSONResponse` inside `ExceptionMiddleware` (which is wrapped by `CORSMiddleware`). Without this, unhandled exceptions bubble to Starlette's `ServerErrorMiddleware` (outside CORS) and the browser sees a CORS error on top of the 500.

**8. JWT verification: ES256 vs HS256 — resolved with `supabase.auth.get_user()`**
- Supabase projects created after March 2024 sign user JWTs with ES256 (ECC P-256), not HS256. The HS256 secret in the dashboard only applies to anon/service_role keys.
- First approach: `PyJWKClient` pointing at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Failed with "The JWK Set did not contain any usable keys. Perhaps cryptography is not installed?" because the `cryptography` package was not present in the uvicorn Python environment. Test scripts (different env) worked fine.
- Installed `cryptography>=42.0.0` and `PyJWT[crypto]==2.8.0`. JWKS fetch confirmed working in isolation but the running backend continued to fail due to environment/import-order issues.
- Final fix: replaced entire PyJWT/JWKS approach with `supabase.auth.get_user(token)`. The Supabase Python client sends the token to Supabase's own auth server for validation — no local crypto, no JWKS, no algorithm mismatch. Returns the user object on success, raises on invalid/expired token. `get_current_user` now returns `{"sub": user.id, "email": user.email, "role": user.role}` which is compatible with all downstream usage.

**9. FastAPI DELETE 204 with response body — startup crash**
- `@router.delete` with `status_code=204` and return type `-> None` caused FastAPI's startup validator to crash (`AssertionError: is_body_allowed_for_status_code`) because HTTP 204 forbids a body.
- Fix: added `response_class=Response` to the decorator, changed return type to `-> Response`, added explicit `return Response(status_code=204)`.

**10. `NEXT_PUBLIC_API_URL` pointing to wrong port**
- `.env` had `NEXT_PUBLIC_API_URL=http://localhost:3000` (the frontend port), so all API calls from the browser were being sent to the Next.js dev server instead of the FastAPI backend.
- Fix: changed to `NEXT_PUBLIC_API_URL=http://localhost:8000`.

**Files modified**:
- `backend/app/core/auth.py` — replaced PyJWT/JWKS with `supabase.auth.get_user(token)`
- `backend/app/core/config.py` — absolute `.env` path, `AliasChoices` for NEXT_PUBLIC_ vars
- `backend/app/main.py` — global exception handler for CORS-safe 500 responses
- `backend/app/api/papers.py` — DELETE 204 fix; list_papers PaperOut inside try/except
- `backend/app/services/storage_service.py` — `BUCKET = "Papers"`
- `backend/requirements.txt` — `PyJWT[crypto]==2.8.0`, `cryptography>=42.0.0`
- `frontend/components/upload-zone.tsx` — `getFreshToken()` using `getUser()` then `getSession()` to avoid stale cached tokens
- `.env` — `NEXT_PUBLIC_API_URL=http://localhost:8000`

**Key decisions**:
- `supabase.auth.get_user(token)` is the canonical server-side token validation method when the Supabase Python client is already a dependency. It's simpler, always correct regardless of JWT algorithm, and delegates all crypto to Supabase.
- `Path(__file__)`-relative `.env` path in config.py makes the backend location-independent — works whether uvicorn is run from `backend/`, the project root, or inside Docker.
- Global `@app.exception_handler(Exception)` is registered on the FastAPI app (inside ExceptionMiddleware/CORSMiddleware), not as ASGI middleware, so CORS headers are always present even on unhandled 500s.

**Deviations from plan**: Auth approach changed from PyJWT HS256 → PyJWKClient ES256 → `supabase.auth.get_user()`. The last approach is the simplest and most robust.

**Blockers**: None.

---

### [Phase 2.1] PDF upload system — frontend + backend
**Date**: 2026-04-13
**What was done**:

**Database:**
- Created `supabase/migrations/001_papers.sql`. Schema: `papers` table with columns `id` (uuid PK), `user_id` (FK → auth.users), `title`, `authors`, `year`, `filename`, `storage_path`, `file_size_bytes`, `page_count`, `status` (enum: uploaded/processing/ready/error), `error_message`, `created_at`, `updated_at`.
- RLS enabled with four policies (SELECT/INSERT/UPDATE/DELETE) scoped to `auth.uid() = user_id`.
- `set_updated_at()` trigger auto-updates `updated_at` on every row modification.
- Indexed on `(user_id, created_at DESC)` for fast per-user listing.

**Backend:**
- Added `PyMuPDF==1.24.3` and `python-multipart==0.0.9` to `requirements.txt`.
- Added `SUPABASE_SERVICE_ROLE_KEY` field to `config.py` (service-role bypasses RLS for server-side inserts/queries).
- Created `backend/app/services/pdf_service.py`:
  - `extract_metadata(doc, filename)` — tries embedded PDF metadata first, then first-page text heuristics (largest-font block as title, comma/email patterns as authors, regex for year), filename stem as final fallback.
  - `extract_pages(doc)` — returns `[{page, text}]` per page (ready for Phase 2.2 chunking).
- Created `backend/app/services/storage_service.py`:
  - `upload_pdf(client, user_id, filename, file_bytes)` — uploads to `papers` bucket at `{user_id}/{uuid}_{filename}`, returns storage path.
  - `delete_pdf(client, storage_path)` — removes from storage.
- Created `backend/app/api/papers.py` with three endpoints:
  - `POST /api/v1/papers/upload` — validates MIME type + PDF magic bytes + 50 MB limit, parses metadata with PyMuPDF, uploads raw bytes to Supabase Storage, inserts row into `papers` table. Returns `list[PaperOut]`.
  - `GET /api/v1/papers/` — lists all papers for the authenticated user, newest first.
  - `DELETE /api/v1/papers/{id}` — verifies ownership, deletes from storage (best-effort) and DB.
- Updated `backend/app/main.py` to register the papers router at `/api/v1`.

**Frontend:**
- Created `frontend/components/upload-zone.tsx` (Client Component):
  - Drag-and-drop zone with `onDragOver`/`onDrop` native events; also supports click-to-browse.
  - Visual state: default (dashed border) → drag-over (violet glow + lighter bg).
  - Files validated client-side: `.pdf` extension + 50 MB limit.
  - Per-file upload via `XMLHttpRequest` (not `fetch`) to capture `upload.onprogress` events.
  - Upload queue UI: shows each file with name, animated progress bar (violet fill), status icon (queued/uploading/done/error).
  - Files uploaded sequentially to avoid overwhelming the backend.
  - On success, new papers prepended to the papers list without a page reload.
  - Papers grid: 1–3 column responsive grid. Each card shows title (2-line clamp), authors, year badge, page count badge, file size badge, date. Hover reveals a delete button that calls `DELETE /api/v1/papers/{id}`.
  - Empty state with dashed border + prompt when no papers exist.
  - Loading spinner while initial papers fetch is in progress.
- Updated `frontend/app/dashboard/page.tsx`:
  - Server Component — reads user name from `user_metadata.full_name` or email prefix.
  - Renders page header + `<UploadZone />`.

**Files created**:
- `supabase/migrations/001_papers.sql`
- `backend/app/services/__init__.py`
- `backend/app/services/pdf_service.py`
- `backend/app/services/storage_service.py`
- `backend/app/api/papers.py`
- `frontend/components/upload-zone.tsx`

**Files modified**:
- `backend/requirements.txt` — added PyMuPDF, python-multipart
- `backend/app/core/config.py` — added SUPABASE_SERVICE_ROLE_KEY
- `backend/app/main.py` — registered papers_router
- `frontend/app/dashboard/page.tsx` — replaced placeholder with UploadZone
- `.env.example` — added SUPABASE_SERVICE_ROLE_KEY

**Key decisions**:
- Service-role key used for all backend Supabase operations (Storage upload + DB insert/query). JWT `sub` claim from the user's token is used as `user_id`, maintaining per-user isolation without relying on RLS.
- `XMLHttpRequest` chosen over `fetch` for upload: `fetch` does not expose upload progress via `ReadableStream` in all environments; XHR's `upload.onprogress` is universal.
- Files uploaded one at a time (sequential queue) for simplicity; concurrent uploads can be added later.
- PDF metadata extraction is heuristic — good enough for Phase 2.1. Users can edit metadata in a future phase.
- `delete_pdf` in storage is best-effort (wrapped in try/except): if storage delete fails, the DB row is still deleted to keep the UI consistent.
- Build verified clean: `✓ Compiled successfully`, TypeScript passed, 5 routes.

**Required manual Supabase setup** (before this feature works):
1. Run `supabase/migrations/001_papers.sql` in the Supabase SQL editor.
2. Create a Storage bucket named `papers` (Dashboard → Storage → New bucket, name: `papers`, public: OFF).
3. Set `SUPABASE_SERVICE_ROLE_KEY` in `.env` (Dashboard → Project Settings → API → service_role key).

**Deviations from plan**: Added `DELETE /api/v1/papers/{id}` endpoint (not originally requested but needed for paper management UI).

**Blockers**: None.

---

### [Phase 2.1] Bug fix — FastAPI 204 DELETE startup crash
**Date**: 2026-04-13
**What was done**:
- Backend crashed on startup with `AssertionError: is_body_allowed_for_status_code` in `papers.py`.
- Root cause: `@router.delete` with `status_code=204` and return type `-> None`. FastAPI's startup validation fails because HTTP 204 does not allow a body, but FastAPI tries to configure JSON serialization for the `None` response.
- Fix applied to `backend/app/api/papers.py`:
  - Added `Response` to the FastAPI imports.
  - Added `response_class=Response` to the `@router.delete` decorator.
  - Changed return type from `-> None` to `-> Response`.
  - Added explicit `return Response(status_code=status.HTTP_204_NO_CONTENT)` at end of function.
- Also updated `requirements.txt`: `PyMuPDF==1.24.3` → `PyMuPDF==1.27.2.2` (1.24.3 has no pre-built wheel for Python 3.14); `pydantic==2.7.1` → `pydantic>=2.7.1` (actual installed version is 2.13.0 which has a Python 3.14 wheel).
- Backend startup verified: all 10 routes registered cleanly, no assertion errors.

**Files modified**:
- `backend/app/api/papers.py` — DELETE endpoint response_class, return type, explicit return
- `backend/requirements.txt` — PyMuPDF version bump, pydantic loosened pin

**Key decisions**:
- `response_class=Response` disables FastAPI's automatic JSON body setup for the route, which is required when returning 204.
- Explicit `return Response(status_code=204)` rather than `return None` so the response object is unambiguous.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 1] Landing page — hero, features, CTA
**Date**: 2026-04-13
**What was done**:
- Replaced the placeholder `app/page.tsx` with a full dark-themed landing page.
- **Hero section**: Full-viewport-height centred layout. Animated gradient glow orbs (violet + blue), subtle grid overlay, animated badge pill ("AI-Powered Research Assistant"), animated gradient headline ("Your AI Research Companion") using a `gradient-text` CSS class with a `shimmer` keyframe animation. Two CTA buttons: "Get Started Free" (gradient fill, violet glow shadow) and "Try Demo →" (dark glass outline). Fade-up entry animations with staggered delays.
- **Features section**: Three dark glass cards (Cross-Paper Chat, Smart Visualizations, Citation Assistant) with gradient-border icons, top-edge gradient reveal on hover, and `-translate-y-1` lift transition.
- **How It Works section**: Three numbered steps (Upload → Ask → Get Cited Answers) with coloured icon badges and hover scale animation.
- **Bottom CTA section**: Gradient background, central glow orb, repeat "Get Started Free →" button.
- **Footer**: Minimal one-line footer.
- Activated global dark mode by adding `className="dark"` to the `<html>` element in `app/layout.tsx` — navbar and all pages now use dark CSS variable tokens by default.
- Added four new Tailwind keyframes + animations to `tailwind.config.ts`: `float`, `glow-pulse`, `fade-up`, `shimmer`.
- Added `.gradient-text` utility class to `globals.css` using `background-clip: text` with animated shimmer.
- Build verified clean: `✓ Compiled successfully`, TypeScript passed, 5 routes generated.

**Files modified**:
- `frontend/app/page.tsx` — full landing page (replaces placeholder)
- `frontend/app/layout.tsx` — added `className="dark" suppressHydrationWarning` to `<html>`
- `frontend/app/globals.css` — added `.gradient-text` class with shimmer animation
- `frontend/tailwind.config.ts` — added `float`, `glow-pulse`, `fade-up`, `shimmer` keyframes + animations

**Key decisions**:
- All animations are CSS-based (no Framer Motion or GSAP) — zero extra dependencies.
- Page is a pure Server Component — no `"use client"` needed.
- Dark mode activated globally via `class="dark"` on `<html>` (Tailwind `darkMode: ["class"]` strategy); no per-page class toggling needed for now.
- `animation-fill-mode: both` on `fade-up` ensures elements start at `opacity: 0` during delay without a flash of visible content.
- Icons are inline SVGs — consistent with login page approach, no icon library added.
- Both CTA buttons link to `/login`; "Try Demo" will point to `/demo` in Phase 7.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 1] Monorepo scaffold + Docker setup
**Date**: 2026-04-09
**What was done**:
- Created the full monorepo directory structure with `frontend/` and `backend/` at the root.
- Bootstrapped Next.js 14 app manually (App Router, TypeScript, Tailwind CSS, shadcn/ui).
- Bootstrapped FastAPI app with a modular structure (`app/main.py`, `app/api/routes.py`, `app/core/config.py`).
- Wired up docker-compose.yml with three services: `frontend`, `backend`, `chromadb`.
- Added `.env.example` with all expected environment variable placeholders.

**Files created**:
- `.env.example`
- `docker-compose.yml`
- `frontend/package.json`
- `frontend/next.config.js` — standalone output enabled for Docker
- `frontend/tsconfig.json`
- `frontend/tailwind.config.ts` — full shadcn/ui CSS variable token map
- `frontend/postcss.config.js`
- `frontend/components.json` — shadcn/ui CLI config (style: default, baseColor: slate)
- `frontend/app/globals.css` — CSS variable definitions for light + dark theme
- `frontend/app/layout.tsx` — root layout with Inter font
- `frontend/app/page.tsx` — placeholder landing page using Button + Card
- `frontend/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- `frontend/components/ui/button.tsx` — shadcn Button component
- `frontend/components/ui/card.tsx` — shadcn Card, CardHeader, CardContent, etc.
- `frontend/Dockerfile` — multi-stage Node 20 Alpine build (deps → builder → runner)
- `backend/app/__init__.py`
- `backend/app/main.py` — FastAPI app, CORS middleware, `/health` endpoint
- `backend/app/api/__init__.py`
- `backend/app/api/routes.py` — `/api/v1/ping` stub
- `backend/app/core/__init__.py`
- `backend/app/core/config.py` — pydantic-settings `Settings` class (reads `.env`)
- `backend/requirements.txt` — fastapi, uvicorn, chromadb, supabase, pydantic-settings
- `backend/Dockerfile` — python:3.11-slim, installs requirements, runs uvicorn with --reload

**Key decisions**:
- `output: "standalone"` in `next.config.js` so the Docker runner stage only needs `server.js` + `.next/static` — no `node_modules` at runtime.
- ChromaDB runs as a managed Docker service (not embedded) so both backend and future workers share the same index.
- `pydantic-settings` (v2) used for config so `.env` values are validated and typed at startup.
- Backend uses `--reload` in dev Dockerfile; production Dockerfile for Render (Phase 8) will drop that flag.
- CORS `allow_origins` is driven by `settings.CORS_ORIGINS` (default: `localhost:3000`) so it's overridable per environment.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 1] Docker build fix — npm install peer dependency conflict
**Date**: 2026-04-13
**What was done**:
- `frontend/Dockerfile` deps stage `npm install` was failing with an ERESOLVE peer dependency conflict caused by the updated `next@^16.2.3` in `package.json` conflicting with a transitive peer expectation.
- Added `--legacy-peer-deps` flag to resolve without changing any package versions.
- `package.json` was also updated (by user) to bump Next.js to `^16.2.3` and `eslint-config-next` to match; `npm ci` was replaced with `npm install` in the Dockerfile.

**Files modified**:
- `frontend/Dockerfile` — line 4: `RUN npm install` → `RUN npm install --legacy-peer-deps`

**Key decisions**:
- `--legacy-peer-deps` chosen over `--force` (less destructive; only relaxes peer resolution, does not override conflicts).
- No package versions were downgraded; the flag is the minimal fix.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 1] Supabase auth — frontend + backend
**Date**: 2026-04-13
**What was done**:

**Frontend:**
- Added `@supabase/supabase-js` and `@supabase/ssr` to `package.json`.
- Created browser Supabase client (`lib/supabase/client.ts`) via `createBrowserClient` — used in Client Components.
- Created server Supabase client (`lib/supabase/server.ts`) via `createServerClient` + `cookies()` — used in Server Components and Route Handlers. `cookies()` is awaited (Next.js 15+ API).
- Created `middleware.ts` at the project root — runs on every non-static request. Uses `getUser()` (not `getSession()`) so the JWT is always validated server-side. Redirects unauthenticated users hitting `/dashboard` or `/workspace` to `/login`. Redirects authenticated users away from `/login` to `/dashboard`.
- Created login page (`app/(auth)/login/page.tsx`) — Client Component with Google + GitHub OAuth buttons. Inline SVG icons, no icon library dependency. Passes `redirectTo` through the OAuth flow. Shows auth error message if `?error=auth_error` is present.
- Created OAuth callback route handler (`app/auth/callback/route.ts`) — exchanges the OAuth code for a session, validates that `next` is a relative path (open-redirect guard), then redirects user to their intended destination.
- Created `components/navbar.tsx` — async Server Component. Reads user from Supabase server client. Shows avatar (img if provider photo available, else email initials). Conditionally renders Dashboard link + LogoutButton (authenticated) vs Sign in link (unauthenticated).
- Created `components/logout-button.tsx` — Client Component. Calls `supabase.auth.signOut()`, then `router.push('/')` + `router.refresh()` to clear server state.
- Created `app/dashboard/page.tsx` — protected placeholder page (Phase 2 will build it out).
- Updated `app/layout.tsx` to render `<Navbar />` above `{children}`.
- Updated `.env.example` — added `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`.

**Backend:**
- Added `PyJWT==2.8.0` to `requirements.txt`.
- Added `SUPABASE_JWT_SECRET: str` field to `Settings` in `config.py`.
- Created `app/core/auth.py` — `get_current_user` FastAPI dependency. Uses `HTTPBearer` to extract the token, then `jwt.decode()` with HS256 + `audience="authenticated"` (Supabase standard). Raises 401 on expired or invalid token. Raises 500 if `SUPABASE_JWT_SECRET` is unconfigured.
- Updated `app/api/routes.py` — added `GET /api/v1/me` protected endpoint that returns JWT claims (sub, email, role). `/ping` remains public.

**Files created**:
- `frontend/lib/supabase/client.ts`
- `frontend/lib/supabase/server.ts`
- `frontend/middleware.ts`
- `frontend/app/(auth)/login/page.tsx`
- `frontend/app/auth/callback/route.ts`
- `frontend/components/navbar.tsx`
- `frontend/components/logout-button.tsx`
- `frontend/app/dashboard/page.tsx`
- `backend/app/core/auth.py`

**Files modified**:
- `frontend/package.json` — added `@supabase/supabase-js`, `@supabase/ssr`
- `frontend/app/layout.tsx` — added `<Navbar />` import and render
- `backend/app/core/config.py` — added `SUPABASE_JWT_SECRET` field
- `backend/app/api/routes.py` — added protected `/me` route
- `backend/requirements.txt` — added `PyJWT==2.8.0`
- `.env.example` — added `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`

**Key decisions**:
- `getUser()` used in middleware (not `getSession()`) — Supabase docs explicitly warn that `getSession()` trusts the client cookie without re-validating the JWT, which is insecure in middleware.
- `cookies()` is `await`ed in `server.ts` — required by Next.js 15+ async cookies API.
- Open-redirect guard in callback route: `next` param is rejected if it doesn't start with `/`.
- `PyJWT` (not `python-jose`) chosen for the backend — lighter dependency, actively maintained, same API surface for HS256.
- Supabase JWTs use `audience: "authenticated"` — this is validated in `jwt.decode()` to prevent token misuse.
- Navbar is a Server Component so auth state is resolved on the server — no client-side flash of unauthenticated state.

**Required Supabase Dashboard setup** (not in code — must be done manually):
1. Enable Google OAuth: Dashboard → Authentication → Providers → Google → enter Client ID + Secret.
2. Enable GitHub OAuth: Dashboard → Authentication → Providers → GitHub → enter Client ID + Secret.
3. Add redirect URL: `http://localhost:3000/auth/callback` to Authentication → URL Configuration → Redirect URLs.

**Deviations from plan**: None.

**Blockers**: None.

---

### [Phase 1] TypeScript fix — Supabase cookie method typing
**Date**: 2026-04-13
**What was done**:
- `npm run build` revealed a strict-mode TypeScript error (`TS2345` / implicit `any`) in `lib/supabase/server.ts` line 15: `Parameter 'cookiesToSet' implicitly has an 'any' type.`
- Root cause: `"strict": true` in tsconfig enables `noImplicitAny`; TypeScript cannot infer the `setAll` parameter type in this callback context even though `createServerClient`'s signature defines it.
- Fix: imported `type CookieOptions` (exported by `@supabase/ssr` as `Partial<CookieSerializeOptions>`) and added explicit inline parameter type to `setAll` in all three affected files.
- `app/auth/callback/route.ts` had the same issue patched with `options?: any` by the user — replaced with `options: CookieOptions`.
- Build verified clean: `✓ Compiled successfully`, `Finished TypeScript` with no errors. All 5 app routes generated.

**Files modified**:
- `frontend/lib/supabase/server.ts` — added `type CookieOptions` import; typed `setAll` parameter
- `frontend/middleware.ts` — added `type CookieOptions` import; typed `setAll` parameter
- `frontend/app/auth/callback/route.ts` — added `type CookieOptions` import; replaced `options?: any` with `options: CookieOptions`

**Key decisions**:
- `CookieOptions` imported directly from `@supabase/ssr` (confirmed exported from `dist/main/types.d.ts`) — no workarounds or `any` casts.
- `options` typed as required (not `options?`) to match the `SetAllCookies` type exported by `@supabase/ssr`.

**Note**: Next.js 16 emits a warning `The "middleware" file convention is deprecated. Please use "proxy" instead.` — this is a warning only, not an error. Rename `middleware.ts` → `proxy.ts` when ready to adopt the new convention (not blocking).

**Deviations from plan**: None.

**Blockers**: None.

---

## Current Context

> Briefing for a new developer joining mid-project:

**What exists right now:**

The repo is a monorepo with Phases 1, 2, and 3 complete.

The **frontend** (`frontend/`) is a Next.js 14+ App Router app (package.json currently pins `next@^16.2.3`). Auth is handled by `@supabase/ssr`. The middleware (`middleware.ts`) protects `/dashboard` and `/workspace` routes — unauthenticated requests are redirected to `/login`. A sticky Navbar (Server Component) reads the session and shows the user's avatar + Sign out button when logged in, or a Sign in link when not. The login page offers Google and GitHub OAuth. After OAuth, Supabase redirects to `/auth/callback` which exchanges the code for a session cookie and bounces the user to `/dashboard`. The dashboard shows:
- Page header with "My Papers" title + **LLM Settings** button (top-right)
- Drag-and-drop PDF upload zone
- Papers library grid with per-paper status badges (Queued / Indexing / Ready / Error), retry button for errored papers, and delete button

The **LLM Settings modal** (`components/settings-modal.tsx`) lets users pick a provider (OpenAI, Anthropic, Google, Groq, Ollama), enter their API key (masked, never stored server-side), choose a model, and test the connection. Settings are persisted in `sessionStorage` under `litlens_llm_settings`. `loadLLMSettings()` is exported for the chat interface.

The **backend** (`backend/`) is FastAPI on Python 3.11+. Key modules:
- `app/core/auth.py` — `get_current_user` dep using `supabase.auth.get_user(token)`
- `app/api/papers.py` — upload (multipart → Supabase Storage → ChromaDB), list (auto-triggers reprocess for `status='uploaded'`), delete, reprocess
- `app/api/llm.py` — `GET /providers` (public catalogue), `POST /test-connection` (validates key via headers)
- `app/services/llm_router.py` — async streaming abstraction over OpenAI / Anthropic / Google / Groq / Ollama
- `app/services/embedding_service.py` — chunking + sentence-transformers + ChromaDB upsert
- `app/services/processing_service.py` — background pipeline orchestrator with full print-based debug logging

**Infrastructure**: ChromaDB runs in Docker, exposed on host port 8001. `.env` must have `CHROMA_HOST=localhost CHROMA_PORT=8001` for local dev (not `chromadb` which is the Docker-internal hostname).

**What's next**: Phase 4 — RAG retrieval endpoint + streaming chat UI. Will use `loadLLMSettings()` from the settings modal + `stream_llm()` from the router + ChromaDB semantic search over the user's paper collection.

**File registry** (key files only):
| File | Purpose |
|---|---|
| `frontend/app/dashboard/page.tsx` | Dashboard — server component, renders header + SettingsModal + UploadZone |
| `frontend/components/upload-zone.tsx` | PDF upload, paper library, status polling, retry button |
| `frontend/components/settings-modal.tsx` | BYOK LLM settings modal (provider/model/key, test connection) |
| `frontend/components/navbar.tsx` | Auth-aware navbar (server component) |
| `backend/app/api/papers.py` | Paper CRUD + upload + reprocess endpoints |
| `backend/app/api/llm.py` | LLM provider catalogue + test-connection endpoint |
| `backend/app/services/llm_router.py` | Multi-provider async streaming abstraction |
| `backend/app/services/embedding_service.py` | Chunking + embedding + ChromaDB storage |
| `backend/app/services/processing_service.py` | Background pipeline (extract → chunk → embed) |
| `backend/app/services/storage_service.py` | Supabase Storage upload/download/delete |
| `backend/app/services/pdf_service.py` | PyMuPDF metadata extraction + page text |
| `backend/app/core/auth.py` | JWT validation via supabase.auth.get_user |
| `backend/app/core/config.py` | pydantic-settings (SUPABASE_*, CHROMA_*) |
| `supabase/migrations/001_papers.sql` | papers table schema + RLS |

The **backend** (`backend/`) is a FastAPI app. All config is loaded from `.env` via pydantic-settings (using an absolute path relative to `config.py` so it works regardless of uvicorn's working directory). `GET /health` is public. `GET /api/v1/ping` is public. `GET /api/v1/me` is protected — it requires a valid Supabase JWT in the `Authorization: Bearer <token>` header. The `get_current_user` dependency in `app/core/auth.py` validates tokens by calling `supabase.auth.get_user(token)` (server-side validation via the Supabase Python client — works for ES256, HS256, or any future algorithm). A global exception handler ensures CORS headers are present even on unhandled 500 responses.

**ChromaDB** is configured in docker-compose.yml — not yet used by any backend code.

**What exists right now (Phase 2.1 complete):**
- Dashboard at `/dashboard` with drag-and-drop PDF upload zone.
- Backend `POST /api/v1/papers/upload` — validates, extracts metadata via PyMuPDF, uploads to Supabase Storage, inserts into `papers` table.
- Backend `GET /api/v1/papers/` — lists user's papers.
- Backend `DELETE /api/v1/papers/{id}` — removes paper from storage + DB.
- `papers` table in Supabase (SQL migration at `supabase/migrations/001_papers.sql`).
- Papers displayed as responsive card grid in the dashboard.

**What exists right now (Phase 2.2 complete):**
- Upload triggers chunking + embedding as a FastAPI `BackgroundTask` immediately after the HTTP response.
- `embedding_service.py`: splits page text into 512-token chunks (2 048 chars), embeds with `all-MiniLM-L6-v2`, upserts into ChromaDB collection `user_{user_id}`.
- `processing_service.py`: orchestrates the pipeline — sets `status='processing'`, runs extraction + embedding, sets `status='ready'` or `status='error'`.
- Dashboard polls `GET /api/v1/papers/` every 3 s while any paper is indexing; shows animated status badges per card (Queued → Indexing → Ready / Error).

**What does NOT exist yet:**
- RAG search / retrieval endpoint over ChromaDB (Phase 4)
- Any LLM integration (Phase 3+)
- Chat, citations, or visualizations (Phase 4–6)
- Dashboard sidebar / workspace grouping (later Phase 2)
- Demo workspace (Phase 7)

**What to do next (Phase 2 remainder / Phase 3):**
- Dashboard sidebar navigation + workspace grouping (Phase 2 remainder)
- BYOK LLM provider abstraction + API key storage (Phase 3)
- RAG retrieval endpoint using the ChromaDB collections built in Phase 2.2 (Phase 4)

**Required manual Supabase setup before auth works:**
1. Enable Google: Dashboard → Auth → Providers → Google → enter OAuth app credentials.
2. Enable GitHub: Dashboard → Auth → Providers → GitHub → enter OAuth app credentials.
3. Add redirect URL `http://localhost:3000/auth/callback` to Auth → URL Configuration → Redirect URLs.

**Local dev quick-start:**
```bash
cp .env.example .env                    # fill in all Supabase values
docker compose up --build               # frontend :3000, backend :8000, chromadb :8001
# OR run each service locally:
cd frontend && npm install --legacy-peer-deps && npm run dev
cd backend  && pip install -r requirements.txt && uvicorn app.main:app --reload
```

---

## File Registry

| File | Description |
|---|---|
| `.env.example` | Template for all env vars — Supabase (public + server), ChromaDB, API URL |
| `docker-compose.yml` | Orchestrates frontend, backend, and ChromaDB services |
| `PROGRESS.md` | This file — project memory, task checklist, completed log, current context, file registry |
| `frontend/package.json` | Node dependencies: Next.js, React 18, Supabase SSR, shadcn/ui primitives, Tailwind |
| `frontend/next.config.js` | Next.js config — `output: "standalone"` for lean Docker image |
| `frontend/tsconfig.json` | TypeScript config — strict mode, `@/*` path alias |
| `frontend/tailwind.config.ts` | Tailwind config — full shadcn/ui CSS variable token map, `tailwindcss-animate` |
| `frontend/postcss.config.js` | PostCSS config — tailwindcss + autoprefixer |
| `frontend/components.json` | shadcn/ui CLI config — style: default, baseColor: slate, CSS variables |
| `frontend/Dockerfile` | Multi-stage Node 20 Alpine build; uses `--legacy-peer-deps` for peer conflict |
| `frontend/middleware.ts` | Route protection — redirects unauthenticated users from /dashboard + /workspace to /login |
| `frontend/app/globals.css` | Tailwind directives + CSS variable definitions for light + dark theme |
| `frontend/app/layout.tsx` | Root layout — Inter font, renders `<Navbar />` above all pages |
| `frontend/app/page.tsx` | Landing page — hero (animated glow + gradient text), 3 feature cards, How It Works, CTA |
| `frontend/app/(auth)/login/page.tsx` | Login page — Google + GitHub OAuth buttons, passes redirectTo through flow |
| `frontend/app/auth/callback/route.ts` | OAuth callback route handler — exchanges code for session, open-redirect guarded |
| `frontend/app/dashboard/page.tsx` | Dashboard — Server Component header, renders UploadZone client component |
| `frontend/components/upload-zone.tsx` | Client Component — drag-drop PDF upload, per-file XHR progress, papers card grid, delete |
| `supabase/migrations/001_papers.sql` | SQL migration — papers table, RLS policies, updated_at trigger, user_id index |
| `backend/app/services/pdf_service.py` | PDF parsing — extract_metadata (embedded + heuristic), extract_pages (per-page text) |
| `backend/app/services/storage_service.py` | Supabase Storage helpers — upload_pdf, delete_pdf (service-role client) |
| `backend/app/api/papers.py` | Papers API — POST /upload (triggers background processing), GET /, DELETE /{id} |
| `backend/app/services/embedding_service.py` | Chunking + embedding + ChromaDB upsert; `embed_paper()`, `delete_paper_chunks()` |
| `backend/app/services/processing_service.py` | Background pipeline orchestrator; `process_paper()` updates paper status in Supabase |
| `frontend/lib/utils.ts` | `cn()` utility — clsx + tailwind-merge |
| `frontend/lib/supabase/client.ts` | Supabase browser client — used in Client Components (`createBrowserClient`) |
| `frontend/lib/supabase/server.ts` | Supabase server client — used in Server Components + Route Handlers (`createServerClient`) |
| `frontend/components/navbar.tsx` | Sticky top nav — Server Component, shows avatar/logout (authed) or Sign in (unauthed) |
| `frontend/components/logout-button.tsx` | Client Component — calls `supabase.auth.signOut()` and refreshes router |
| `frontend/components/ui/button.tsx` | shadcn Button with variant/size CVA system |
| `frontend/components/ui/card.tsx` | shadcn Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| `backend/Dockerfile` | Python 3.11-slim — installs requirements, runs uvicorn with --reload |
| `backend/requirements.txt` | Python deps: fastapi, uvicorn, PyJWT[crypto], cryptography, chromadb>=1.0.0, supabase, pydantic-settings, httpx, langchain-text-splitters, sentence-transformers |
| `backend/app/__init__.py` | Package marker |
| `backend/app/main.py` | FastAPI entry point — CORS middleware, router registration, `/health` endpoint |
| `backend/app/api/__init__.py` | Package marker |
| `backend/app/api/routes.py` | API routes — public `/ping`, protected `/me` (requires valid Supabase JWT) |
| `backend/app/core/__init__.py` | Package marker |
| `backend/app/core/config.py` | pydantic-settings `Settings` — SUPABASE_URL, SUPABASE_KEY, SUPABASE_JWT_SECRET, CHROMA_* |
| `backend/app/core/auth.py` | `get_current_user` FastAPI dependency — validates Supabase JWT via `supabase.auth.get_user(token)` (works for ES256 / any algorithm) |
