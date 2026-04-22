import { createClient } from "@/lib/supabase/server";
import SettingsModal from "@/components/settings-modal";
import QuotaBadge from "@/components/quota-badge";
import ProjectDashboard from "@/components/project-dashboard";
import AppShell from "@/components/app-shell";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "researcher";

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-6 py-8">

        {/* ── Page header ── */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              My Research
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Welcome back,{" "}
              <span className="text-slate-200">{displayName}</span>.
              Organise your papers into projects and start analysing.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <QuotaBadge />
            <SettingsModal />
          </div>
        </div>

        {/* ── Project-aware dashboard ── */}
        <ProjectDashboard />
      </div>
    </AppShell>
  );
}
