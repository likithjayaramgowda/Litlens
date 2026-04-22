"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, Lightbulb, Loader2, Network, RefreshCw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Canvas-based graph — must be client-only (no SSR)
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

import { API_URL } from "@/lib/api";
const GRAPH_HEIGHT = 580;
const PANEL_WIDTH = 280;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawNode {
  id: string;
  label: string;
  type: "paper" | "concept";
  metadata: Record<string, unknown>;
}

interface RawEdge {
  source: string;
  target: string;
  weight: number;
}

// ForceGraph augments nodes with simulation coordinates
type FgNode = RawNode & { x?: number; y?: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? "";
}

// ── Node detail panel ─────────────────────────────────────────────────────────

function NodePanel({ node, onClose }: { node: FgNode; onClose: () => void }) {
  const isPaper = node.type === "paper";
  const m = node.metadata;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {isPaper
            ? <BookOpen className="h-4 w-4 text-violet-400 shrink-0" />
            : <Lightbulb className="h-4 w-4 text-amber-400 shrink-0" />}
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {isPaper ? "Paper" : "Concept"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-600 hover:text-slate-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-sm font-semibold text-white leading-snug">
        {isPaper ? String(m.title || node.label) : node.label}
      </p>

      {isPaper && !!m.authors && (
        <p className="text-xs text-slate-400 leading-relaxed">{String(m.authors)}</p>
      )}
      {isPaper && !!m.year && (
        <p className="text-xs text-slate-500">{String(m.year)}</p>
      )}

      {!isPaper && (
        <>
          {Array.isArray(m.papers) && (
            <p className="text-xs text-slate-500">
              Shared across <span className="text-slate-300 font-medium">{m.papers.length}</span>{" "}
              {m.papers.length === 1 ? "paper" : "papers"}
            </p>
          )}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Centrality</span>
              <span>{Math.round((Number(m.weight) || 0.5) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-500/70 transition-all"
                style={{ width: `${(Number(m.weight) || 0.5) * 100}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function KnowledgeGraph({ projectId }: { projectId: string }) {
  const [nodes, setNodes] = useState<RawNode[]>([]);
  const [edges, setEdges] = useState<RawEdge[]>([]);
  const [emptyMsg, setEmptyMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FgNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(800);

  // Keep graph width in sync with container (minus detail panel when open)
  useEffect(() => {
    function measure() {
      if (!containerRef.current) return;
      const total = containerRef.current.getBoundingClientRect().width;
      setGraphWidth(selected ? Math.max(total - PANEL_WIDTH - 1, 400) : total);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [selected]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/v1/projects/${projectId}/graph`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`Graph request failed (${r.status})`);
      const data = await r.json();
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
      setEmptyMsg(data.message ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // ── ForceGraph data ────────────────────────────────────────────────────────

  const fgData = {
    nodes: nodes as FgNode[],
    links: edges.map(e => ({ source: e.source, target: e.target, weight: e.weight })),
  };

  // ── Canvas renderers ───────────────────────────────────────────────────────

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FgNode;
      const isPaper = n.type === "paper";
      const isSelected = selected?.id === n.id;
      const radius = isPaper ? 7 : 4.5;
      const x = n.x ?? 0;
      const y = n.y ?? 0;

      // Selection glow
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, 2 * Math.PI);
        ctx.fillStyle = isPaper ? "rgba(124,58,237,0.22)" : "rgba(245,158,11,0.22)";
        ctx.fill();
      }

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isPaper
        ? isSelected ? "#a78bfa" : "#7c3aed"
        : isSelected ? "#fbbf24" : "#475569";
      ctx.fill();

      if (isPaper) {
        ctx.strokeStyle = isSelected ? "#c4b5fd" : "rgba(196,181,253,0.35)";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Label — only when zoomed in enough
      if (globalScale >= 0.55) {
        const fontSize = Math.min(12 / globalScale, isPaper ? 10 : 8.5);
        ctx.font = `${isPaper ? "600 " : ""}${fontSize}px Inter,system-ui,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isPaper ? "#e2e8f0" : "#94a3b8";
        const max = isPaper ? 26 : 20;
        const text = n.label.length > max ? n.label.slice(0, max) + "…" : n.label;
        ctx.fillText(text, x, y + radius + 3 / globalScale);
      }
    },
    [selected],
  );

  // Click hit-area matches the drawn circle
  const nodePointerAreaPaint = useCallback(
    (node: object, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as FgNode;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, n.type === "paper" ? 10 : 7, 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  const handleNodeClick = useCallback((node: object) => {
    const n = node as FgNode;
    setSelected(prev => prev?.id === n.id ? null : n);
  }, []);

  // ── Loading / empty / error states ────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 py-20 gap-4">
        <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-300">Building knowledge graph…</p>
          <p className="mt-1 text-xs text-slate-600">Extracting concepts from your papers</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-16 gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={loadGraph}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-20 gap-3">
        <Network className="h-9 w-9 text-slate-700" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-500">No graph yet</p>
          <p className="mt-1 text-xs text-slate-600">
            {emptyMsg || "Upload papers to generate a knowledge graph."}
          </p>
        </div>
      </div>
    );
  }

  const paperCount = nodes.filter(n => n.type === "paper").length;
  const conceptCount = nodes.filter(n => n.type === "concept").length;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Network className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-slate-200">Knowledge Graph</span>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-500">
            {paperCount} papers · {conceptCount} concepts
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500 inline-block" />
              Paper
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500 inline-block" />
              Concept
            </span>
          </div>
          <button
            onClick={loadGraph}
            title="Regenerate graph"
            className="rounded-lg border border-slate-700 p-1.5 text-slate-500 hover:border-slate-600 hover:text-slate-300 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas + detail panel */}
      <div className="flex" ref={containerRef}>
        {/* Graph canvas */}
        <div style={{ width: graphWidth, height: GRAPH_HEIGHT }}>
          <ForceGraph2D
            graphData={fgData}
            width={graphWidth}
            height={GRAPH_HEIGHT}
            backgroundColor="#09090f"
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={nodePointerAreaPaint}
            onNodeClick={handleNodeClick}
            linkWidth={(link: object) => ((link as { weight?: number }).weight ?? 0.5) * 2.5}
            linkColor={() => "rgba(148,163,184,0.12)"}
            cooldownTicks={150}
          />
        </div>

        {/* Detail panel */}
        {selected && (
          <div
            className="border-l border-slate-800 bg-slate-900/60 p-5 shrink-0"
            style={{ width: PANEL_WIDTH }}
          >
            <NodePanel node={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
