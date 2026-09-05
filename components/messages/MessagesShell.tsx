"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { ContactList } from "./ContactList";
import { ConversationThread } from "./ConversationThread";
import { openConversation, listMessages } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";
import type { Profile, DirectMessage } from "@/types/database.types";

type Row = DirectMessage & { profiles: Pick<Profile, "id" | "full_name" | "role"> | null };

function MessagesShellInner({
  currentUserId,
  contacts,
}: {
  currentUserId: string;
  contacts: Profile[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const withId = searchParams.get("with");
  const otherUser = contacts.find((c) => c.id === withId) ?? null;

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!otherUser) {
        if (!cancelled) {
          setConversationId(null);
          setMessages([]);
        }
        return;
      }
      setLoading(true);
      const conv = await openConversation(otherUser.id);
      if (cancelled || !conv.id) return;
      setConversationId(conv.id);
      const rows = await listMessages(conv.id);
      if (!cancelled) setMessages(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [otherUser]);

  function select(id: string) {
    router.replace(`/dashboard/messages?with=${id}`, { scroll: false });
  }

  return (
    <div className="flex flex-1 overflow-hidden rounded-xl border border-border bg-panel/50">
      <div
        className={cn(
          "w-full shrink-0 border-r border-border md:block md:w-72",
          otherUser ? "hidden" : "block",
        )}
      >
        <ContactList contacts={contacts} selectedId={withId} onSelect={select} />
      </div>

      <div className={cn("flex-1", otherUser ? "flex flex-col" : "hidden md:flex md:flex-col")}>
        {!otherUser && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-tertiary">
            <MessageSquare size={28} />
            <p className="text-[13px]">Pick a person to start messaging.</p>
          </div>
        )}
        {otherUser && (
          <>
            <button
              onClick={() => router.replace("/dashboard/messages", { scroll: false })}
              className="nr-interactive flex items-center gap-1.5 border-b border-border px-4 py-2 text-[12px] text-text-secondary md:hidden"
            >
              <ArrowLeft size={13} /> Back to contacts
            </button>
            {conversationId && !loading ? (
              <ConversationThread
                key={conversationId}
                conversationId={conversationId}
                currentUserId={currentUserId}
                otherUser={otherUser}
                initialMessages={messages}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-[13px] text-text-tertiary">
                Loading conversation…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function MessagesShell(props: { currentUserId: string; contacts: Profile[] }) {
  return (
    <Suspense fallback={<div className="flex-1 rounded-xl border border-border bg-panel/50" />}>
      <MessagesShellInner {...props} />
    </Suspense>
  );
}
