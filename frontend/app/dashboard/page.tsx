import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Welcome back, {user?.email ?? "researcher"}.
      </p>
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Your workspaces will appear here. (Phase 2)
      </div>
    </main>
  );
}
