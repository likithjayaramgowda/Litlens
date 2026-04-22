"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RefreshCw,
  TableIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Paper {
  id: string;
  title: string;
  authors?: string | null;
  year?: number | null;
  status: string;
}

interface CompareResult {
  papers: { paper_id: string; title: string; authors: string; year: number | null }[];
  dimensions: string[];
  cells: Record<string, Record<string, string>>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_DIMENSIONS = [
  { id: "methodology",  label: "Methodology" },
  { id: "dataset",      label: "Dataset" },
  { id: "results",      label: "Results" },
  { id: "limitations",  label: "Limitations" },
  { id: "key_findings", label: "Key Findings" },
  { id: "research_gap", label: "Research Gap" },
];

const DIM_LABEL: Record<string, string> = Object.fromEntries(
  ALL_DIMENSIONS.map((d) => [d.id, d.label])
);

// Papers with any of these statuses are considered processable
const READY_STATUSES = new Set(["ready", "embedded", "complete"]);

const CONTRAST_RE = /\b(contrast|unlike|however|whereas|conversely|differ|opposite|limitation|weakness|drawback)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// ── Cell ──────────────────────────────────────────────────────────────────────

function CellContent({
  text,
  cellKey,
  expanded,
  onToggle,
}: {
  text: string;
  cellKey: string;
  expanded: boolean;
  onToggle: (key: string) => void;
}) {
  const isContrast = CONTRAST_RE.test(text);
  const long = text.length > 300;
  const display = long && !expanded ? text.slice(0, 300) + "…" : text;

  return (
    <div
      className={`rounded-lg px-3 py-2.5 text-sm leading-relaxed text-slate-300 ${
        isContrast ? "bg-amber-950/30 ring-1 ring-amber-600/30" : ""
      }`}
    >
      <p className="whitespace-normal break-words">{display}</p>
      {long && (
        <button
          type="button"
          onClick={() => onToggle(cellKey)}
          className="mt-1.5 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {expanded ? (
            <><ChevronUp className="h-3 w-3" />▲ Show less</>
          ) : (
            <><ChevronDown className="h-3 w-3" />▼ Show more</>
          )}
        </button>
      )}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton({ cols, dims }: { cols: number; dims: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-950/80">
            <th className="w-44 min-w-[11rem] px-4 py-3" />
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="min-w-[200px] px-4 py-3">
                <div className="h-4 w-32 animate-pulse rounded bg-slate-700" />
                <div className="mt-1.5 h-3 w-16 animate-pulse rounded bg-slate-800" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: dims }).map((_, ri) => (
            <tr key={ri} className="border-b border-slate-800/60">
              <td className="w-44 bg-slate-900/50 px-4 py-3">
                <div className="h-3.5 w-24 animate-pulse rounded bg-slate-700" />
              </td>
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={ci} className="px-4 py-4">
                  <div className="h-3 w-full animate-pulse rounded bg-slate-800 mb-2" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-slate-800 mb-2" />
                  <div className="h-3 w-3/5 animate-pulse rounded bg-slate-800" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ComparisonTable({ projectId }: { projectId: string }) {
  const [papers, setPapers]               = useState<Paper[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [selectedIds, setSelectedIds]     = useState<string[]>([]);
  const [selectedDims, setSelectedDims]   = useState<string[]>(ALL_DIMENSIONS.map((d) => d.id));
  const [loading, setLoading]             = useState(false);
  const [result, setResult]               = useState<CompareResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());

  const getToken = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  // ── Fetch papers ───────────────────────────────────────────────────────────

  const loadPapers = useCallback(async () => {
    setLoadingPapers(true);
    setFetchError(null);
    try {
      const token = await getToken();
      // Fetch project papers first; fall back to all user papers if none returned.
      // Papers uploaded outside the project context have no project_id in the DB.
      const r1 = await fetch(`${API_URL}/api/v1/papers/?project_id=${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r1.ok) throw new Error(`Papers API returned ${r1.status}`);
      const projectPapers: Paper[] = await r1.json();

      if (projectPapers.length > 0) {
        setPapers(projectPapers);
      } else {
        // Fallback: all user papers (covers papers uploaded without project_id)
        const r2 = await fetch(`${API_URL}/api/v1/papers/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r2.ok) throw new Error(`Papers API returned ${r2.status}`);
        setPapers(await r2.json());
      }
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setLoadingPapers(false);
    }
  }, [projectId, getToken]);

  useEffect(() => { loadPapers(); }, [loadPapers]);

  // Cycle progress message phases while loading
  useEffect(() => {
    if (!loading) { setLoadingPhase(0); return; }
    const t1 = setTimeout(() => setLoadingPhase(1), 10_000);
    const t2 = setTimeout(() => setLoadingPhase(2), 22_000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loading]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function togglePaper(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : prev.length < 6 ? [...prev, id] : prev
    );
  }

  function toggleCell(key: string) {
    setExpandedCells((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleDim(id: string) {
    setSelectedDims((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((d) => d !== id) : prev; // keep at least 1
      }
      return [...prev, id];
    });
  }

  async function runCompare() {
    if (selectedIds.length < 2 || selectedDims.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/v1/compare`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          paper_ids: selectedIds,
          dimensions: selectedDims,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        throw new Error(err.detail ?? "Comparison failed");
      }
      setResult(await r.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!result) return;
    const header = ["Dimension", ...result.papers.map((p) => `${p.title} (${p.year ?? "n.d."})`)];
    const rows = result.dimensions.map((dim) => [
      DIM_LABEL[dim] ?? dim,
      ...result.papers.map((p) => result.cells[p.paper_id]?.[dim] ?? ""),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paper_comparison.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  // Accept any status that means the paper is fully processed
  const readyPapers = papers.filter(
    (p) => READY_STATUSES.has(p.status) || p.status?.startsWith("ready")
  );
  const canCompare = selectedIds.length >= 2 && selectedDims.length >= 1 && !loading;

  // Phase-aware loading label (changes every ~10s for multi-batch calls)
  const mid = Math.ceil(selectedIds.length / 2);
  const loadingLabel = (() => {
    if (!loading) return "";
    if (selectedIds.length >= 4) {
      if (loadingPhase === 0) return `Analyzing papers 1–${mid}…`;
      if (loadingPhase === 1) return `Analyzing papers ${mid + 1}–${selectedIds.length}…`;
      return "Building table…";
    }
    return loadingPhase >= 1 ? "Building table…" : "Analyzing papers…";
  })();

  const hasContrast = result
    ? result.dimensions.some((d) =>
        result.papers.some((p) => CONTRAST_RE.test(result.cells[p.paper_id]?.[d] ?? ""))
      )
    : false;

  // ── Loading papers ─────────────────────────────────────────────────────────

  if (loadingPapers) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-red-800/40 py-16 text-center gap-3">
        <TableIcon className="h-8 w-8 text-red-700" />
        <p className="text-base font-medium text-red-400">Failed to load papers</p>
        <p className="text-sm text-slate-500">{fetchError}</p>
        <button
          type="button"
          onClick={loadPapers}
          className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (readyPapers.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 py-16 text-center">
        <TableIcon className="mb-3 h-8 w-8 text-slate-700" />
        <p className="text-base font-medium text-slate-500">Not enough papers</p>
        <p className="mt-1.5 max-w-sm text-sm text-slate-600">
          Upload and process at least 2 papers to generate a comparison table.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          {papers.length === 0
            ? "No papers found."
            : `${papers.length} paper${papers.length !== 1 ? "s" : ""} found — statuses: ${[...new Set(papers.map((p) => p.status))].join(", ")}`}
        </p>
        <button
          type="button"
          onClick={loadPapers}
          className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Paper selector ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Select papers
          </p>
          <span className="text-xs text-slate-600">
            {selectedIds.length} of 6 selected
          </span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {readyPapers.map((paper) => {
            const checked  = selectedIds.includes(paper.id);
            const disabled = !checked && selectedIds.length >= 6;
            return (
              <label
                key={paper.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                  checked
                    ? "border-violet-500/40 bg-violet-500/10"
                    : disabled
                    ? "cursor-not-allowed border-slate-800 opacity-40"
                    : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => togglePaper(paper.id)}
                  className="mt-0.5 shrink-0 accent-violet-500"
                />
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-medium leading-snug text-slate-200">
                    {paper.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {paper.authors && <span>{paper.authors}</span>}
                    {paper.authors && paper.year && <span> · </span>}
                    {paper.year && <span>{paper.year}</span>}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── Dimension pill toggles ───────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Dimensions
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_DIMENSIONS.map((d) => {
            const on = selectedDims.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDim(d.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  on
                    ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                    : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Compare button ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={runCompare}
          disabled={!canCompare}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {loadingLabel}</>
          ) : (
            <><TableIcon className="h-4 w-4" /> Compare Papers</>
          )}
        </button>
        {selectedIds.length >= 4 && !loading && (
          <p className="text-center text-xs text-slate-500">
            ⓘ Comparing {selectedIds.length} papers uses multiple AI calls — may take 20–35 seconds
          </p>
        )}
      </div>

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="space-y-2">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
          <p className="text-center text-xs text-slate-500">
            Tip: try selecting fewer papers, or add a DeepSeek API key in{" "}
            <span className="text-slate-400">Advanced Settings</span> for unlimited comparisons.
          </p>
        </div>
      )}

      {/* ── Skeleton ─────────────────────────────────────────────────────────── */}
      {loading && (
        <LoadingSkeleton cols={selectedIds.length} dims={selectedDims.length} />
      )}

      {/* ── Result table ─────────────────────────────────────────────────────── */}
      {result && !loading && (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-500">
                {result.papers.length} papers · {result.dimensions.length} dimensions
              </p>
              {hasContrast && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 ring-1 ring-amber-500/20">
                  ⚡ contrasts detected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runCompare}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </button>
              <button
                type="button"
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Table — both axes scrollable, sticky header + first column */}
          <div className="max-h-[80vh] overflow-auto rounded-xl border border-slate-800">
            <table className="min-w-full border-collapse">
              <thead>
                <tr
                  className="border-b border-slate-800"
                  style={{ background: "rgba(10,10,20,0.98)" }}
                >
                  <th
                    className="sticky left-0 top-0 z-30 w-44 min-w-[11rem] border-r border-slate-800 px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-widest text-slate-500"
                    style={{ background: "rgba(10,10,20,0.98)" }}
                  >
                    Dimension
                  </th>
                  {result.papers.map((p) => (
                    <th
                      key={p.paper_id}
                      className="sticky top-0 z-20 min-w-[220px] max-w-[320px] px-4 py-3.5 text-left align-top"
                      style={{ background: "rgba(10,10,20,0.98)" }}
                      title={[p.title, p.authors].filter(Boolean).join(" — ")}
                    >
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-200">
                        {p.title}
                      </p>
                      {p.year && (
                        <span className="mt-1 inline-block rounded-md bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                          {p.year}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.dimensions.map((dim, ri) => (
                  <tr
                    key={dim}
                    className={`border-b border-slate-800/50 ${ri % 2 === 1 ? "bg-slate-900/20" : ""}`}
                  >
                    <td
                      className="sticky left-0 z-10 w-44 min-w-[11rem] border-r border-slate-800 px-4 py-3 align-top font-semibold text-sm text-slate-300"
                      style={{
                        background: ri % 2 === 1 ? "rgba(12,12,24,0.98)" : "rgba(10,10,20,0.98)",
                      }}
                    >
                      {DIM_LABEL[dim] ?? dim}
                    </td>
                    {result.papers.map((p) => {
                      const cellKey = `${p.paper_id}-${dim}`;
                      return (
                        <td key={p.paper_id} className="min-w-[220px] max-w-[320px] px-3 py-2.5 align-top">
                          <CellContent
                            text={result.cells[p.paper_id]?.[dim] ?? "—"}
                            cellKey={cellKey}
                            expanded={expandedCells.has(cellKey)}
                            onToggle={toggleCell}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
