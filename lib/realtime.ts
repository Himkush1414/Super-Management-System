"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { channelRejoining, inAndroidApp, refreshForChange, refreshIfStale } from "@/lib/refresh";

type Binding = {
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  table: string;
  filter?: string;
  cb: (payload: unknown) => void;
};
type Status = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";
type Chan = { on: (...args: unknown[]) => Chan; subscribe: (cb?: (status: Status) => void) => unknown };

/**
 * Join a realtime channel AS THE SIGNED-IN USER.
 *
 * On a fresh page load the browser client reads its session from cookies
 * asynchronously; subscribing straight away joins the channel with the anon
 * key, so RLS (correctly) delivers nothing — the notification bell and the
 * production list then silently never updated after a hard reload, and the
 * anon join on `orders` made the Realtime server log "permission denied for
 * table orders". So: load the session, hand its token to Realtime, then join.
 *
 * `onResync` runs when the channel has joined again after it was lost (the
 * connection dropped, the laptop slept, the server restarted). Realtime
 * doesn't replay what changed meanwhile, so the caller re-reads instead.
 * While such a channel is rejoining, lib/refresh.ts holds back other
 * refreshes for it. Returns a cleanup function.
 */
function subscribeAsUser(channelName: string, bindings: Binding[], onResync?: () => void): () => void {
  const supabase = createClient();
  let channel: Chan | null = null;
  let cancelled = false;
  let joined = false;
  let lost = false;

  void supabase.auth.getSession().then(({ data: { session } }) => {
    if (cancelled || !session) return;
    supabase.realtime.setAuth(session.access_token);
    // supabase-js overloads for "postgres_changes" are awkward to satisfy
    // generically; the runtime contract is stable.
    let ch = supabase.channel(channelName) as unknown as Chan;
    for (const b of bindings) {
      ch = ch.on(
        "postgres_changes",
        { event: b.event ?? "*", schema: "public", table: b.table, filter: b.filter },
        b.cb,
      );
    }
    ch.subscribe((status) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") {
        if (joined && lost) {
          if (onResync) channelRejoining(false);
          onResync?.();
        }
        joined = true;
        lost = false;
      } else if (!lost) {
        // TIMED_OUT, CLOSED, CHANNEL_ERROR: the client rejoins by itself
        lost = true;
        if (joined && onResync) channelRejoining(true);
      }
    });
    channel = ch;
  });

  return () => {
    cancelled = true;
    if (joined && lost && onResync) channelRejoining(false);
    if (channel) supabase.removeChannel(channel as never);
  };
}

/**
 * Subscribe to Postgres changes on a table (optionally filtered) and run a
 * callback. Used for the live unread-notification count.
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

  useEffect(
    () =>
      subscribeAsUser(channelName, [
        { event, table, filter, cb: (payload) => cbRef.current(payload) },
      ]),
    [channelName, table, filter, event],
  );
}

export type LiveTable = { table: string; filter?: string };

/** A tab hidden longer than this refreshes once when it is shown again. */
const HIDDEN_REFRESH_MS = 60_000;

/**
 * Refresh the current route's server data when any of `tables` changes.
 *
 * One channel for all tables, and bursts are coalesced: a single stage
 * advance emits an orders UPDATE *and* an order_stage_events INSERT, which
 * used to trigger two full route refreshes back to back (each one also
 * invalidating and re-running every link prefetch on the page). Now they
 * collapse into one refresh, and a hidden tab defers its refresh until it is
 * visible again. Refreshes go through lib/refresh.ts, which merges them
 * with the other refresh triggers on the page.
 */
export function useLiveRefresh(channelName: string, tables: LiveTable[], debounceMs = 400) {
  // Also refreshed: after the live connection comes back (changes made while
  // it was down are never replayed), and when a tab that was hidden for a
  // while is shown again (a sleeping laptop may not notice the drop at
  // once). Every viewer refreshes after the same change, so each waits a
  // random extra 0-600 ms: the refreshes reach the server spread out.
  const router = useRouter();
  const key = JSON.stringify(tables);

  useEffect(() => {
    const subs = JSON.parse(key) as LiveTable[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;

    const flush = () => {
      if (document.hidden) {
        dirty = true;
        return;
      }
      dirty = false;
      refreshForChange(router);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, debounceMs + Math.floor(Math.random() * 600));
    };
    let hiddenAt = document.hidden ? Date.now() : 0;
    const onVisible = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (dirty) flush();
      // The Android app reports its own return to the foreground a moment
      // later (nr-app-resume, after its connection check), so it decides there.
      else if (away > HIDDEN_REFRESH_MS && !inAndroidApp()) refreshIfStale(router);
    };

    const unsubscribe = subscribeAsUser(
      channelName,
      subs.map((t) => ({ table: t.table, filter: t.filter, cb: schedule })),
      schedule,
    );
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [channelName, key, debounceMs, router]);
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
