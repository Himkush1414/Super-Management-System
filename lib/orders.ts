/**
 * lib/orders.ts — the 5-stage order tracker (spec §6).
 * Stored on `orders.stage` as the NUMBER 1..5; the database
 * (advance_order_stage, 0015) only ever works with the number. These names are
 * display labels only — renaming them changes no progression rule.
 */

export const STAGES = [
  { n: 1, name: "Start" },
  { n: 2, name: "Mid" },
  { n: 3, name: "Testing" },
  { n: 4, name: "End of Production" },
  { n: 5, name: "Dispatch and Deliver" },
] as const;

export const MAX_STAGE = 5;

/** How long production must wait after a stage change before advancing again. */
export const STAGE_TIMER_MS = 3 * 60 * 1000;

export function stageName(n: number): string {
  return STAGES.find((s) => s.n === n)?.name ?? `Stage ${n}`;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  waiting_on_production_phone: "Waiting on production phone number",
};
