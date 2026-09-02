import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ChatRoom } from "@/components/chat/ChatRoom";
import type { Message, Profile, Project } from "@/types/database.types";

export const metadata = { title: "Chat" };

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const ctx = await requireSession();
  const supabase = await createClient();

  const { data: projectData } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  const project = projectData as Pick<Project, "id" | "name"> | null;
  if (!project) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("*, profiles:profiles!messages_sender_id_fkey(id, full_name, role)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(200);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 8rem)" }}>
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/dashboard/projects/${projectId}`}
          className="inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.06]"
        >
          <ArrowLeft size={15} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="text-[12px] text-text-tertiary">Project thread</p>
        </div>
      </div>

      <ChatRoom
        projectId={projectId}
        currentUserId={ctx.userId}
        initialMessages={
          (messages ?? []) as (Message & {
            profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
          })[]
        }
      />
    </div>
  );
}
