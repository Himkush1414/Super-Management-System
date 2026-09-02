"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Postgres changes on a table (optionally filtered) and run a
 * callback. Used for live project status, chat and notifications.
 */
export function useRealtime(
  channelName: string,
  opts: {
    table: string;
    filter?: string;
    event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  },
  onChange: (payload: unknown) => void,
) {
  const cbRef = useRef(onChange);
  useEffect(() => {
    cbRef.current = onChange;
  });

  const { table, filter, event } = opts;

  useEffect(() => {
    const supabase = createClient();
    // supabase-js overloads for "postgres_changes" are awkward to satisfy
    // generically; the runtime contract is stable.
    const channel = (
      supabase.channel(channelName) as unknown as {
        on: (...args: unknown[]) => { subscribe: () => unknown };
      }
    ).on(
      "postgres_changes",
      { event: event ?? "*", schema: "public", table, filter },
      (payload: unknown) => cbRef.current(payload),
    );
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel as never);
    };
  }, [channelName, table, filter, event]);
}

/** Refresh the current route's server data when a table changes. */
export function useLiveRefresh(
  channelName: string,
  table: string,
  filter?: string,
) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtime(channelName, { table, filter }, refresh);
}

/**
 * Live unread-notification count. `initial` is the server snapshot; realtime
 * INSERTs bump a local delta on top of it, and callers can reset to zero.
 */
export function useUnreadCount(userId: string, initial: number) {
  const [count, setCount] = useState(initial);

  const bump = useCallback(() => setCount((c) => c + 1), []);
  useRealtime(
    `notif-${userId}`,
    { table: "notifications", filter: `user_id=eq.${userId}`, event: "INSERT" },
    bump,
  );

  return [count, setCount] as const;
}
