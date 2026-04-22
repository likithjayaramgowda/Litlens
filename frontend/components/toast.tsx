"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

// ── Singleton event bus ───────────────────────────────────────────────────────

type Listener = (toast: Toast) => void;
const listeners: Set<Listener> = new Set();

export function toast(message: string, type: ToastType = "info") {
  const t: Toast = { id: `${Date.now()}-${Math.random()}`, message, type };
  listeners.forEach((fn) => fn(t));
}
toast.success = (msg: string) => toast(msg, "success");
toast.error   = (msg: string) => toast(msg, "error");
toast.info    = (msg: string) => toast(msg, "info");

// ── Individual toast item ─────────────────────────────────────────────────────

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />,
  error:   <XCircle    className="h-4 w-4 shrink-0 text-red-400" />,
  info:    <AlertCircle className="h-4 w-4 shrink-0 text-blue-400" />,
};

const BORDER: Record<ToastType, string> = {
  success: "border-emerald-800/50",
  error:   "border-red-800/50",
  info:    "border-blue-800/50",
};

function ToastItem({
  toast: t,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), 3_500);
    const remove = setTimeout(() => onDismiss(t.id), 4_000);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
      clearTimeout(remove);
    };
  }, [t.id, onDismiss]);

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-slate-900/95 px-4 py-3 shadow-2xl backdrop-blur
                  transition-all duration-300 ${BORDER[t.type]}
                  ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
      style={{ minWidth: 260, maxWidth: 380 }}
    >
      {ICONS[t.type]}
      <span className="flex-1 text-sm text-slate-200 leading-snug">{t.message}</span>
      <button
        onClick={() => onDismiss(t.id)}
        className="shrink-0 rounded-md p-0.5 text-slate-600 hover:text-slate-300 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Container (add to layout or root) ────────────────────────────────────────

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler: Listener = (t) => setToasts((prev) => [...prev, t]);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
