"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { useRealtime } from "@/lib/realtime";
import { sendDirectMessage } from "@/lib/actions/messages";
import { RoleBadge } from "@/components/shared/Badge";
import { Button } from "@/components/ui/Button";
import { VoiceNotePlayer } from "./VoiceNotePlayer";
import { VoiceRecorder } from "./VoiceRecorder";
import { initials, formatRelativeTime, cn } from "@/lib/utils";
import type { DirectMessage, Profile } from "@/types/database.types";

type Row = DirectMessage & { profiles: Pick<Profile, "id" | "full_name" | "role"> | null };

export function ConversationThread({
  conversationId,
  currentUserId,
  otherUser,
  initialMessages,
}: {
  conversationId: string;
  currentUserId: string;
  otherUser: Profile;
  initialMessages: Row[];
}) {
  // Parent remounts this component (via `key={conversationId}`) whenever the
  // selected conversation changes, so `initialMessages` only ever needs to
  // seed state once per mount — no reset-on-prop-change effect needed.
  const [messages, setMessages] = useState<Row[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useRealtime(
    `dm-${conversationId}`,
    { table: "direct_messages", filter: `conversation_id=eq.${conversationId}`, event: "INSERT" },
    (payload) => {
      const row = (payload as { new: DirectMessage }).new;
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        const profiles =
          row.sender_id === currentUserId
            ? null
            : { id: otherUser.id, full_name: otherUser.full_name, role: otherUser.role };
        return [...prev, { ...row, profiles }];
      });
    },
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setErr(null);
    const r = await sendDirectMessage(conversationId, { kind: "text", body });
    setSending(false);
    if (r.error) setErr(r.error);
    else setDraft("");
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-[11px] font-medium">
          {initials(otherUser.full_name || "?")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{otherUser.full_name || "Unnamed"}</p>
          <RoleBadge role={otherUser.role} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-12 text-center text-[13px] text-text-tertiary">
            No messages yet. Say hello — this thread disappears 60h after the
            last message.
          </p>
        )}
        {messages.map((m) => {
          const own = m.sender_id === currentUserId;
          return (
            <div key={m.id} className={cn("flex gap-3", own && "flex-row-reverse")}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-[11px] font-medium">
                {initials((own ? "Me" : m.profiles?.full_name) ?? "?")}
              </span>
              <div className={cn("max-w-[75%]", own && "items-end text-right")}>
                <div className={cn("flex items-center gap-2", own && "flex-row-reverse")}>
                  <span className="text-[11px] text-text-tertiary">{formatRelativeTime(m.created_at)}</span>
                </div>
                <div
                  className={cn(
                    "mt-1 inline-block whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                    own ? "bg-accent text-accent-fg" : "bg-elevated text-text",
                  )}
                >
                  {m.kind === "voice" && m.voice_path ? <VoiceNotePlayer path={m.voice_path} /> : m.body}
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
          <VoiceRecorder conversationId={conversationId} onSent={() => {}} />
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
