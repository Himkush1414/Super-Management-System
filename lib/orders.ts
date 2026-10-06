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

/** Most products one order can hold (create_order enforces the same). */
export const MAX_ORDER_ITEMS = 20;

/** The order's name everywhere a single line is needed: "TRANSFORMER +2 more". */
export function orderTitle(o: { product_name: string; items?: { product_name: string }[] }): string {
  const items = o.items ?? [];
  const first = items[0]?.product_name ?? o.product_name;
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
}

/** A product's value = price + FEAT; null when neither was given (or hidden). */
export function itemValue(i: { price: number | null; feat: number | null }): number | null {
  return i.price === null && i.feat === null ? null : (i.price ?? 0) + (i.feat ?? 0);
}

/** Total units across the order's products. */
export function totalQuantity(o: { quantity: number; items?: { quantity: number }[] }): number {
  return o.items?.length ? o.items.reduce((n, i) => n + i.quantity, 0) : o.quantity;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  waiting_on_production_phone: "Waiting on production phone number",
};
