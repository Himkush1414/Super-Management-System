"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import type { Profile, DirectMessage } from "@/types/database.types";

export type Result = { error?: string; ok?: string };

/**
 * Any-to-any contact list, no hierarchy — every active, non-Head-Admin user
 * except yourself (spec §4). Head Admin never appears here, and Head Admin
 * itself is blocked from this page at the route level.
 */
export async function listContacts(): Promise<Profile[]> {
  const ctx = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("status", "active")
    .neq("role", "head_admin")
    .neq("id", ctx.userId)
    .order("full_name", { ascending: true });
  return (data ?? []) as Profile[];
}

export async function openConversation(otherUserId: string): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    other: otherUserId,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function sendDirectMessage(
  conversationId: string,
  input: { kind: "text"; body: string } | { kind: "voice"; voicePath: string },
): Promise<Result> {
  const ctx = await requireSession();
  const supabase = await createClient();

  const row =
    input.kind === "text"
      ? { kind: "text" as const, body: input.body.trim() || null, voice_path: null }
      : { kind: "voice" as const, body: null, voice_path: input.voicePath };

  if (row.kind === "text" && !row.body) return { error: "Empty message." };

  const { error } = await supabase.from("direct_messages").insert({
    conversation_id: conversationId,
    sender_id: ctx.userId,
    ...row,
  });
  if (error) return { error: error.message };
  return {};
}

export async function listMessages(
  conversationId: string,
): Promise<(DirectMessage & { profiles: Pick<Profile, "id" | "full_name" | "role"> | null })[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("direct_messages")
    .select("*, profiles:profiles!direct_messages_sender_id_fkey(id, full_name, role)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as (DirectMessage & {
    profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
  })[];
}

/** Short-lived signed URL for private voice-note playback. */
export async function getVoiceNoteUrl(path: string): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("voice-notes").createSignedUrl(path, 120);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
