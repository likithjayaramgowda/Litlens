# LitLens

AI-powered research assistant for academic papers. Upload PDFs, ask questions across your library, compare methodologies, generate citations, and visualise connections — all from one workspace.

---

## Features

| Feature | Description |
|---|---|
| **RAG Chat** | Semantic search over uploaded papers; responses cite exact pages |
| **Comparison Tables** | Side-by-side methodology / results / limitations across 2–6 papers |
| **Knowledge Graph** | Force-directed graph of shared concepts extracted by LLM |
| **Paper Timeline** | Chronological view of publications in a project |
| **Theme Clustering** | LLM groups papers into 3–6 thematic clusters |
| **Citation Assistant** | Tiptap editor with real-time citation suggestions, draft verification, and bibliography export (APA, MLA, IEEE, Harvard, Chicago) |
| **Project Spaces** | Isolated workspaces; each chat and analysis is scoped to a project |
| **Free-tier LLM** | One server-side OpenRouter key — users need no API key of their own |
| **BYOK** | Optional DeepSeek key in Advanced Settings for unlimited queries |

---

## Architecture

```
Browser
  │
  ├── Next.js 14 (Vercel)          ← frontend/
  │     App Router, TypeScript, Tailwind, shadcn/ui
  │
  └── FastAPI (Render)             ← backend/
        │
        ├── Supabase Postgres      ← papers, projects, conversations, messages, drafts
        ├── Supabase Storage       ← PDF files (bucket: "Papers")
        ├── Supabase Auth          ← JWT-based; backend verifies via JWKS
        ├── ChromaDB 0.6.3         ← vector store, persisted to /app/chroma_db
        │     PersistentClient — one collection per user (user_{user_id})
        ├── sentence-transformers  ← all-MiniLM-L6-v2 (384-dim, ~80 MB)
        └── OpenRouter             ← free-tier LLM (GLM-4.5 Air / DeepSeek R1 / Nemotron)
```

---

## Quick Start (local)

### Prerequisites

- Node.js 20+
- Python 3.11+
- A [Supabase](https://supabase.com) project
- An [OpenRouter](https://openrouter.ai) API key (free)

### 1. Clone and configure

```bash
git clone https://github.com/your-username/litlens.git
cd litlens
cp backend/.env.example .env
# Edit .env — fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY
```

### 2. Run Supabase migrations

Open the Supabase SQL Editor and run each file in order:

```
backend/supabase/migrations/001_init.sql
backend/supabase/migrations/002_papers.sql
backend/supabase/migrations/003_query_usage.sql
backend/supabase/migrations/004_chat_tables.sql
backend/supabase/migrations/005_projects.sql
backend/supabase/migrations/006_backfill_unsorted.sql
backend/supabase/migrations/007_drafts.sql
```

### 3. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4. Start the frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Docker Compose (alternative)

```bash
docker compose up --build
```

This starts backend (port 8000) and frontend (port 3000). ChromaDB data is persisted in the `chroma_data` named volume.

---

## Deployment

### Backend → Render

**Option A — Render Blueprint (recommended)**

1. Push to GitHub.
2. Render dashboard → **New** → **Blueprint** → connect your repo.
3. Render reads `render.yaml` automatically.
4. Fill in the environment variable values (Supabase keys, OpenRouter key, CORS_ORIGINS).
5. Click **Apply**.

> The Blueprint configures a 1 GB persistent disk mounted at `/app/chroma_db`. Use the **Starter** plan or above — the free tier has no persistent disk and ChromaDB data is lost on restart.

**Option B — Manual**

1. Render dashboard → **New Web Service** → **Docker** → connect repo.
2. Set **Dockerfile path**: `./backend/Dockerfile`, **Docker context**: `./backend`.
3. Add a **Disk**: 1 GB, mount path `/app/chroma_db`.
4. Add environment variables (see `.env.example`).

**Required env vars on Render:**

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API (leave blank for ES256 projects) |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `CORS_ORIGINS` | `["https://your-app.vercel.app"]` (JSON array string) |

### Frontend → Vercel

```bash
cd frontend
vercel --prod
```

Or connect the repo in the Vercel dashboard and set the **Root Directory** to `frontend`.

**Required env vars on Vercel:**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `NEXT_PUBLIC_API_URL` | Your Render backend URL (e.g. `https://litlens-backend.onrender.com`) |

### After first deployment — re-embed papers

If you're migrating existing papers to a fresh backend deployment, run the reprocess script once to populate ChromaDB:

```bash
cd litlens
PYTHONIOENCODING=utf-8 python backend/scripts/reprocess_papers.py
```

This downloads each paper from Supabase Storage, re-chunks and re-embeds it, and writes the vectors to ChromaDB.

---

## Project Structure

```
litlens/
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI routers (chat, papers, compare, themes, graph, …)
│   │   ├── core/         # config, auth, chroma, rate_limit
│   │   └── services/     # embedding, retrieval, processing, citation, LLM router, …
│   ├── scripts/
│   │   └── reprocess_papers.py   # one-time re-embedding utility
│   ├── supabase/migrations/      # SQL migration files (run in Supabase SQL Editor)
│   ├── chroma_db/                # local ChromaDB data (git-ignored)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # React components
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── render.yaml           # Render Blueprint
└── .env.example          # copy to .env and fill in secrets
```

---

## Environment Variables

All vars live in a single `.env` file at the project root. The backend reads it at startup; the frontend reads `NEXT_PUBLIC_*` vars at build time.

See `.env.example` for the full list with descriptions.

---

## Key Design Decisions

**ChromaDB PersistentClient** — runs embedded inside the FastAPI process; no separate server. Data lives in `backend/chroma_db/`. One collection per user (`user_{user_id}`), cosine-distance space, `all-MiniLM-L6-v2` embeddings (384-dim).

**OpenRouter free tier** — one server-side `OPENROUTER_API_KEY` serves all users. Three tiers: Quick (GLM-4.5 Air), Deep Thinking (DeepSeek R1), Long Context (Nemotron 120B). On 429, falls back to `openrouter/free`. Users optionally add a DeepSeek key in Advanced Settings for unlimited queries.

**Supabase Auth** — the backend verifies JWTs via JWKS (ES256); no shared JWT secret needed for modern projects. The service-role key is used for server-side DB writes that bypass RLS.

**RAG pipeline** — on each chat message: embed query → `collection.query()` top-25 chunks filtered by project paper_ids → balance (max 3 chunks/paper) → minimum-coverage pass (guarantee ≥ 2 chunks/paper) → system prompt with paper excerpts → stream LLM response.

**Chunk IDs are deterministic** — `{paper_id}_p{page}_c{chunk_index}`, so re-processing a paper is safe (upsert is idempotent).
