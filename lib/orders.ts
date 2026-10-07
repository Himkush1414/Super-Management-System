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

/** GST on every product's price (never on the Additional Amount). */
export const GST_PERCENT = 18;

/**
 * 18% GST on a price, to the paisa, rounded half up — the same as the
 * database's gst_of(). Only the form's live preview uses this; stored orders
 * read their GST from the database.
 */
export function gstOf(price: number): number {
  return Math.round((Math.round(price * 100) * GST_PERCENT) / 100) / 100;
}

/** A product's total = price + GST; null when it has no price (or it's hidden). */
export function itemTotal(i: { price: number | null; gst: number | null }): number | null {
  return i.price === null ? null : i.price + (i.gst ?? 0);
}

/**
 * The order's money, in the order it is added up:
 *   products  = Σ(price + GST)          — "including 18% GST"
 *   additional = the Additional Amount   — "Additional Amount added"
 *   subtotal  = products + additional    (= order.price from the database)
 */
export function orderAmounts(o: {
  items: { price: number | null; gst: number | null }[];
  additional_amount: number | null;
}) {
  const totals = o.items.map(itemTotal).filter((v): v is number => v !== null);
  const products = totals.length ? round2(totals.reduce((a, b) => a + b, 0)) : null;
  const additional = o.additional_amount;
  const subtotal = products === null && additional === null ? null : round2((products ?? 0) + (additional ?? 0));
  return { products, additional, subtotal };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total units across the order's products. */
export function totalQuantity(o: { quantity: number; items?: { quantity: number }[] }): number {
  return o.items?.length ? o.items.reduce((n, i) => n + i.quantity, 0) : o.quantity;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  waiting_on_production_phone: "Waiting on production phone number",
};
