"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LogOut,
  MessageSquare,
  Plus,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── localStorage persistence ───────────────────────────────────────────────────

const SIDEBAR_KEY = "litlens_sidebar_collapsed";

export function useAppSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "true");
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

// ── Nav item ──────────────────────────────────────────────────────────────────

function NavItem({
  href,
  icon,
  label,
  active,
  collapsed,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors
        ${collapsed ? "justify-center" : ""}
        ${active
          ? "bg-violet-600/20 text-violet-300"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        }`}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<{
    email: string;
    avatarUrl?: string;
    initials: string;
  } | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const u = data.user;
        if (!u) return;
        setUser({
          email: u.email ?? "",
          avatarUrl: u.user_metadata?.avatar_url as string | undefined,
          initials: (u.email ?? "??").slice(0, 2).toUpperCase(),
        });
      })
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    await createClient().auth.signOut();
    window.location.href = "/";
  }

  const W = collapsed ? 48 : 240;

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-slate-800/70 transition-[width] duration-200 overflow-hidden"
      style={{ width: W, background: "rgba(7,7,14,0.97)" }}
    >
      {/* Brand + toggle */}
      <div
        className={`flex items-center border-b border-slate-800/70 px-3 py-[15px] ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        {!collapsed && (
          <span className="text-sm font-bold tracking-tight text-white select-none">
            LitLens
          </span>
        )}
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <NavItem
          href="/chat"
          icon={<Plus className="h-4 w-4 shrink-0" />}
          label="New Chat"
          active={false}
          collapsed={collapsed}
        />
        <NavItem
          href="/dashboard"
          icon={<FolderOpen className="h-4 w-4 shrink-0" />}
          label="Projects"
          active={pathname === "/dashboard"}
          collapsed={collapsed}
        />
        <NavItem
          href="/chat"
          icon={<MessageSquare className="h-4 w-4 shrink-0" />}
          label="Chats"
          active={pathname === "/chat"}
          collapsed={collapsed}
        />
      </nav>

      {/* Bottom: user info + sign out */}
      <div className="border-t border-slate-800/70 p-2 space-y-0.5">
        <button
          onClick={handleSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-800/60 hover:text-slate-300 transition-colors ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>

        {user && (
          <div
            className={`flex items-center gap-2.5 px-2.5 py-2 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="avatar"
                title={collapsed ? user.email : undefined}
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-xs font-semibold text-violet-300"
                title={collapsed ? user.email : undefined}
              >
                {user.initials}
              </span>
            )}
            {!collapsed && (
              <span className="truncate text-xs text-slate-500">
                {user.email}
              </span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
