import { createClient } from "@/lib/supabase/server";
import SettingsModal from "@/components/settings-modal";
import QuotaBadge from "@/components/quota-badge";
import ProjectDashboard from "@/components/project-dashboard";

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
    <main className="min-h-screen text-white" style={{ background: "linear-gradient(135deg, #0a0a14 0%, #0d0a1a 60%, #080810 100%)" }}>
      <div className="mx-auto max-w-7xl px-4 py-10">

        {/* ── Page header ── */}
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              My Research
            </h1>
            <p className="mt-1 text-slate-400">
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
    </main>
  );
}
