import { createClient } from "@/lib/supabase/server";
import UploadZone from "@/components/upload-zone";
import SettingsModal from "@/components/settings-modal";
import QuotaBadge from "@/components/quota-badge";

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
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-10">

        {/* ── Page header ── */}
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              My Papers
            </h1>
            <p className="mt-1 text-slate-400">
              Welcome back,{" "}
              <span className="text-slate-200">{displayName}</span>. Upload PDFs
              to start analysing your research library.
            </p>
          </div>

          {/* Right side: quota counter + advanced settings gear */}
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <QuotaBadge />
            <SettingsModal />
          </div>
        </div>

        {/* ── Upload zone + papers library ── */}
        <UploadZone />
      </div>
    </main>
  );
}
