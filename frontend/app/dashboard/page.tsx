import { createClient } from "@/lib/supabase/server";
import UploadZone from "@/components/upload-zone";

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
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            My Papers
          </h1>
          <p className="mt-1 text-slate-400">
            Welcome back,{" "}
            <span className="text-slate-200">{displayName}</span>. Upload PDFs
            to start analysing your research library.
          </p>
        </div>

        {/* ── Upload zone + papers library ── */}
        <UploadZone />
      </div>
    </main>
  );
}
