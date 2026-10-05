"use client";

import { useLiveRefresh, type LiveTable } from "@/lib/realtime";

/** Drop-in: refreshes the server component tree when any of `tables` changes. */
export function LiveRefresh({ channel, tables }: { channel: string; tables: LiveTable[] }) {
  useLiveRefresh(channel, tables);
  return null;
}
