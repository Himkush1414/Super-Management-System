/**
 * lib/orders.ts — the 5-stage order tracker (spec §6).
 * Stored on `orders.stage` as 1..5; names are fixed.
 */

export const STAGES = [
  { n: 1, name: "Starting" },
  { n: 2, name: "Midway through production" },
  { n: 3, name: "End of production" },
  { n: 4, name: "Dispatched" },
  { n: 5, name: "Delivered" },
] as const;

export const MAX_STAGE = 5;

/** How long production must wait after a stage change before advancing again. */
export const STAGE_TIMER_MS = 3 * 60 * 1000;

export function stageName(n: number): string {
  return STAGES.find((s) => s.n === n)?.name ?? `Stage ${n}`;
}

export function stageLabel(n: number): string {
  return `Stage ${n} — ${stageName(n)}`;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  waiting_on_production_phone: "Waiting on production phone number",
};
