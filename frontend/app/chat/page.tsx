import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatInterface from "@/components/chat-interface";

export const metadata = { title: "Chat — LitLens" };

// Next.js 14 App Router passes searchParams synchronously to async Server Components.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: { projectId?: string; convId?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <ChatInterface
      projectId={searchParams.projectId}
      initialConvId={searchParams.convId}
    />
  );
}
