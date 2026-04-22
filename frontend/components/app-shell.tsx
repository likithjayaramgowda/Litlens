"use client";

import AppSidebar, { useAppSidebar } from "./app-sidebar";
import { ToastContainer } from "./toast";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useAppSidebar();

  return (
    <div
      className="flex h-screen overflow-hidden text-white"
      style={{
        background: "linear-gradient(135deg,#0a0a14 0%,#0d0a1a 60%,#080810 100%)",
      }}
    >
      <AppSidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex flex-1 flex-col overflow-auto min-w-0">
        {children}
      </div>
      <ToastContainer />
    </div>
  );
}
