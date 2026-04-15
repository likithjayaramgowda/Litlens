"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

export default function QuotaBadge() {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchQuota() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const r = await fetch(`${API_URL}/api/v1/llm/quota`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const body: QuotaInfo = await r.json();
        if (!cancelled) setQuota(body);
      } catch {
        // Non-critical — silently ignore if table doesn't exist yet
      }
    }

    fetchQuota();
    return () => { cancelled = true; };
  }, []);

  if (!quota) return null;

  const pct = quota.limit > 0 ? quota.remaining / quota.limit : 1;
  const isLow = pct <= 0.2;
  const isExhausted = quota.remaining === 0;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        isExhausted
          ? "border-red-500/30 bg-red-500/10 text-red-400"
          : isLow
          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
          : "border-slate-800 bg-slate-900/40 text-slate-500"
      }`}
      title={`${quota.used} of ${quota.limit} daily queries used`}
    >
      {/* Mini progress bar */}
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${
            isExhausted ? "bg-red-500" : isLow ? "bg-amber-500" : "bg-violet-500"
          }`}
          style={{ width: `${Math.max(4, pct * 100)}%` }}
        />
      </div>
      <span>
        {isExhausted
          ? "Quota exhausted"
          : `${quota.remaining}/${quota.limit} queries left`}
      </span>
    </div>
  );
}
