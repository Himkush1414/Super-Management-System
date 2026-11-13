"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** stamp -> when this tab first showed that render (performance.now()) */
const shown = new Map<string, number>();
const KEEP = 50;
/** A render shown again within this is fresh enough to leave alone. */
const FRESH_MS = 5000;

/**
 * Stale-while-revalidate for a dashboard page.
 *
 * The router keeps a visited page for a while (next.config.ts
 * staleTimes.dynamic), so going back to a tab shows it at once instead of a
 * skeleton. That copy may be a few seconds old, so when a render the tab has
 * already shown comes back on screen, the page reads its data again in the
 * background: the old data stays visible until the new data replaces it.
 * A render the server just made is new to the tab and is left alone, so a
 * normal page switch costs no extra request.
 *
 * `stamp` comes from renderStamp() in the page's server component.
 */
export function RefreshOnRevisit({ stamp }: { stamp: string }) {
  const router = useRouter();
  useEffect(() => {
    const first = shown.get(stamp);
    const now = performance.now();
    if (first === undefined) {
      shown.set(stamp, now);
      // oldest first (insertion order): forget the ones no cache still holds
      for (const k of shown.keys()) {
        if (shown.size <= KEEP) break;
        shown.delete(k);
      }
      return;
    }
    if (now - first >= FRESH_MS) router.refresh();
  }, [stamp, router]);
  return null;
}
