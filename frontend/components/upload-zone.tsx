"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  FileText,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
  XCircle,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/toast";
import { API_URL } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const POLL_INTERVAL_MS = 3_000;          // poll every 3 s while any paper is processing

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface UploadEntry {
  id: string;
  filename: string;
  sizeBytes: number;
  progress: number; // 0–100
  status: UploadStatus;
  errorMsg?: string;
}

interface Paper {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  filename: string;
  file_size_bytes: number;
  page_count: number;
  status: string; // uploaded | processing | ready | error
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Indexing…
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
        <Zap className="h-3 w-3" />
        Ready
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
        <XCircle className="h-3 w-3" />
        Error
      </span>
    );
  }
  // "uploaded" — queued for processing, shown briefly before backend picks it up
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
      <Loader2 className="h-3 w-3 animate-spin" />
      Queued
    </span>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadRow({ entry }: { entry: UploadEntry }) {
  const icon =
    entry.status === "done" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    ) : entry.status === "error" ? (
      <XCircle className="h-4 w-4 text-red-400" />
    ) : entry.status === "uploading" ? (
      <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
    ) : (
      <FileText className="h-4 w-4 text-slate-500" />
    );

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-700/60 bg-slate-800/50 px-4 py-3">
      <div className="shrink-0">{icon}</div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">
          {entry.filename}
        </p>

        {entry.status === "uploading" && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-200"
              style={{ width: `${entry.progress}%` }}
            />
          </div>
        )}

        {entry.status === "error" && (
          <p className="mt-0.5 text-xs text-red-400">{entry.errorMsg}</p>
        )}
        {entry.status === "done" && (
          <p className="mt-0.5 text-xs text-emerald-400">Uploaded — indexing in background</p>
        )}
        {entry.status === "queued" && (
          <p className="mt-0.5 text-xs text-slate-500">Queued…</p>
        )}
      </div>

      <span className="shrink-0 text-xs text-slate-500">
        {formatBytes(entry.sizeBytes)}
      </span>
    </div>
  );
}

function PaperCard({
  paper,
  onDelete,
  onStatusChange,
}: {
  paper: Paper;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const supabase = createClient();

  async function handleDelete() {
    setDeleting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      await fetch(`${API_URL}/api/v1/papers/${paper.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success(`"${paper.title || paper.filename}" removed`);
      onDelete(paper.id);
    } catch {
      setDeleting(false);
      toast.error("Failed to delete paper");
    }
  }

  async function handleReprocess() {
    setRetrying(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      const r = await fetch(`${API_URL}/api/v1/papers/${paper.id}/reprocess`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        onStatusChange(paper.id, "processing");
      }
    } catch {
      // silently ignore
    } finally {
      setRetrying(false);
    }
  }

  const isProcessing = paper.status === "processing" || paper.status === "uploaded";
  const canRetry = paper.status === "error";

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:border-slate-700 hover:bg-slate-900/90">
      {/* Action buttons — top-right corner */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
        {canRetry && (
          <button
            onClick={handleReprocess}
            disabled={retrying}
            className="rounded-md p-1.5 text-slate-600 hover:bg-amber-500/10 hover:text-amber-400 disabled:pointer-events-none"
            aria-label="Retry indexing"
            title="Retry indexing"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {!isProcessing && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-md p-1.5 text-slate-600 hover:bg-red-500/10 hover:text-red-400 disabled:pointer-events-none"
            aria-label="Delete paper"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
          <FileText className="h-5 w-5 text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">
            {paper.title || paper.filename}
          </h3>
          {paper.authors && (
            <p className="mt-1 truncate text-xs text-slate-400">
              {paper.authors}
            </p>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={paper.status} />

        {paper.year && (
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
            <Calendar className="h-3 w-3" />
            {paper.year}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
          <BookOpen className="h-3 w-3" />
          {paper.page_count} {paper.page_count === 1 ? "page" : "pages"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
          <HardDrive className="h-3 w-3" />
          {formatBytes(paper.file_size_bytes)}
        </span>
      </div>

      <p className="text-xs text-slate-600">{formatDate(paper.created_at)}</p>
    </div>
  );
}

function EmptyPapers() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-16 text-center">
      <BookOpen className="mb-3 h-8 w-8 text-slate-700" />
      <p className="text-sm font-medium text-slate-500">No papers yet</p>
      <p className="mt-1 text-xs text-slate-600">
        Upload your first PDF above to get started.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UploadZone({ projectId }: { projectId?: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [token, setToken] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);

  // ── Auth token ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? "");
    });
  }, []);

  // ── Fetch existing papers (re-runs when projectId changes) ─────────────────
  useEffect(() => {
    if (!token) return;
    setLoadingPapers(true);
    const url = projectId
      ? `${API_URL}/api/v1/papers/?project_id=${projectId}`
      : `${API_URL}/api/v1/papers/`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: Paper[]) => setPapers(data))
      .catch(() => {/* backend may not be running yet */})
      .finally(() => setLoadingPapers(false));
  }, [token, projectId]);

  // ── Poll while any paper is processing ─────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const needsPoll = papers.some(
      (p) => p.status === "processing" || p.status === "uploaded"
    );
    if (!needsPoll) return;

    const url = projectId
      ? `${API_URL}/api/v1/papers/?project_id=${projectId}`
      : `${API_URL}/api/v1/papers/`;

    const id = setInterval(async () => {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) setPapers(await r.json());
      } catch { /* silently ignore */ }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [token, papers, projectId]);

  // ── Upload helpers ──────────────────────────────────────────────────────────

  const patchEntry = useCallback(
    (id: string, patch: Partial<UploadEntry>) =>
      setUploads((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
      ),
    []
  );

  /** Upload a single file with XHR so we get upload-progress events. */
  function xhrUpload(
    file: File,
    entryId: string,
    tok: string
  ): Promise<Paper[]> {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append("files", file);
      if (projectId) body.append("project_id", projectId);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          patchEntry(entryId, {
            progress: Math.round((e.loaded / e.total) * 100),
            status: "uploading",
          });
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as Paper[]);
          } catch {
            reject(new Error("Invalid server response."));
          }
        } else {
          try {
            const body = JSON.parse(xhr.responseText) as { detail?: string };
            reject(new Error(body.detail ?? `HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Network error.")));
      xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));

      xhr.open("POST", `${API_URL}/api/v1/papers/upload`);
      xhr.setRequestHeader("Authorization", `Bearer ${tok}`);
      xhr.send(body);
    });
  }

  /** Fetch a guaranteed-fresh access token, refreshing the session if needed. */
  async function getFreshToken(): Promise<string> {
    const supabase = createClient();
    await supabase.auth.getUser();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  /** Process a list of {entry, file} pairs sequentially. */
  async function processQueue(
    queue: Array<{ entry: UploadEntry; file: File }>
  ) {
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;

    for (const { entry, file } of queue) {
      try {
        patchEntry(entry.id, { status: "uploading" });
        const tok = await getFreshToken();
        if (!tok) {
          patchEntry(entry.id, { status: "error", errorMsg: "Not signed in." });
          continue;
        }
        const created = await xhrUpload(file, entry.id, tok);
        patchEntry(entry.id, { status: "done", progress: 100 });
        toast.success(`"${file.name}" uploaded successfully`);
        setPapers((prev) => [...created, ...prev]);
      } catch (err) {
        const msg = (err as Error).message;
        patchEntry(entry.id, { status: "error", errorMsg: msg });
        toast.error(`Upload failed: ${msg}`);
      }
    }

    isUploadingRef.current = false;
  }

  const handleFiles = useCallback(
    (rawFiles: File[]) => {
      const valid: File[] = [];
      for (const f of rawFiles) {
        if (!f.name.toLowerCase().endsWith(".pdf")) continue;
        if (f.size > MAX_FILE_BYTES) continue;
        valid.push(f);
      }
      if (!valid.length) return;

      const queue = valid.map((file) => ({
        entry: {
          id: crypto.randomUUID(),
          filename: file.name,
          sizeBytes: file.size,
          progress: 0,
          status: "queued" as UploadStatus,
        },
        file,
      }));

      setUploads((prev) => [...prev, ...queue.map((q) => q.entry)]);
      processQueue(queue);
    },
    [patchEntry]
  );

  // ── Drag events ─────────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const handleDelete = (id: string) =>
    setPapers((prev) => prev.filter((p) => p.id !== id));

  const handleStatusChange = (id: string, newStatus: string) =>
    setPapers((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: newStatus } : p))
    );

  // ── Render ──────────────────────────────────────────────────────────────────

  const processingCount = papers.filter(
    (p) => p.status === "processing" || p.status === "uploaded"
  ).length;

  return (
    <div className="space-y-8">
      {/* ── Drop zone ── */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload PDF files"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        className={[
          "relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-all duration-200 select-none outline-none",
          isDragging
            ? "border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10"
            : "border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/60",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf"
          onChange={handleInputChange}
          className="hidden"
        />

        <div
          className={[
            "flex h-16 w-16 items-center justify-center rounded-2xl border transition-colors duration-200",
            isDragging
              ? "border-violet-500/40 bg-violet-500/20"
              : "border-slate-700 bg-slate-800",
          ].join(" ")}
        >
          <UploadCloud
            className={[
              "h-8 w-8 transition-colors duration-200",
              isDragging ? "text-violet-400" : "text-slate-400",
            ].join(" ")}
          />
        </div>

        <div>
          <p className="text-base font-medium text-slate-200">
            {isDragging ? "Drop PDFs here" : "Drop PDFs here or click to browse"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            PDF only · up to 100 MB per file · multiple files supported
          </p>
        </div>
      </div>

      {/* ── Upload queue ── */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Uploads
          </h3>
          {uploads.map((entry) => (
            <UploadRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* ── Papers library ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Your Papers
          </h3>
          <div className="flex items-center gap-3">
            {processingCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Indexing {processingCount} {processingCount === 1 ? "paper" : "papers"}…
              </span>
            )}
            {papers.length > 0 && (
              <span className="text-xs text-slate-600">
                {papers.length} {papers.length === 1 ? "paper" : "papers"}
              </span>
            )}
          </div>
        </div>

        {loadingPapers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
          </div>
        ) : papers.length === 0 ? (
          <EmptyPapers />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {papers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                onDelete={handleDelete}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
