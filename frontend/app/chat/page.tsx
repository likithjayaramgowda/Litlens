import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatInterface from "@/components/chat-interface";
import AppShell from "@/components/app-shell";

export const metadata = { title: "Chat — LitLens" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; convId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const params = await searchParams;

  return (
    <AppShell>
      <ChatInterface
        projectId={params.projectId}
        initialConvId={params.convId}
      />
    </AppShell>
  );
}
