"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";

export async function sendMessage(
  projectId: string,
  body: string,
): Promise<{ error?: string }> {
  const ctx = await requireSession();
  const trimmed = body.trim();
  if (!trimmed) return { error: "Empty message." };
  if (trimmed.length > 4000) return { error: "Message too long." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("messages")
    .insert({ project_id: projectId, sender_id: ctx.userId, body: trimmed });
  if (error) return { error: error.message };
  return {};
}
