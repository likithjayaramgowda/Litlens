# LitLens — Project Progress & Context Tracker

> **CRITICAL RULE**: Before starting ANY new task, read this file first.
> After finishing ANY task, update this file before doing anything else.

---

## Project Overview

| Field | Value |
|---|---|
| **Project** | LitLens — AI-powered document search & analysis |
| **Current Phase** | Phase 2: PDF Pipeline (Phase 1 complete ✅) |
| **Frontend** | Next.js 14, App Router, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | FastAPI (Python 3.11), pydantic-settings |
| **Vector DB** | ChromaDB |
| **Auth / DB** | Supabase (auth + Postgres) |
| **LLM Layer** | BYOK — OpenAI / Anthropic / Gemini / Groq / Ollama (Phase 3) |
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
- ⬜ PDF chunking (PyMuPDF text splitter + page-aware chunks)
- ⬜ Embedding generation (configurable model, stored in ChromaDB)
- ⬜ Dashboard layout (sidebar nav, workspace list)
- ⬜ Workspaces (create / rename / delete, per-user isolation)

### Phase 3: BYOK LLM Router
- ⬜ Provider abstraction layer (OpenAI / Anthropic / Gemini / Groq / Ollama)
- ⬜ API key storage (encrypted, per-user in Supabase)
- ⬜ LLM router — select active provider + model at request time
- ⬜ Settings UI (add/remove provider keys, set default model)

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

The repo is a monorepo with full auth wired up end-to-end.

The **frontend** (`frontend/`) is a Next.js 14+ App Router app (package.json currently pins `next@^16.2.3`). Auth is handled by `@supabase/ssr`. The middleware (`middleware.ts`) protects `/dashboard` and `/workspace` routes — unauthenticated requests are redirected to `/login`. A sticky Navbar (Server Component) reads the session and shows the user's avatar + Sign out button when logged in, or a Sign in link when not. The login page offers Google and GitHub OAuth. After OAuth, Supabase redirects to `/auth/callback` which exchanges the code for a session cookie and bounces the user to `/dashboard`. The dashboard is currently a placeholder.

The **backend** (`backend/`) is a FastAPI app. All config is loaded from `.env` via pydantic-settings. `GET /health` is public. `GET /api/v1/ping` is public. `GET /api/v1/me` is protected — it requires a valid Supabase JWT in the `Authorization: Bearer <token>` header. The `get_current_user` dependency in `app/core/auth.py` validates the JWT using PyJWT with HS256 and audience `"authenticated"`.

**ChromaDB** is configured in docker-compose.yml — not yet used by any backend code.

**What exists right now (Phase 2.1 complete):**
- Dashboard at `/dashboard` with drag-and-drop PDF upload zone.
- Backend `POST /api/v1/papers/upload` — validates, extracts metadata via PyMuPDF, uploads to Supabase Storage, inserts into `papers` table.
- Backend `GET /api/v1/papers/` — lists user's papers.
- Backend `DELETE /api/v1/papers/{id}` — removes paper from storage + DB.
- `papers` table in Supabase (SQL migration at `supabase/migrations/001_papers.sql`).
- Papers displayed as responsive card grid in the dashboard.

**What does NOT exist yet:**
- PDF chunking and embedding (Phase 2.2) — `status` stays `"uploaded"`, not `"ready"` yet
- Any LLM integration (Phase 3+)
- Chat, citations, or visualizations (Phase 4–6)
- Dashboard sidebar / workspace grouping (later Phase 2)
- Demo workspace (Phase 7)

**What to do next (Phase 2.2):**
1. PDF chunking — use `extract_pages()` already in `pdf_service.py`, split into ~512-token chunks with 50-token overlap, store chunk text + page number + paper_id.
2. Embedding generation — embed each chunk using a configurable model (sentence-transformers or OpenAI), upsert into ChromaDB with metadata.
3. Update paper `status` → `"processing"` then `"ready"` (or `"error"`) after the pipeline runs.
4. This can be triggered synchronously on upload (Phase 2.2) or via a background task (Phase 3+).

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
| `backend/app/api/papers.py` | Papers API — POST /upload, GET /, DELETE /{id} (all auth-protected) |
| `frontend/lib/utils.ts` | `cn()` utility — clsx + tailwind-merge |
| `frontend/lib/supabase/client.ts` | Supabase browser client — used in Client Components (`createBrowserClient`) |
| `frontend/lib/supabase/server.ts` | Supabase server client — used in Server Components + Route Handlers (`createServerClient`) |
| `frontend/components/navbar.tsx` | Sticky top nav — Server Component, shows avatar/logout (authed) or Sign in (unauthed) |
| `frontend/components/logout-button.tsx` | Client Component — calls `supabase.auth.signOut()` and refreshes router |
| `frontend/components/ui/button.tsx` | shadcn Button with variant/size CVA system |
| `frontend/components/ui/card.tsx` | shadcn Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| `backend/Dockerfile` | Python 3.11-slim — installs requirements, runs uvicorn with --reload |
| `backend/requirements.txt` | Python deps: fastapi, uvicorn, PyJWT, chromadb, supabase, pydantic-settings, httpx |
| `backend/app/__init__.py` | Package marker |
| `backend/app/main.py` | FastAPI entry point — CORS middleware, router registration, `/health` endpoint |
| `backend/app/api/__init__.py` | Package marker |
| `backend/app/api/routes.py` | API routes — public `/ping`, protected `/me` (requires valid Supabase JWT) |
| `backend/app/core/__init__.py` | Package marker |
| `backend/app/core/config.py` | pydantic-settings `Settings` — SUPABASE_URL, SUPABASE_KEY, SUPABASE_JWT_SECRET, CHROMA_* |
| `backend/app/core/auth.py` | `get_current_user` FastAPI dependency — validates Supabase JWT via PyJWT (HS256) |
