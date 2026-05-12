FROM python:3.11-slim

WORKDIR /app

# Build tools needed for chroma-hnswlib wheel compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the sentence-transformers model at build time so the first
# request doesn't stall waiting for a ~80 MB download.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

# ChromaDB persists to /app/chroma_db — mount a volume here to survive restarts.
# On Render: add a Disk (1 GB) mounted at /app/chroma_db in the dashboard.
# Locally: docker-compose maps ./backend/chroma_db → /app/chroma_db via named volume.
VOLUME ["/app/chroma_db"]

EXPOSE 8000

# Single uvicorn process — safe with ChromaDB PersistentClient (no multi-writer conflicts).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "120"]
