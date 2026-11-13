/**
 * One place that decides when the current route re-reads its server data
 * (router.refresh()), so triggers that fire together cost one refresh.
 *
 * Two kinds of trigger:
 *  - a change: realtime saw a row change, or a live channel rejoined after
 *    it was lost (changes made meanwhile are never replayed). These always
 *    refresh; the caller already batches its own bursts.
 *  - "may be old": the tab was shown again, the Android app came back to
 *    the foreground, a cached page came back on screen. These are dropped
 *    when a refresh ran in the last SETTLE_MS, and wait for a live channel
 *    that is rejoining, whose own refresh (above) covers them.
 *
 * Measured before this (Android app back after 90 s on Orders): three
 * refreshes in 1.6 s, from the tab becoming visible, the app's resume
 * signal and the channel rejoining.
 */

type Router = { refresh(): void };

/** A "may be old" refresh within this of another refresh is dropped. */
export const SETTLE_MS = 2000;
/** Waiting for a rejoining channel gives up after this and refreshes anyway. */
export const REJOIN_WAIT_MS = 5000;

// wall clock: a jump can only let one extra refresh through or drop one
const clock = () => Date.now();

let lastRefreshAt = Number.NEGATIVE_INFINITY;
let rejoining = 0;
let waiting: { router: Router; timer: ReturnType<typeof setTimeout> } | null = null;

function run(router: Router) {
  if (waiting) {
    clearTimeout(waiting.timer);
    waiting = null;
  }
  lastRefreshAt = clock();
  router.refresh();
}

/** A known change (or a channel back after a loss): refresh now. */
export function refreshForChange(router: Router) {
  run(router);
}

/**
 * The data may be old. Returns what happened, for tests and logs:
 * "refreshed", "dropped" (a refresh just ran) or "waiting" (for a channel).
 */
export function refreshIfStale(router: Router): "refreshed" | "dropped" | "waiting" {
  if (clock() - lastRefreshAt < SETTLE_MS) return "dropped";
  if (rejoining > 0) {
    if (!waiting) {
      waiting = { router, timer: setTimeout(() => run(router), REJOIN_WAIT_MS) };
    }
    return "waiting";
  }
  run(router);
  return "refreshed";
}

/**
 * A live channel that had joined was lost (`true`) or is back (`false`).
 * While one is rejoining, "may be old" refreshes wait for it.
 */
export function channelRejoining(lost: boolean) {
  rejoining = Math.max(0, rejoining + (lost ? 1 : -1));
}

/** Running inside the Android app, which reports resumes itself (mobile/src/injected.js). */
export function inAndroidApp(): boolean {
  return typeof window !== "undefined" && typeof (window as { __nrApp?: unknown }).__nrApp === "object";
}

/** tests only */
export function resetRefreshState() {
  if (waiting) clearTimeout(waiting.timer);
  waiting = null;
  lastRefreshAt = Number.NEGATIVE_INFINITY;
  rejoining = 0;
}
