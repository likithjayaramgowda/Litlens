"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BookOpen, Calendar, FileText, Loader2, RefreshCw, X } from "lucide-react";
import { API_URL } from "@/lib/api";

// Layout constants
const ABOVE_H = 280;   // px — fixed height for above-axis card area
const AXIS_H  = 56;    // px — dot + year label
const BELOW_H = 280;   // px — fixed height for below-axis card area
const DOT_R   = 6;     // px — half of the 12px dot diameter
const LINE_TOP = ABOVE_H + DOT_R; // 286px — y-center of the axis dot
const TOTAL_H  = ABOVE_H + AXIS_H + BELOW_H; // 616px
const COL_W    = 192;  // px — card column width
const COL_GAP  = 44;   // px — horizontal gap between year columns
const SIDE_PAD = 56;   // px — left/right padding of the scroll area
const MAX_PER_SIDE = 3; // max cards shown per side per year before "+N more"

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelinePaper {
  paper_id: string;
  title: string;
  authors: string;
  year: number;
  page_count: number | null;
}

interface YearGroup {
  year: number;
  above: TimelinePaper[];
  aboveExtra: number;
  below: TimelinePaper[];
  belowExtra: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PaperCard({
  paper,
  onClick,
  selected,
}: {
  paper: TimelinePaper;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all focus:outline-none
        ${selected
          ? "bg-purple-900/40 border-purple-500/70 ring-1 ring-purple-500/40"
          : "bg-slate-800/80 border-slate-700/60 hover:border-purple-500/40 hover:bg-slate-800"
        }`}
    >
      <p className="text-[11px] font-semibold text-purple-400 mb-1">{paper.year}</p>
      <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-snug">
        {paper.title}
      </p>
      {paper.authors && (
        <p className="text-[11px] text-slate-500 truncate mt-1">{paper.authors}</p>
      )}
    </button>
  );
}

function DetailPanel({
  paper,
  onClose,
}: {
  paper: TimelinePaper;
  onClose: () => void;
}) {
  return (
    <div className="w-72 flex-none bg-slate-900/95 border-l border-slate-700 rounded-r-xl
                    flex flex-col overflow-y-auto">
      <div className="flex items-start justify-between p-5 pb-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-400
                         bg-purple-500/10 border border-purple-500/20 rounded-full px-2.5 py-1">
          <Calendar className="h-3 w-3" />
          {paper.year}
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors ml-2 flex-none"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-100 leading-snug">{paper.title}</h3>

        {paper.authors && (
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Authors
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">{paper.authors}</p>
          </div>
        )}

        <div className="flex gap-4">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Year
            </p>
            <p className="text-xs text-slate-300">{paper.year}</p>
          </div>
          {paper.page_count != null && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Pages
              </p>
              <p className="text-xs text-slate-300">{paper.page_count}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaperTimeline({ projectId }: { projectId: string }) {
  const [timeline, setTimeline] = useState<TimelinePaper[]>([]);
  const [yearMin, setYearMin] = useState<number | null>(null);
  const [yearMax, setYearMax] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TimelinePaper | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/projects/${projectId}/timeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setTimeline(data.timeline ?? []);
      setYearMin(data.year_min ?? null);
      setYearMax(data.year_max ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [projectId, getToken]);

  useEffect(() => { load(); }, [load]);

  // Group papers by year, split into above/below alternating slots
  const yearGroups = useMemo<YearGroup[]>(() => {
    const map = new Map<number, TimelinePaper[]>();
    for (const p of timeline) {
      if (!map.has(p.year)) map.set(p.year, []);
      map.get(p.year)!.push(p);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, papers]) => {
        const aboveAll = papers.filter((_, i) => i % 2 === 0);
        const belowAll = papers.filter((_, i) => i % 2 === 1);
        return {
          year,
          above: aboveAll.slice(0, MAX_PER_SIDE),
          aboveExtra: Math.max(0, aboveAll.length - MAX_PER_SIDE),
          below: belowAll.slice(0, MAX_PER_SIDE),
          belowExtra: Math.max(0, belowAll.length - MAX_PER_SIDE),
        };
      });
  }, [timeline]);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading timeline…
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200
                     border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (timeline.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-1">
          <Calendar className="h-5 w-5 text-slate-500" />
        </div>
        <p className="text-sm font-medium text-slate-300">
          {timeline.length === 0
            ? "No publication years found"
            : "Only one paper has a known year"}
        </p>
        <p className="text-xs text-slate-500 max-w-xs">
          Make sure your papers have publication years — the timeline needs at
          least 2 papers with known years to display.
        </p>
      </div>
    );
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  const totalCols = yearGroups.length;
  const innerWidth = SIDE_PAD * 2 + totalCols * COL_W + Math.max(0, totalCols - 1) * COL_GAP;
  const scrollMinWidth = Math.max(innerWidth, 600);

  return (
    <div className="flex gap-0 rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
      {/* Scrollable timeline area */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {/* Header */}
        <div className="px-6 pt-4 pb-2 flex items-center gap-3 border-b border-slate-800/60">
          <BookOpen className="h-4 w-4 text-purple-400 flex-none" />
          <span className="text-sm font-medium text-slate-300">
            {timeline.length} paper{timeline.length !== 1 ? "s" : ""}
          </span>
          {yearMin != null && yearMax != null && (
            <span className="text-xs text-slate-500">
              {yearMin === yearMax ? String(yearMin) : `${yearMin} – ${yearMax}`}
            </span>
          )}
        </div>

        {/* Timeline body */}
        <div
          className="relative select-none"
          style={{ height: TOTAL_H, minWidth: scrollMinWidth }}
        >
          {/* Horizontal axis line */}
          <div
            className="absolute left-0 right-0 h-px bg-slate-700 pointer-events-none"
            style={{ top: LINE_TOP }}
          />

          {/* Year columns */}
          <div
            className="absolute inset-0 flex items-stretch"
            style={{ paddingLeft: SIDE_PAD, paddingRight: SIDE_PAD, gap: COL_GAP }}
          >
            {yearGroups.map((group) => (
              <div
                key={group.year}
                className="flex-none flex flex-col items-center"
                style={{ width: COL_W }}
              >
                {/* Cards above axis — bottom-aligned */}
                <div
                  className="w-full flex flex-col justify-end gap-2 pb-2"
                  style={{ height: ABOVE_H }}
                >
                  {group.above.map((paper) => (
                    <PaperCard
                      key={paper.paper_id}
                      paper={paper}
                      selected={selected?.paper_id === paper.paper_id}
                      onClick={() =>
                        setSelected((prev) =>
                          prev?.paper_id === paper.paper_id ? null : paper
                        )
                      }
                    />
                  ))}
                  {group.aboveExtra > 0 && (
                    <p className="text-[11px] text-slate-500 text-center">
                      +{group.aboveExtra} more
                    </p>
                  )}
                </div>

                {/* Axis dot + year label */}
                <div
                  className="flex flex-col items-center z-10"
                  style={{ height: AXIS_H }}
                >
                  <div className="w-3 h-3 rounded-full bg-purple-500 border-2 border-slate-950
                                  shadow-lg shadow-purple-500/40" />
                  <span className="text-[11px] font-bold text-slate-300 mt-2 tabular-nums">
                    {group.year}
                  </span>
                </div>

                {/* Cards below axis — top-aligned */}
                <div
                  className="w-full flex flex-col gap-2 pt-2"
                  style={{ height: BELOW_H }}
                >
                  {group.below.map((paper) => (
                    <PaperCard
                      key={paper.paper_id}
                      paper={paper}
                      selected={selected?.paper_id === paper.paper_id}
                      onClick={() =>
                        setSelected((prev) =>
                          prev?.paper_id === paper.paper_id ? null : paper
                        )
                      }
                    />
                  ))}
                  {group.belowExtra > 0 && (
                    <p className="text-[11px] text-slate-500 text-center">
                      +{group.belowExtra} more
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detail panel — slides in when a paper is selected */}
      {selected && (
        <DetailPanel paper={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
