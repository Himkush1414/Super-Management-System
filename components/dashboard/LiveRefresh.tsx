"use client";

import { useLiveRefresh } from "@/lib/realtime";

/** Drop-in: refreshes the server component tree when `table` changes. */
export function LiveRefresh({
  channel,
  table,
  filter,
}: {
  channel: string;
  table: string;
  filter?: string;
}) {
  useLiveRefresh(channel, table, filter);
  return null;
}
