"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Settings,
  X,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Constants ─────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const STORAGE_KEY = "litlens_llm_settings";

// ── BYOK settings shape ───────────────────────────────────────────────────────

export interface LLMSettings {
  /** DeepSeek API key — empty string means "use free tier". */
  deepseekKey: string;
  /** "deepseek-chat" (V3) | "deepseek-reasoner" (R1) */
  deepseekModel: string;
}

const DEFAULT_SETTINGS: LLMSettings = {
  deepseekKey: "",
  deepseekModel: "deepseek-chat",
};

const DEEPSEEK_MODELS = [
  { id: "deepseek-chat",     name: "DeepSeek V3 (Chat)" },
  { id: "deepseek-reasoner", name: "DeepSeek R1 (Reasoner)" },
];

export function loadLLMSettings(): LLMSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLLMSettings(s: LLMSettings) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

// ── Small sub-components ──────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="text-slate-500 hover:text-slate-400 focus:outline-none"
        aria-label="More information"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {visible && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 shadow-xl">
          {text}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
        </span>
      )}
    </span>
  );
}

function ModelDropdown({
  models,
  value,
  onChange,
}: {
  models: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = models.find((m) => m.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-200 transition-colors hover:border-slate-600 focus:border-violet-500 focus:outline-none"
      >
        <span>{selected?.name ?? value}</span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {models.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => { onChange(m.id); setOpen(false); }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-800 ${m.id === value ? "text-violet-400" : "text-slate-200"}`}
              >
                {m.name}
                {m.id === value && <Check className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── DeepSeek icon ─────────────────────────────────────────────────────────────

function DeepSeekIcon({ size = 18 }: { size?: number }) {
  // Simplified "D" mark in DeepSeek brand style
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4h7c4.418 0 8 3.582 8 8s-3.582 8-8 8H4V4zm3 3v10h4c2.761 0 5-2.239 5-5s-2.239-5-5-5H7z" />
    </svg>
  );
}

// ── Main modal component ──────────────────────────────────────────────────────

export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load from sessionStorage when modal opens
  useEffect(() => {
    if (open) {
      setSettings(loadLLMSettings());
      setTestResult(null);
      setShowKey(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const patch = useCallback((partial: Partial<LLMSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    setTestResult(null);
  }, []);

  function handleSave() {
    saveLLMSettings(settings);
    setOpen(false);
  }

  function handleClear() {
    const cleared = DEFAULT_SETTINGS;
    saveLLMSettings(cleared);
    setSettings(cleared);
    setTestResult(null);
  }

  async function handleTest() {
    if (!settings.deepseekKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";

      const r = await fetch(`${API_URL}/api/v1/llm/test-connection`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-LLM-Provider": "deepseek",
          "X-LLM-Model": settings.deepseekModel,
          "X-LLM-API-Key": settings.deepseekKey,
        },
      });
      const body = await r.json();
      if (r.ok && body.ok) {
        setTestResult({ ok: true, message: "Connection successful!" });
      } else {
        setTestResult({ ok: false, message: body.error ?? body.detail ?? "Connection failed." });
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const hasKey = Boolean(settings.deepseekKey);

  return (
    <>
      {/* ── Trigger button — gear icon only, unobtrusive ── */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-xs text-slate-500 transition-all hover:border-slate-700 hover:text-slate-300"
        aria-label="Advanced settings"
        title="Advanced settings"
      >
        <Settings className="h-3.5 w-3.5" />
        <span>Advanced</span>
      </button>

      {/* ── Modal backdrop ── */}
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">Advanced Settings</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Optional: bring your own DeepSeek key for advanced reasoning.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-5 p-6">

              {/* Free-tier notice */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-400 leading-relaxed">
                <span className="font-medium text-slate-300">LitLens uses free AI models by default.</span>{" "}
                Queries are routed through OpenRouter — choose Quick, Deep Thinking, or Long Context in the chat. No setup needed.
                Add your own DeepSeek key below to bypass OpenRouter entirely.
              </div>

              {/* DeepSeek header */}
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400">
                  <DeepSeekIcon size={16} />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">DeepSeek</p>
                  <p className="text-xs text-slate-500">api.deepseek.com</p>
                </div>
              </div>

              {/* API key input */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  API Key
                  <Tooltip text="Your DeepSeek API key is sent directly to api.deepseek.com via your browser request. It is never logged, stored, or processed by LitLens servers — it lives only in sessionStorage and is cleared when you close this tab." />
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={settings.deepseekKey}
                    onChange={(e) => patch({ deepseekKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 transition-colors focus:border-violet-500 focus:outline-none"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Model picker */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Model</label>
                <ModelDropdown
                  models={DEEPSEEK_MODELS}
                  value={settings.deepseekModel}
                  onChange={(id) => patch({ deepseekModel: id })}
                />
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                  testResult.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}>
                  {testResult.ok
                    ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {hasKey && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-300"
                  >
                    Use free tier
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !hasKey}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 transition-all hover:border-slate-600 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  {testing
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  {testing ? "Testing…" : "Test connection"}
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  className="ml-auto rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
                >
                  Save
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
