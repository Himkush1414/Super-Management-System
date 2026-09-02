"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime";
import { sendMessage } from "@/lib/actions/chat";
import { RoleBadge } from "@/components/shared/Badge";
import { Button } from "@/components/ui/Button";
import { initials, formatRelativeTime, cn } from "@/lib/utils";
import type { Message, Profile } from "@/types/database.types";

type Row = Message & {
  profiles: Pick<Profile, "id" | "full_name" | "role"> | null;
};

export function ChatRoom({
  projectId,
  currentUserId,
  initialMessages,
}: {
  projectId: string;
  currentUserId: string;
  initialMessages: Row[];
}) {
  const [messages, setMessages] = useState<Row[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useRealtime(
    `chat-${projectId}`,
    { table: "messages", filter: `project_id=eq.${projectId}`, event: "INSERT" },
    async (payload) => {
      const row = (payload as { new: Message }).new;
      if (messages.some((m) => m.id === row.id)) return;
      const supabase = createClient();
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", row.sender_id)
        .maybeSingle();
      setMessages((prev) =>
        prev.some((m) => m.id === row.id)
          ? prev
          : [...prev, { ...row, profiles: profile as Row["profiles"] }],
      );
    },
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setErr(null);
    const r = await sendMessage(projectId, body);
    setSending(false);
    if (r.error) setErr(r.error);
    else setDraft("");
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-panel/50">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-12 text-center text-[13px] text-text-tertiary">
            No messages yet. Start the conversation.
          </p>
        )}
        {messages.map((m) => {
          const own = m.sender_id === currentUserId;
          return (
            <div key={m.id} className={cn("flex gap-3", own && "flex-row-reverse")}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-[11px] font-medium">
                {initials(m.profiles?.full_name ?? "?")}
              </span>
              <div className={cn("max-w-[75%]", own && "items-end text-right")}>
                <div className={cn("flex items-center gap-2", own && "flex-row-reverse")}>
                  <span className="text-[12px] font-medium">
                    {m.profiles?.full_name ?? "Unknown"}
                  </span>
                  {m.profiles && <RoleBadge role={m.profiles.role} />}
                  <span className="text-[11px] text-text-tertiary">
                    {formatRelativeTime(m.created_at)}
                  </span>
                </div>
                <div
                  className={cn(
                    "mt-1 inline-block whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                    own
                      ? "bg-accent text-accent-fg"
                      : "bg-elevated text-text",
                  )}
                >
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="border-t border-border p-3">
        {err && <p className="mb-2 text-[12px] text-status-danger">{err}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            rows={1}
            placeholder="Write a message…"
            className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-border-strong bg-bg-subtle px-3 py-2 text-[13px] placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
          <Button type="submit" size="sm" loading={sending} disabled={!draft.trim()}>
            <SendHorizontal size={14} />
          </Button>
        </div>
      </form>
    </div>
  );
}
