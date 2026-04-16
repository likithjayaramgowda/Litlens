"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Clock,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import UploadZone from "@/components/upload-zone";
import WritingEditor from "@/components/writing-editor";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  paper_count: number;
}

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  project_id?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Accent colours (deterministic per project id) ─────────────────────────────

const CARD_GRADIENTS = [
  "from-violet-600/20 to-violet-900/5",
  "from-blue-600/20   to-blue-900/5",
  "from-emerald-600/20 to-emerald-900/5",
  "from-amber-600/20  to-amber-900/5",
  "from-rose-600/20   to-rose-900/5",
  "from-cyan-600/20   to-cyan-900/5",
];
const BORDER_ACCENTS = [
  "hover:border-violet-500/50",
  "hover:border-blue-500/50",
  "hover:border-emerald-500/50",
  "hover:border-amber-500/50",
  "hover:border-rose-500/50",
  "hover:border-cyan-500/50",
];
const ICON_COLORS = [
  "text-violet-400", "text-blue-400", "text-emerald-400",
  "text-amber-400", "text-rose-400", "text-cyan-400",
];
const ICON_BG = [
  "bg-violet-500/10", "bg-blue-500/10", "bg-emerald-500/10",
  "bg-amber-500/10", "bg-rose-500/10", "bg-cyan-500/10",
];
const ACTIVE_BAR_COLORS = [
  "#7c3aed", "#3b82f6", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4",
];

function colorIdx(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % CARD_GRADIENTS.length;
}

// ── Modals ────────────────────────────────────────────────────────────────────

function CreateProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token ?? "";
      const r = await fetch(`${API_URL}/api/v1/projects/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Failed");
      onCreate(await r.json());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[420px] rounded-2xl border border-slate-700 bg-[#0d0d1a] p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">New Project</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Project name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Thesis on RAG Systems"
              maxLength={100}
              autoFocus
              className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500/60 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Description <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500/60 focus:outline-none transition-colors"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || loading}
              className="flex-1 rounded-xl py-3 text-sm font-medium text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)" }}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  title,
  body,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-96 rounded-2xl border border-slate-700 bg-[#0d0d1a] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
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

// ── Project card (grid view) ───────────────────────────────────────────────────

function ProjectCard({
  project,
  isActive,
  onSelect,
  onDelete,
}: {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const idx = colorIdx(project.id);

  return (
    <>
      <div
        className={`group relative flex flex-col rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden ${
          isActive
            ? "border-violet-500/60 shadow-xl shadow-violet-900/30 ring-1 ring-violet-500/30"
            : `border-slate-800 ${BORDER_ACCENTS[idx]} hover:shadow-lg hover:shadow-slate-900/60`
        }`}
        onClick={onSelect}
      >
        {/* Top accent bar */}
        <div
          className="h-1.5 w-full"
          style={{
            background: isActive
              ? "linear-gradient(90deg,#7c3aed,#6d28d9)"
              : `linear-gradient(90deg, ${ACTIVE_BAR_COLORS[idx]}55, ${ACTIVE_BAR_COLORS[idx]}11)`,
          }}
        />

        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-violet-500/15" : ICON_BG[idx]}`}>
              <Layers className={`h-5 w-5 ${isActive ? "text-violet-400" : ICON_COLORS[idx]}`} />
            </div>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
              className="rounded-lg p-1.5 text-slate-600 opacity-0 group-hover:opacity-100 hover:bg-slate-800 hover:text-slate-300 transition-all"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {showMenu && (
              <div
                className="absolute right-3 top-12 z-20 w-40 rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { setShowMenu(false); setShowDeleteModal(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete project
                </button>
              </div>
            )}
          </div>

          <h3 className="mt-3.5 text-base font-semibold leading-snug text-white line-clamp-2">
            {project.name}
          </h3>
          {project.description && (
            <p className="mt-1.5 text-sm text-slate-500 line-clamp-2">{project.description}</p>
          )}

          <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {project.paper_count} {project.paper_count === 1 ? "paper" : "papers"}
            </span>
            <span className="flex items-center gap-1.5 ml-auto">
              <Clock className="h-3.5 w-3.5" />
              {formatRelative(project.updated_at)}
            </span>
          </div>

          {isActive && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-violet-400 font-medium">
              <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
              Active workspace
            </div>
          )}
        </div>
      </div>

      {showDeleteModal && (
        <ConfirmDeleteModal
          title={`Delete "${project.name}"?`}
          body="The project will be deleted. Your papers and chats will remain but become unassigned. This cannot be undone."
          onConfirm={() => { setShowDeleteModal(false); onDelete(); }}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </>
  );
}

function CreateCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700 p-8 min-h-[160px] transition-all duration-200 hover:border-violet-500/50 hover:bg-violet-500/5 hover:shadow-lg hover:shadow-violet-900/10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-slate-700 group-hover:border-violet-500/50 group-hover:bg-violet-500/10 transition-all">
        <Plus className="h-6 w-6 text-slate-600 group-hover:text-violet-400 transition-colors" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-400 group-hover:text-slate-200 transition-colors">New Project</p>
        <p className="mt-1 text-sm text-slate-600">Create a workspace</p>
      </div>
    </button>
  );
}

// ── Conversation card (project view) ──────────────────────────────────────────

function ConversationCard({
  conv,
  projectId,
  onDelete,
}: {
  conv: Conversation;
  projectId: string;
  onDelete: () => void;
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  return (
    <>
      <div className="group relative flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4 transition-all hover:border-slate-700 hover:bg-slate-900/80 hover:shadow-md">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800">
          <MessageSquare className="h-4 w-4 text-slate-400" />
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href={`/chat?projectId=${projectId}&convId=${conv.id}`}
            className="block"
          >
            <p className="truncate text-base font-medium text-slate-200 group-hover:text-white transition-colors">
              {conv.title}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">{formatRelative(conv.updated_at)}</p>
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="shrink-0 rounded-lg p-2 text-slate-700 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
          title="Delete conversation"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showDeleteModal && (
        <ConfirmDeleteModal
          title="Delete this conversation?"
          body="This will permanently delete the conversation and all its messages. This cannot be undone."
          onConfirm={() => { setShowDeleteModal(false); onDelete(); }}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}
    </>
  );
}

// ── Project view (papers + chats + write tabs) ────────────────────────────────

type ProjectTab = "papers" | "chats" | "write";

function ProjectView({
  project,
  onBack,
  getToken,
}: {
  project: Project;
  onBack: () => void;
  getToken: () => Promise<string>;
}) {
  const [activeTab, setActiveTab] = useState<ProjectTab>("papers");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const idx = colorIdx(project.id);

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        const r = await fetch(
          `${API_URL}/api/v1/chat/conversations?project_id=${project.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (r.ok) setConversations(await r.json());
      } catch { /* non-critical */ }
      finally { setLoadingConvs(false); }
    }
    load();
  }, [project.id, getToken]);

  async function handleDeleteConversation(convId: string) {
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/v1/chat/conversations/${convId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
    } catch { /* non-critical */ }
  }

  const tabs: { id: ProjectTab; label: string; icon: React.ReactNode }[] = [
    { id: "papers", label: "Papers", icon: <BookOpen className="h-4 w-4" /> },
    { id: "chats",  label: "Chats",  icon: <MessageSquare className="h-4 w-4" /> },
    { id: "write",  label: "Write",  icon: <PenLine className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* ── Project header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-sm text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All Projects
        </button>

        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${ICON_BG[idx]}`}>
            <Layers className={`h-4.5 w-4.5 ${ICON_COLORS[idx]}`} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{project.name}</h2>
            {project.description && (
              <p className="text-sm text-slate-500">{project.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab strip ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "papers" && (
              <span className={`text-xs ${activeTab === "papers" ? "text-slate-400" : "text-slate-600"}`}>
                {project.paper_count}
              </span>
            )}
            {tab.id === "chats" && conversations.length > 0 && (
              <span className={`text-xs ${activeTab === "chats" ? "text-slate-400" : "text-slate-600"}`}>
                {conversations.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Papers tab ─────────────────────────────────────────────────────── */}
      {activeTab === "papers" && (
        <section>
          <UploadZone projectId={project.id} />
        </section>
      )}

      {/* ── Chats tab ──────────────────────────────────────────────────────── */}
      {activeTab === "chats" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}
            </p>
            <Link
              href={`/chat?projectId=${project.id}`}
              className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/20 hover:text-violet-200 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Chat
            </Link>
          </div>

          {loadingConvs ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 py-14 text-center">
              <MessageSquare className="mb-3 h-8 w-8 text-slate-700" />
              <p className="text-base font-medium text-slate-500">No chats yet</p>
              <p className="mt-1.5 text-sm text-slate-600">
                Start a conversation to ask questions about this project&apos;s papers.
              </p>
              <Link
                href={`/chat?projectId=${project.id}`}
                className="mt-5 flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Start first chat
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => (
                <ConversationCard
                  key={conv.id}
                  conv={conv}
                  projectId={project.id}
                  onDelete={() => handleDeleteConversation(conv.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Write tab ──────────────────────────────────────────────────────── */}
      {activeTab === "write" && (
        <section>
          <WritingEditor projectId={project.id} />
        </section>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const getToken = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  // ── Load projects ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}/api/v1/projects/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setProjects(await r.json());
      } catch { /* non-critical */ }
      finally { setLoadingProjects(false); }
    }
    load();
  }, [getToken]);

  // ── Restore active project from localStorage ───────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem("litlens_active_project");
    if (saved) setActiveProjectId(saved);
  }, []);

  function selectProject(id: string) {
    if (activeProjectId === id) return; // already active — stay in project view
    setActiveProjectId(id);
    localStorage.setItem("litlens_active_project", id);
  }

  function clearProject() {
    setActiveProjectId(null);
    localStorage.removeItem("litlens_active_project");
  }

  // ── Delete project ─────────────────────────────────────────────────────────

  const handleDeleteProject = useCallback(async (projectId: string) => {
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/v1/projects/${projectId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok || r.status === 204) {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
        if (activeProjectId === projectId) clearProject();
      }
    } catch { /* non-critical */ }
  }, [getToken, activeProjectId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  // ── Project view (project is selected) ─────────────────────────────────────

  if (activeProject) {
    return (
      <div className="space-y-8">
        {/* Small project switcher strip */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProject(p.id)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                p.id === activeProjectId
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                  : "border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              {p.name}
              <span className="ml-1 text-xs opacity-60">{p.paper_count}</span>
            </button>
          ))}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-slate-700 px-4 py-2 text-sm text-slate-500 hover:border-slate-600 hover:text-slate-300 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        <ProjectView
          project={activeProject}
          onBack={clearProject}
          getToken={getToken}
        />

        {showCreateModal && (
          <CreateProjectModal
            onClose={() => setShowCreateModal(false)}
            onCreate={(p) => {
              setProjects((prev) => [...prev, p]);
              selectProject(p.id);
            }}
          />
        )}
      </div>
    );
  }

  // ── Grid view (no project selected) ────────────────────────────────────────

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            Projects
          </h2>
        </div>

        {loadingProjects ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
          </div>
        ) : (
          <>
            {projects.length === 0 && (
              <div className="mb-6 rounded-2xl border border-dashed border-slate-800 py-12 text-center">
                <FolderOpen className="mx-auto mb-3 h-9 w-9 text-slate-700" />
                <p className="text-base font-medium text-slate-500">No projects yet</p>
                <p className="mt-1.5 text-sm text-slate-600">
                  Create a project to organise your papers and chats into separate workspaces.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isActive={false}
                  onSelect={() => selectProject(project.id)}
                  onDelete={() => handleDeleteProject(project.id)}
                />
              ))}
              <CreateCard onClick={() => setShowCreateModal(true)} />
            </div>
          </>
        )}
      </section>

      {/* All-papers fallback when no project active */}
      <div>
        <div className="flex items-center gap-4 mb-6">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="flex items-center gap-2 text-sm text-slate-600">
            <BookOpen className="h-4 w-4" />
            All Papers
          </span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <UploadZone />
      </div>

      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(p) => {
            setProjects((prev) => [...prev, p]);
            selectProject(p.id);
          }}
        />
      )}
    </div>
  );
}
