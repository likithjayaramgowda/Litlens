"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaperMeta {
  paper_id: string;
  title: string;
  authors: string;
  year: number | null;
}

interface Theme {
  theme_id: string;
  label: string;
  description: string;
  color: string;
  papers: string[];
}

interface ThemesResponse {
  themes: Theme[];
  papers: Record<string, PaperMeta>;
  message?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PaperChip({
  paper,
  color,
  highlighted,
  dimmed,
  onClick,
}: {
  paper: PaperMeta;
  color: string;
  highlighted: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={paper.title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs
                  transition-all focus:outline-none focus:ring-2 max-w-[220px]
                  ${highlighted
                    ? "border-current text-white shadow-md"
                    : dimmed
                    ? "border-slate-700/40 text-slate-600 bg-slate-900/30"
                    : "border-slate-700 text-slate-300 bg-slate-800/60 hover:border-current hover:text-white"
                  }`}
      style={
        highlighted
          ? { borderColor: color, backgroundColor: `rgb(${hexToRgb(color)} / 0.15)`, color }
          : undefined
      }
    >
      <span className="truncate max-w-[160px]">{paper.title}</span>
      {paper.year && (
        <span
          className="flex-none rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `rgb(${hexToRgb(color)} / 0.2)`, color }}
        >
          {paper.year}
        </span>
      )}
    </button>
  );
}

function ThemeCard({
  theme,
  papers,
  selectedPaperId,
  onChipClick,
}: {
  theme: Theme;
  papers: Record<string, PaperMeta>;
  selectedPaperId: string | null;
  onChipClick: (paperId: string) => void;
}) {
  const rgb = hexToRgb(theme.color);
  const hasSelected = selectedPaperId !== null;
  const thisHasSelected = selectedPaperId !== null && theme.papers.includes(selectedPaperId);

  return (
    <div
      className={`rounded-xl border bg-slate-900/60 p-5 transition-all
                  ${hasSelected && !thisHasSelected ? "opacity-40" : ""}`}
      style={{ borderColor: `rgb(${rgb} / 0.35)` }}
    >
      {/* Coloured top accent bar */}
      <div
        className="h-1 w-12 rounded-full mb-4"
        style={{ backgroundColor: theme.color }}
      />

      <h3
        className="text-base font-bold leading-snug mb-2"
        style={{ color: theme.color }}
      >
        {theme.label}
      </h3>

      <p className="text-sm text-slate-400 leading-relaxed mb-4">
        {theme.description}
      </p>

      {/* Paper chips */}
      <div className="flex flex-wrap gap-2">
        {theme.papers.map((pid) => {
          const paper = papers[pid];
          if (!paper) return null;
          return (
            <PaperChip
              key={pid}
              paper={paper}
              color={theme.color}
              highlighted={selectedPaperId === pid}
              dimmed={hasSelected && selectedPaperId !== pid}
              onClick={() => onChipClick(pid)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 animate-pulse">
      <div className="h-1 w-12 rounded-full bg-slate-700 mb-4" />
      <div className="h-4 w-40 rounded bg-slate-700 mb-2" />
      <div className="h-3 w-full rounded bg-slate-800 mb-1.5" />
      <div className="h-3 w-4/5 rounded bg-slate-800 mb-4" />
      <div className="flex gap-2">
        <div className="h-6 w-24 rounded-full bg-slate-800" />
        <div className="h-6 w-20 rounded-full bg-slate-800" />
        <div className="h-6 w-28 rounded-full bg-slate-800" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ThemeClusters({
  projectId,
  paperCount,
}: {
  projectId: string;
  paperCount: number;
}) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [papers, setPapers] = useState<Record<string, PaperMeta>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedPaperId(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/projects/${projectId}/themes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
      }
      const data: ThemesResponse = await res.json();
      setThemes(data.themes ?? []);
      setPapers(data.papers ?? {});
      setHasRun(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze themes");
    } finally {
      setLoading(false);
    }
  }, [projectId, getToken]);

  const handleChipClick = useCallback((paperId: string) => {
    setSelectedPaperId((prev) => (prev === paperId ? null : paperId));
  }, []);

  // ── Too few papers ────────────────────────────────────────────────────────

  if (paperCount < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-1">
          <Layers className="h-5 w-5 text-slate-500" />
        </div>
        <p className="text-sm font-medium text-slate-300">Not enough papers</p>
        <p className="text-xs text-slate-500 max-w-xs">
          Upload at least 2 papers to cluster themes.
        </p>
      </div>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Layers className="h-4 w-4 text-purple-400" />
          {hasRun && themes.length > 0 ? (
            <span>
              <span className="text-slate-200 font-medium">{themes.length}</span> theme
              {themes.length !== 1 ? "s" : ""} across{" "}
              <span className="text-slate-200 font-medium">{Object.keys(papers).length}</span>{" "}
              paper{Object.keys(papers).length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span>Topic clustering across your papers</span>
          )}
        </div>

        <button
          onClick={analyze}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-500
                     disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm
                     font-medium text-white transition-colors shadow-md shadow-purple-900/40"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {hasRun ? "Re-analyze Themes" : "Analyze Themes"}
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={analyze}
            className="flex-none flex items-center gap-1 text-xs text-red-300 hover:text-white transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Results grid */}
      {!loading && hasRun && themes.length > 0 && (
        <>
          {selectedPaperId && (
            <p className="text-xs text-slate-500 text-center">
              Showing all themes containing{" "}
              <span className="text-slate-300 font-medium">
                {papers[selectedPaperId]?.title ?? selectedPaperId}
              </span>
              {" "}— click the chip again to clear.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => (
              <ThemeCard
                key={theme.theme_id}
                theme={theme}
                papers={papers}
                selectedPaperId={selectedPaperId}
                onChipClick={handleChipClick}
              />
            ))}
          </div>
        </>
      )}

      {/* Pre-run empty state */}
      {!loading && !hasRun && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center
                        rounded-xl border border-slate-800 border-dashed">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mb-1">
            <Sparkles className="h-5 w-5 text-purple-400" />
          </div>
          <p className="text-sm font-medium text-slate-300">Discover topic clusters</p>
          <p className="text-xs text-slate-500 max-w-xs">
            Click <span className="text-slate-300 font-medium">Analyze Themes</span> to
            automatically group your papers into thematic clusters using AI.
          </p>
        </div>
      )}

      {/* Post-run empty (LLM returned nothing) */}
      {!loading && hasRun && themes.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
          <p className="text-sm text-slate-400">No themes found. Try again or add more papers.</p>
        </div>
      )}
    </div>
  );
}
