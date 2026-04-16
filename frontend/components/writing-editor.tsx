"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlertCircle,
  AlignLeft,
  Bold,
  BookMarked,
  CheckCircle2,
  ChevronDown,
  FileText,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Save,
  ScanText,
  Sparkles,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CitationSuggestion {
  paper_id: string;
  paper_title: string;
  page_number: number;
  confidence: "strong" | "moderate" | "weak";
  reason: string;
  excerpt: string;
  needs_citation: boolean;
}

interface VerifyAnnotation {
  paragraph: string;
  status: "correct" | "weak" | "wrong" | "missing" | "ok";
  message: string;
  suggestion: string;
}

type CitationStyle = "APA" | "MLA" | "IEEE" | "Harvard" | "Chicago";

interface Draft {
  title: string;
  content: string;
  citation_style: CitationStyle;
  updated_at?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? "";
}

function formatInlineCitation(
  paper_title: string,
  authors: string,
  year: string | number,
  page: number,
  style: CitationStyle,
  index: number
): string {
  const last = authors
    ? authors.split(",")[0].trim().split(" ").at(-1) ?? "Author"
    : "Author";

  switch (style) {
    case "APA":
      return `(${last}, ${year}, p. ${page})`;
    case "MLA":
      return `(${last} ${page})`;
    case "IEEE":
      return `[${index}]`;
    case "Harvard":
      return `(${last} ${year}, p. ${page})`;
    case "Chicago":
      return `(${last} ${year}, ${page})`;
    default:
      return `(${last}, ${year})`;
  }
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all ${
        active
          ? "bg-violet-500/20 text-violet-300"
          : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

// ── Confidence badge ───────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: "strong" | "moderate" | "weak" }) {
  const styles = {
    strong: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    moderate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    weak: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[level]}`}
    >
      {level}
    </span>
  );
}

// ── Verify status icon ─────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: VerifyAnnotation["status"] }) {
  switch (status) {
    case "correct":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    case "weak":
      return <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />;
    case "wrong":
      return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
    case "missing":
      return <AlertCircle className="h-4 w-4 text-orange-400 shrink-0" />;
    default:
      return <CheckCircle2 className="h-4 w-4 text-slate-600 shrink-0" />;
  }
}

function statusLabel(status: VerifyAnnotation["status"]): string {
  switch (status) {
    case "correct": return "Correct";
    case "weak":    return "Could be stronger";
    case "wrong":   return "Unsupported";
    case "missing": return "Citation needed";
    default:        return "No citation needed";
  }
}

function statusBg(status: VerifyAnnotation["status"]): string {
  switch (status) {
    case "correct": return "border-emerald-500/30 bg-emerald-500/5";
    case "weak":    return "border-amber-500/30 bg-amber-500/5";
    case "wrong":   return "border-red-500/30 bg-red-500/5";
    case "missing": return "border-orange-500/30 bg-orange-500/5";
    default:        return "border-slate-800 bg-transparent";
  }
}

// ── Citation style dropdown ────────────────────────────────────────────────────

const STYLES: CitationStyle[] = ["APA", "MLA", "IEEE", "Harvard", "Chicago"];

function StyleDropdown({
  value,
  onChange,
}: {
  value: CitationStyle;
  onChange: (s: CitationStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:border-slate-600 hover:text-slate-100 transition-all"
      >
        <BookMarked className="h-3.5 w-3.5 text-violet-400" />
        {value}
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                s === value
                  ? "text-violet-300 bg-violet-500/10"
                  : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              {s === value && <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />}
              {s === value ? "" : <span className="w-2.5" />}
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WritingEditor({
  projectId,
}: {
  projectId: string;
}) {
  // Editor state
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("APA");
  const [draftTitle, setDraftTitle] = useState("Untitled Draft");

  // Suggestion sidebar state
  const [suggestions, setSuggestions] = useState<CitationSuggestion[]>([]);
  const [needsCitation, setNeedsCitation] = useState<boolean | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");

  // Verify mode state
  const [verifyMode, setVerifyMode] = useState(false);
  const [annotations, setAnnotations] = useState<VerifyAnnotation[]>([]);
  const [loadingVerify, setLoadingVerify] = useState(false);

  // Bibliography state
  const [bibliography, setBibliography] = useState("");
  const [loadingBib, setLoadingBib] = useState(false);
  const [showBib, setShowBib] = useState(false);

  // Draft save state
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [citationIndex, setCitationIndex] = useState(1); // for IEEE numbered citations

  // Debounce timer refs
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Tiptap editor ────────────────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Placeholder.configure({
        placeholder: "Start writing your paper… Citation suggestions appear automatically as you type.",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-slate max-w-none min-h-[400px] focus:outline-none " +
          "prose-headings:text-white prose-p:text-slate-200 prose-p:leading-relaxed " +
          "prose-strong:text-white prose-em:text-slate-300 " +
          "prose-blockquote:border-violet-500 prose-blockquote:text-slate-400 " +
          "prose-li:text-slate-200 prose-code:text-violet-300",
      },
    },
    onUpdate({ editor }) {
      // Auto-suggest: debounce 2 seconds after typing stops
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = setTimeout(() => {
        const text = editor.getText();
        const lines = text.split("\n").filter((l) => l.trim().length > 20);
        if (lines.length > 0) {
          const lastPara = lines[lines.length - 1];
          triggerSuggest(lastPara);
        }
      }, 2000);

      // Auto-save: debounce 3 seconds
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveDraft(editor.getHTML());
      }, 3000);
    },
  });

  // ── Load draft on mount ───────────────────────────────────────────────────────

  useEffect(() => {
    async function loadDraft() {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}/api/v1/citations/drafts/${projectId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const draft: Draft = await r.json();
          setDraftTitle(draft.title);
          setCitationStyle(draft.citation_style as CitationStyle);
          if (editor && draft.content) {
            editor.commands.setContent(draft.content);
          }
          setLastSaved(draft.updated_at ? new Date(draft.updated_at) : null);
        }
        // 404 = no draft yet, start fresh
      } catch {
        // Non-critical — start with empty editor
      }
    }
    if (editor) loadDraft();
  }, [projectId, editor]);

  // ── Citation suggestion ───────────────────────────────────────────────────────

  const triggerSuggest = useCallback(async (paragraph: string) => {
    if (!paragraph.trim() || paragraph.length < 20) return;
    setLoadingSuggestions(true);
    setSuggestionError("");
    setVerifyMode(false);

    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/v1/citations/suggest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paragraph,
          project_id: projectId,
          citation_style: citationStyle,
        }),
      });
      if (!r.ok) throw new Error("Suggestion request failed");
      const data: CitationSuggestion[] = await r.json();
      setSuggestions(data);
      setNeedsCitation(data.length > 0 ? data[0]?.needs_citation ?? null : false);
    } catch {
      setSuggestionError("Could not load suggestions.");
    } finally {
      setLoadingSuggestions(false);
    }
  }, [projectId, citationStyle]);

  // ── Insert citation inline ────────────────────────────────────────────────────

  function insertCitation(s: CitationSuggestion) {
    if (!editor) return;
    const citation = formatInlineCitation(
      s.paper_title,
      "",          // We don't store authors in suggestions — use title-based fallback
      new Date().getFullYear(),
      s.page_number,
      citationStyle,
      citationIndex,
    );
    editor.commands.insertContent(` ${citation}`);
    setCitationIndex((i) => i + 1);
  }

  // ── Verify draft ──────────────────────────────────────────────────────────────

  async function handleVerify() {
    if (!editor) return;
    const html = editor.getHTML();
    if (!html || html === "<p></p>") return;

    setLoadingVerify(true);
    setVerifyMode(true);
    setSuggestions([]);

    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/v1/citations/verify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: html,
          project_id: projectId,
          citation_style: citationStyle,
        }),
      });
      if (!r.ok) throw new Error("Verification failed");
      setAnnotations(await r.json());
    } catch {
      setAnnotations([]);
    } finally {
      setLoadingVerify(false);
    }
  }

  // ── Generate bibliography ─────────────────────────────────────────────────────

  async function handleBibliography() {
    setLoadingBib(true);
    setShowBib(true);
    setBibliography("");

    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/v1/citations/bibliography`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: projectId,
          citation_style: citationStyle,
        }),
      });
      if (!r.ok) throw new Error("Bibliography generation failed");
      const data = await r.json();
      setBibliography(data.bibliography);
    } catch {
      setBibliography("Could not generate bibliography.");
    } finally {
      setLoadingBib(false);
    }
  }

  // ── Save draft ────────────────────────────────────────────────────────────────

  const saveDraft = useCallback(async (html: string) => {
    setSaving(true);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/v1/citations/drafts/${projectId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: draftTitle,
          content: html,
          citation_style: citationStyle,
        }),
      });
      setLastSaved(new Date());
    } catch {
      // Non-critical — silently fail
    } finally {
      setSaving(false);
    }
  }, [projectId, draftTitle, citationStyle]);

  // Manual save
  function handleManualSave() {
    if (!editor) return;
    saveDraft(editor.getHTML());
  }

  // Save when citation style changes
  useEffect(() => {
    if (editor && editor.getText().trim()) {
      saveDraft(editor.getHTML());
    }
  }, [citationStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────────

  const EDITOR_STYLES = `
    .ProseMirror p.is-editor-empty:first-child::before {
      color: #64748b;
      content: attr(data-placeholder);
      float: left;
      height: 0;
      pointer-events: none;
    }
    .ProseMirror {
      padding: 0;
      caret-color: #a78bfa;
    }
    .ProseMirror:focus { outline: none; }
  `;

  return (
    <div className="flex gap-6 min-h-[600px]">
      <style dangerouslySetInnerHTML={{ __html: EDITOR_STYLES }} />

      {/* ── Editor panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Draft title */}
        <input
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={handleManualSave}
          placeholder="Draft title…"
          className="mb-4 w-full bg-transparent text-2xl font-bold text-white placeholder-slate-700 focus:outline-none border-none"
        />

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
          {/* Text format */}
          <ToolbarBtn
            title="Heading 1"
            active={editor?.isActive("heading", { level: 1 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarBtn>

          <ToolbarBtn
            title="Heading 2"
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarBtn>

          <ToolbarBtn
            title="Paragraph"
            active={editor?.isActive("paragraph")}
            onClick={() => editor?.chain().focus().setParagraph().run()}
          >
            <AlignLeft className="h-4 w-4" />
          </ToolbarBtn>

          <div className="mx-1 h-5 w-px bg-slate-700" />

          <ToolbarBtn
            title="Bold"
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarBtn>

          <ToolbarBtn
            title="Italic"
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarBtn>

          <div className="mx-1 h-5 w-px bg-slate-700" />

          <ToolbarBtn
            title="Bullet list"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarBtn>

          <ToolbarBtn
            title="Numbered list"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarBtn>

          <ToolbarBtn
            title="Blockquote"
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="h-4 w-4" />
          </ToolbarBtn>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Citation style */}
          <StyleDropdown value={citationStyle} onChange={setCitationStyle} />

          <div className="mx-1 h-5 w-px bg-slate-700" />

          {/* Review button */}
          <button
            type="button"
            onClick={handleVerify}
            disabled={loadingVerify}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:border-amber-500/50 hover:text-amber-300 transition-all disabled:opacity-40"
            title="Review my draft for citation issues"
          >
            {loadingVerify
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ScanText className="h-3.5 w-3.5" />}
            Review
          </button>

          {/* Bibliography button */}
          <button
            type="button"
            onClick={handleBibliography}
            disabled={loadingBib}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:border-violet-500/50 hover:text-violet-300 transition-all disabled:opacity-40"
            title="Generate bibliography"
          >
            {loadingBib
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FileText className="h-3.5 w-3.5" />}
            Bibliography
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={handleManualSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 transition-all disabled:opacity-40"
          >
            {saving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>

        {/* Editor area */}
        <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/40 px-8 py-6">
          <EditorContent editor={editor} />
        </div>

        {/* Save status */}
        <div className="mt-2 text-right text-xs text-slate-600">
          {saving ? (
            <span className="flex items-center justify-end gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          ) : lastSaved ? (
            <span>Last saved {lastSaved.toLocaleTimeString()}</span>
          ) : null}
        </div>

        {/* Bibliography panel */}
        {showBib && (
          <div className="mt-6 rounded-xl border border-violet-500/30 bg-violet-500/5 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-violet-300">
                References ({citationStyle})
              </h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(bibliography)}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setShowBib(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-red-400 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            {loadingBib ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating…
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300 font-sans">
                {bibliography}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── Right sidebar ───────────────────────────────────────────────────── */}
      <div className="w-80 shrink-0 space-y-4">

        {/* Sidebar header */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              {verifyMode ? "Draft Review" : "Citation Suggestions"}
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            {verifyMode
              ? "Paragraph-by-paragraph citation check based on your project papers."
              : "Suggestions appear automatically after 2 seconds of inactivity."}
          </p>
        </div>

        {/* ── Suggestion mode ─────────────────────────────────────────────── */}
        {!verifyMode && (
          <div className="space-y-3">
            {loadingSuggestions && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                Analysing your text…
              </div>
            )}

            {suggestionError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                {suggestionError}
              </div>
            )}

            {!loadingSuggestions && needsCitation === false && suggestions.length === 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-5 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500/60" />
                <p className="text-sm text-slate-500">No citation needed for this text.</p>
              </div>
            )}

            {!loadingSuggestions && needsCitation && suggestions.length === 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-5 text-center">
                <AlertCircle className="mx-auto mb-2 h-6 w-6 text-amber-400/70" />
                <p className="text-sm text-amber-400">This text may need a citation, but no matching papers were found in this project.</p>
              </div>
            )}

            {suggestions.map((s, i) => (
              <div
                key={`${s.paper_id}-${i}`}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 transition-all hover:border-slate-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200 leading-snug line-clamp-2">
                    {s.paper_title}
                  </p>
                  <ConfidenceBadge level={s.confidence} />
                </div>

                <p className="text-xs text-slate-500">Page {s.page_number}</p>

                {s.reason && (
                  <p className="text-xs leading-relaxed text-slate-400">{s.reason}</p>
                )}

                {s.excerpt && (
                  <blockquote className="border-l-2 border-slate-700 pl-3 text-xs italic leading-relaxed text-slate-500 line-clamp-3">
                    {s.excerpt}
                  </blockquote>
                )}

                <button
                  type="button"
                  onClick={() => insertCitation(s)}
                  className="w-full rounded-lg border border-violet-500/30 bg-violet-500/10 py-2 text-xs font-medium text-violet-300 hover:bg-violet-500/20 hover:text-violet-200 transition-all"
                >
                  Insert {citationStyle} citation
                </button>
              </div>
            ))}

            {!loadingSuggestions && suggestions.length === 0 && needsCitation === null && (
              <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center">
                <Sparkles className="mx-auto mb-2 h-6 w-6 text-slate-700" />
                <p className="text-sm text-slate-600">Start writing to see citation suggestions.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Verify mode ─────────────────────────────────────────────────── */}
        {verifyMode && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setVerifyMode(false)}
              className="mb-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← Back to suggestions
            </button>

            {loadingVerify && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                Reviewing your draft…
              </div>
            )}

            {!loadingVerify && annotations.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center">
                <ScanText className="mx-auto mb-2 h-6 w-6 text-slate-700" />
                <p className="text-sm text-slate-600">No paragraphs to review yet.</p>
              </div>
            )}

            {!loadingVerify && annotations.map((a, i) => (
              <div
                key={i}
                className={`rounded-xl border p-3.5 space-y-1.5 ${statusBg(a.status)}`}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={a.status} />
                  <span className="text-xs font-semibold text-slate-300">
                    {statusLabel(a.status)}
                  </span>
                </div>
                {a.paragraph && (
                  <p className="text-xs text-slate-500 italic line-clamp-2">
                    &ldquo;{a.paragraph}&rdquo;
                  </p>
                )}
                {a.message && (
                  <p className="text-xs leading-relaxed text-slate-400">{a.message}</p>
                )}
                {a.suggestion && a.status !== "ok" && (
                  <p className="text-xs leading-relaxed text-slate-500 border-t border-slate-700/50 pt-1.5 mt-1.5">
                    → {a.suggestion}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
