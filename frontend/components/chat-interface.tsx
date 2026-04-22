"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { loadLLMSettings } from "@/components/settings-modal";
import { toast } from "@/components/toast";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Keyframe animations ───────────────────────────────────────────────────────

const ANIMATION_STYLES = `
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes thinkPulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 1; }
}
.msg-enter    { animation: fadeSlideIn 0.22s ease-out both; }
.think-pulse  { animation: thinkPulse 1.4s ease-in-out infinite; }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Source {
  paper_id: string;
  paper_title: string;
  page_number: number;
  excerpt: string;
  relevance_score: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  model_used?: string;
  isStreaming?: boolean;
  isPending?: boolean;
  pendingTier?: Tier;
}

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  project_id?: string | null;
}

type Tier = "quick" | "deep" | "long-context";

const TIERS: { id: Tier; label: string; icon: React.ReactNode; tooltip: string }[] = [
  { id: "quick",        label: "Quick",        icon: <Zap className="h-4 w-4" />,      tooltip: "Fast responses for simple questions." },
  { id: "deep",         label: "Deep Thinking", icon: <Sparkles className="h-4 w-4" />, tooltip: "671B reasoning model. Best for complex analysis." },
  { id: "long-context", label: "Long Context",  icon: <BookOpen className="h-4 w-4" />, tooltip: "Up to 1M token context. Best for many papers." },
];

const EXAMPLE_QUESTIONS = [
  { q: "What are the main methodologies across these papers?", icon: "🔬" },
  { q: "Where do these papers disagree with each other?",      icon: "⚡" },
  { q: "Summarize the key findings from all papers",           icon: "📋" },
  { q: "What research gaps exist across these papers?",        icon: "🔍" },
];

// Deterministic colour per paper (source card left-border)
const PAPER_BORDER   = ["border-l-violet-500","border-l-blue-500","border-l-emerald-500","border-l-amber-500","border-l-rose-500","border-l-cyan-500"];
const PAPER_DOT      = ["bg-violet-500","bg-blue-500","bg-emerald-500","bg-amber-500","bg-rose-500","bg-cyan-500"];

function paperColorIdx(paper_id: string): number {
  let h = 0;
  for (let i = 0; i < paper_id.length; i++) h = (h * 31 + paper_id.charCodeAt(i)) >>> 0;
  return h % PAPER_BORDER.length;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Thinking indicator ────────────────────────────────────────────────────────

const TIER_THINKING: Record<Tier, string> = {
  quick:          "Thinking…",
  deep:           "Analyzing across papers…",
  "long-context": "Processing long context…",
};

function ThinkingIndicator({ tier }: { tier: Tier }) {
  return (
    <span className="think-pulse text-sm text-violet-400 font-medium px-1">
      {TIER_THINKING[tier]}
    </span>
  );
}

// ── Source card ───────────────────────────────────────────────────────────────

function SourceCard({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(source.relevance_score * 100);
  const idx = paperColorIdx(source.paper_id);

  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/70 border-l-[3px] ${PAPER_BORDER[idx]} overflow-hidden transition-all duration-200`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PAPER_DOT[idx]}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-200">{source.paper_title}</p>
          <p className="mt-0.5 text-sm text-slate-500">p.{source.page_number} · {pct}% match</p>
        </div>
        <span className="text-slate-600 mt-0.5 shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3 text-sm text-slate-400 leading-relaxed italic">
          "{source.excerpt}{source.excerpt.length >= 300 ? "…" : ""}"
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const hasSources = (message.sources?.length ?? 0) > 0;

  return (
    <div className={`msg-enter flex flex-col gap-3 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-3.5 leading-relaxed whitespace-pre-wrap text-[15px] ${
          isUser
            ? "bg-gradient-to-br from-violet-600 to-violet-700 text-white rounded-br-md shadow-lg shadow-violet-900/30"
            : "bg-slate-900/80 border border-slate-800 text-slate-100 rounded-bl-md shadow-md"
        }`}
      >
        {message.isPending && !message.content ? (
          <ThinkingIndicator tier={message.pendingTier ?? "quick"} />
        ) : (
          <>
            {message.content}
            {message.isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 bg-violet-400 animate-pulse align-text-bottom" />
            )}
          </>
        )}
      </div>

      {/* Sources accordion */}
      {!isUser && hasSources && !message.isStreaming && (
        <div className="w-full max-w-[85%] space-y-2">
          <button
            type="button"
            onClick={() => setSourcesOpen((v) => !v)}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            <FileText className="h-4 w-4" />
            <span>
              {sourcesOpen ? "Hide" : "Show"} {message.sources!.length} source
              {message.sources!.length !== 1 ? "s" : ""}
            </span>
            {sourcesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {sourcesOpen && (
            <div className="space-y-2">
              {message.sources!.map((s, i) => (
                <SourceCard key={`${s.paper_id}-${s.page_number}-${i}`} source={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-96 rounded-2xl border border-slate-700 bg-[#0d0d1a] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white">Delete conversation?</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          This will permanently delete the conversation and all its messages. This cannot be undone.
        </p>
        <div className="mt-5 flex gap-3 justify-end">
          <button onClick={onCancel}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar conversation row ──────────────────────────────────────────────────

function ConvRow({ conv, isActive, onSelect, onDelete }: {
  conv: Conversation; isActive: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  return (
    <>
      <div className={`group relative flex items-center rounded-xl transition-colors cursor-pointer ${
        isActive
          ? "bg-violet-600/20 border border-violet-600/30"
          : "hover:bg-slate-800/60 border border-transparent"
      }`}>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 px-3 py-3 text-left">
          <p className={`truncate text-sm font-semibold leading-snug ${isActive ? "text-violet-300" : "text-slate-200"}`}>
            {conv.title}
          </p>
          <p className="mt-1 text-xs text-slate-500">{formatRelative(conv.updated_at)}</p>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowDeleteModal(true); }}
          className="mr-2 shrink-0 rounded-lg p-1.5 text-slate-700 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showDeleteModal && (
        <DeleteModal
          onConfirm={() => { setShowDeleteModal(false); onDelete(); }}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChatInterface({
  projectId,
  initialConvId,
}: {
  projectId?: string;
  initialConvId?: string;
}) {
  const [conversations, setConversations]   = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId]     = useState<string | null>(initialConvId ?? null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput]                   = useState("");
  const [tier, setTier]                     = useState<Tier>("quick");
  const [isStreaming, setIsStreaming]        = useState(false);
  const [quota, setQuota]                   = useState<{ remaining: number; limit: number } | null>(null);
  const [sidebarOpen, setSidebarOpen]       = useState(true);
  const [projectName, setProjectName]       = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  // ── Auth ───────────────────────────────────────────────────────────────────

  const getToken = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  // ── Load conversations ─────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const token = await getToken();
      const url = projectId
        ? `${API_URL}/api/v1/chat/conversations?project_id=${projectId}`
        : `${API_URL}/api/v1/chat/conversations`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setConversations(await r.json());
    } catch { /* non-critical */ }
  }, [getToken, projectId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── Fetch project name for header badge ────────────────────────────────────

  useEffect(() => {
    if (!projectId) return;
    async function load() {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}/api/v1/projects/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const list: { id: string; name: string }[] = await r.json();
          const found = list.find((p) => p.id === projectId);
          if (found) setProjectName(found.name);
        }
      } catch { /* non-critical */ }
    }
    load();
  }, [projectId, getToken]);

  // ── Load quota ─────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}/api/v1/llm/quota`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setQuota(await r.json());
      } catch { /* non-critical */ }
    }
    load();
  }, [getToken]);

  // ── Load messages when conversation changes ────────────────────────────────

  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    setLoadingMessages(true);
    async function load() {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}/api/v1/chat/conversations/${activeConvId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setMessages(await r.json());
      } catch { /* non-critical */ }
      finally { setLoadingMessages(false); }
    }
    load();
  }, [activeConvId, getToken]);

  // ── Scroll on messages ─────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-resize textarea ───────────────────────────────────────────────────

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // ── Delete conversation ────────────────────────────────────────────────────

  const handleDeleteConversation = useCallback(async (convId: string) => {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/v1/chat/conversations/${convId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
      toast.success("Conversation deleted");
    } catch { toast.error("Failed to delete conversation"); }
  }, [getToken, activeConvId]);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    setInput("");
    setIsStreaming(true);

    const userMsg: Message  = { id: `u-${Date.now()}`, role: "user", content: text.trim() };
    const aId = `a-${Date.now()}`;
    const aMsg: Message = { id: aId, role: "assistant", content: "", sources: [], isStreaming: true, isPending: true, pendingTier: tier };
    setMessages((prev) => [...prev, userMsg, aMsg]);

    try {
      const token = await getToken();
      const llmSettings = loadLLMSettings();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (llmSettings.deepseekKey) {
        headers["X-LLM-Provider"] = "deepseek";
        headers["X-LLM-Model"]    = llmSettings.deepseekModel;
        headers["X-LLM-API-Key"]  = llmSettings.deepseekKey;
      }

      const resp = await fetch(`${API_URL}/api/v1/chat/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text.trim(),
          tier,
          conversation_id: activeConvId,
          project_id: projectId ?? null,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? "Request failed");
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newConvId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "sources") {
              setMessages((prev) => prev.map((m) => m.id === aId ? { ...m, sources: evt.sources } : m));
            } else if (evt.type === "token") {
              setMessages((prev) => prev.map((m) =>
                m.id === aId ? { ...m, content: m.content + evt.content, isPending: false } : m
              ));
            } else if (evt.type === "done") {
              newConvId = evt.conversation_id;
              setMessages((prev) => prev.map((m) => m.id === aId ? { ...m, isStreaming: false, isPending: false } : m));
            } else if (evt.type === "error") {
              setMessages((prev) => prev.map((m) =>
                m.id === aId ? { ...m, content: `Error: ${evt.message}`, isStreaming: false, isPending: false } : m
              ));
            }
          } catch { /* skip malformed */ }
        }
      }

      if (newConvId) { setActiveConvId(newConvId); await loadConversations(); }

      // Refresh quota
      const t2 = await getToken();
      const qr = await fetch(`${API_URL}/api/v1/llm/quota`, { headers: { Authorization: `Bearer ${t2}` } });
      if (qr.ok) setQuota(await qr.json());

    } catch (err) {
      setMessages((prev) => prev.map((m) =>
        m.id === aId
          ? { ...m, content: `Something went wrong: ${(err as Error).message}`, isStreaming: false, isPending: false }
          : m
      ));
    } finally {
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  }, [isStreaming, activeConvId, tier, getToken, projectId, loadConversations]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }, [input, sendMessage]);

  const startNewChat = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    textareaRef.current?.focus();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isEmpty = messages.length === 0;
  const usingByok = Boolean(loadLLMSettings().deepseekKey);
  const activeConvTitle = conversations.find((c) => c.id === activeConvId)?.title ?? "New Chat";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ANIMATION_STYLES }} />

      <div
        className="flex h-full overflow-hidden text-white"
        style={{ background: "linear-gradient(135deg,#0a0a14 0%,#0d0a1a 50%,#080810 100%)" }}
      >

        {/* ── Sidebar ── */}
        <aside
          className={`flex flex-col border-r border-slate-800/70 transition-all duration-200 ${
            sidebarOpen ? "w-72 min-w-[18rem]" : "w-0 overflow-hidden"
          }`}
          style={{ background: "rgba(10,10,20,0.85)" }}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between border-b border-slate-800/70 px-4 py-4">
            <div className="flex items-center gap-2">
              {projectId && (
                <Link
                  href="/dashboard"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
                  title="Back to Dashboard"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              )}
              <span className="text-sm font-semibold text-slate-100">
                {projectId && projectName ? projectName : "Conversations"}
              </span>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 hover:bg-violet-600/20 hover:text-violet-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {conversations.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-600">No conversations yet</p>
            ) : (
              conversations.map((conv) => (
                <ConvRow
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === activeConvId}
                  onSelect={() => setActiveConvId(conv.id)}
                  onDelete={() => handleDeleteConversation(conv.id)}
                />
              ))
            )}
          </div>

          {/* Quota */}
          {quota && (
            <div className="border-t border-slate-800/70 px-4 py-3">
              <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
                <span>Daily queries</span>
                <span className={quota.remaining === 0 ? "text-red-400" : quota.remaining / quota.limit <= 0.2 ? "text-amber-400" : "text-slate-400"}>
                  {quota.remaining}/{quota.limit}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    quota.remaining === 0 ? "bg-red-500"
                    : quota.remaining / quota.limit <= 0.2 ? "bg-amber-500"
                    : "bg-gradient-to-r from-violet-600 to-violet-400"
                  }`}
                  style={{ width: `${Math.max(5, (quota.remaining / quota.limit) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </aside>

        {/* ── Main area ── */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Top bar */}
          <header
            className="flex shrink-0 items-center justify-between border-b border-slate-800/70 px-5 py-3.5"
            style={{ background: "rgba(10,10,20,0.92)" }}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
              >
                <MessageSquare className="h-5 w-5" />
              </button>
              {projectId && (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-violet-300 hover:bg-violet-500/20 transition-colors"
                >
                  <Layers className="h-3.5 w-3.5" />
                  {projectName ?? "Project"}
                </Link>
              )}
              <h1 className="text-base font-semibold text-white truncate max-w-[280px]">
                {activeConvTitle}
              </h1>
            </div>

          </header>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-8">
            {loadingMessages ? (
              <div className="mx-auto max-w-3xl space-y-6">
                {[{ w: "70%", side: "start" }, { w: "55%", side: "end" }, { w: "80%", side: "start" }].map((s, i) => (
                  <div key={i} className={`flex flex-col gap-2 ${s.side === "end" ? "items-end" : "items-start"}`}>
                    <div className="animate-pulse rounded-2xl bg-slate-800/80 px-5 py-4 h-12" style={{ width: s.w }} />
                  </div>
                ))}
              </div>
            ) : isEmpty ? (
              <div className="flex h-full flex-col items-center justify-center gap-8 text-center">
                <div className="space-y-4">
                  <div
                    className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl shadow-xl shadow-violet-900/40"
                    style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)" }}
                  >
                    <Sparkles className="h-8 w-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Ask anything about your research
                    </h2>
                    <p className="mt-2 max-w-md text-base text-slate-400">
                      LitLens searches across all your{projectName ? ` "${projectName}"` : ""} papers,
                      cites its sources, and highlights where papers agree or disagree.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 max-w-xl w-full">
                  {EXAMPLE_QUESTIONS.map(({ q, icon }) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => sendMessage(q)}
                      disabled={isStreaming}
                      className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-left transition-all duration-200 hover:border-violet-500/40 hover:bg-slate-800/60 hover:shadow-xl hover:shadow-violet-900/20 disabled:opacity-50"
                    >
                      <span className="mb-2 block text-xl">{icon}</span>
                      <span className="text-sm font-semibold text-slate-300 group-hover:text-white transition-colors leading-snug">
                        {q}
                      </span>
                      <span className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "radial-gradient(ellipse at top left,rgba(124,58,237,0.08),transparent 70%)" }} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div
            className="shrink-0 border-t border-slate-800/70 px-5 py-5"
            style={{ background: "rgba(10,10,20,0.96)" }}
          >
            <div className="mx-auto max-w-3xl space-y-2.5">

              {/* ── Tier picker pill ── */}
              {!usingByok ? (
                <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1 w-fit">
                  {TIERS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTier(t.id)}
                      title={t.tooltip}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        tier === t.id
                          ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm shadow-violet-900/50"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 w-fit">
                  <span className="text-xs text-slate-400">DeepSeek BYOK</span>
                </div>
              )}

              <div className="flex items-end gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/80 px-5 py-4 focus-within:border-violet-500/50 focus-within:shadow-lg focus-within:shadow-violet-900/20 transition-all duration-200">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question about your papers…"
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-base text-slate-100 placeholder-slate-500 focus:outline-none leading-relaxed"
                  disabled={isStreaming}
                />
                <button
                  type="button"
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isStreaming}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}
                >
                  {isStreaming
                    ? <Loader2 className="h-4 w-4 animate-spin text-white" />
                    : <Send className="h-4 w-4 text-white" />}
                </button>
              </div>
              <p className="text-center text-xs text-slate-600">
                <kbd className="rounded border border-slate-800 px-1.5 py-0.5 font-mono">Enter</kbd>{" "}
                to send ·{" "}
                <kbd className="rounded border border-slate-800 px-1.5 py-0.5 font-mono">Shift+Enter</kbd>{" "}
                for new line
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
