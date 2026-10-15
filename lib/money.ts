/**
 * lib/money.ts — the ONE place an order's money is added up. The order page,
 * both order PDFs, the orders list, the CSV, the account archive, the
 * activity log and the punch form all call it; nothing else repeats the
 * formula.
 *
 * Every product is its own row with its own 18% GST:
 *   row base  = unit price × quantity + that row's Additional Amount
 *   row GST   = row base × 18%, rounded half up to the paisa
 *   row total = row base + row GST
 * An order's Additional Amount sits on its FIRST product row (other rows 0).
 * Orders punched before 0021 have per-product FEAT amounts instead; each
 * stays on its own product's row. Either way the rows' amounts add up to
 * exactly the order's Additional Amount — never counted twice, never dropped.
 *
 *   subtotal    = Σ row bases
 *   GST         = Σ row GST      (NOT 18% of the subtotal: keeps rounding exact)
 *   grand total = Σ row totals   = subtotal + GST
 * Several orders (combined PDF): the orders' figures summed, so the printed
 * rows always add up to the printed totals, to the paisa.
 *
 * All arithmetic is in integer paise (bigint) — never floating-point rupees.
 * Values are only computed here, at render time; nothing is written back.
 * (BigInt() calls rather than `0n` literals: tsconfig targets ES2017.)
 */

/** GST percentage on every product row. */
export const GST_RATE = 18;

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/** An amount in paise; `null` = no amount (not entered, or hidden from this viewer). */
export type Paise = bigint;

/**
 * Rupees (a number or numeric string from the database, at most 2 decimals)
 * to paise, exactly: "33333.33" → 3333333. Parsed as text, so 0.1 + 0.2
 * style float error can't creep in.
 */
export function toPaise(value: number | string | null | undefined): Paise | null {
  if (value === null || value === undefined || value === "") return null;
  // numbers are at most 2 decimals (numeric(14,2)); toFixed(2) gives their exact text
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) throw new Error(`Not a rupee amount: ${text}`);
  const paise = BigInt(m[2]) * HUNDRED + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -paise : paise;
}

/** GST on an amount: × GST_RATE / 100, rounded half up to the paisa. */
export function gstOn(amount: Paise): Paise {
  const x = amount * BigInt(GST_RATE);
  // half up (amounts are never negative; mirror for safety)
  return x >= ZERO ? (x + BigInt(50)) / HUNDRED : -((-x + BigInt(50)) / HUNDRED);
}

/** One product row's money. */
export type RowMoney = {
  /** price of ONE product (null when not entered / hidden) */
  unit: Paise | null;
  /** this row's share of the Additional Amount: 0 when none — never null */
  additional: Paise;
  /** unit × qty + additional; null when the row has no amount at all */
  base: Paise | null;
  gst: Paise | null;
  /** base + GST — the "Total (incl. 18% GST)" cell */
  total: Paise | null;
};

/** A row's base, GST and total. `quantity` must be a whole number. */
export function rowMoney(unit: Paise | null, quantity: number, additional: Paise = ZERO): RowMoney {
  if (unit === null && additional === ZERO) return { unit, additional, base: null, gst: null, total: null };
  const base = (unit === null ? ZERO : unit * BigInt(quantity)) + additional;
  const gst = gstOn(base);
  return { unit, additional, base, gst, total: base + gst };
}

type Totals = { subtotal: Paise | null; gst: Paise | null; grandTotal: Paise | null };

export type OrderMoney = Totals & {
  /** per product, in order */
  rows: RowMoney[];
  /** the order's whole Additional Amount (= Σ rows' additional), 0 when none */
  additional: Paise;
};

/** Sums of rows / orders; all null when none of them has an amount. */
function sumTotals(parts: { base: Paise | null; gst: Paise | null; total: Paise | null }[]): Totals {
  const priced = parts.filter((p) => p.base !== null);
  if (priced.length === 0) return { subtotal: null, gst: null, grandTotal: null };
  const sum = (k: "base" | "gst" | "total") => priced.reduce((n, p) => n + (p[k] ?? ZERO), ZERO);
  return { subtotal: sum("base"), gst: sum("gst"), grandTotal: sum("total") };
}

/**
 * Each product's share of the order's Additional Amount (`additional_amount`
 * — for orders before 0021 the database already reads it as Σ FEAT). When
 * the products carry FEAT amounts that add up to it, each keeps its own;
 * otherwise the whole amount goes on the first product.
 */
function additionalShares(
  items: { feat?: number | string | null }[],
  additional: Paise | null,
): Paise[] {
  const shares = items.map(() => ZERO);
  if (additional === null || items.length === 0) return shares;
  const feats = items.map((i) => toPaise(i.feat));
  if (feats.some((f) => f !== null) && feats.reduce<Paise>((n, f) => n + (f ?? ZERO), ZERO) === additional) {
    return feats.map((f) => f ?? ZERO);
  }
  shares[0] = additional;
  return shares;
}

/**
 * One order's money. `price` on each item is the UNIT price; `feat` is the
 * pre-0021 per-product amount (only on older orders).
 */
export function orderMoney(o: {
  items: { quantity: number; price: number | string | null; feat?: number | string | null }[];
  additional_amount: number | string | null;
}): OrderMoney {
  const additional = toPaise(o.additional_amount);
  const shares = additionalShares(o.items, additional);
  const rows = o.items.map((i, k) => rowMoney(toPaise(i.price), i.quantity, shares[k]));
  return { rows, additional: additional ?? ZERO, ...sumTotals(rows) };
}

/** Several orders: their subtotals / GST / grand totals, summed. */
export function sumMoney(orders: OrderMoney[]): Totals {
  return sumTotals(orders.map((m) => ({ base: m.subtotal, gst: m.gst, total: m.grandTotal })));
}

/** A plain amount for the CSV, no grouping or symbol: "1180000.00" (or null). */
export function plainAmount(paise: Paise | null): string | null {
  if (paise === null) return null;
  const abs = paise < ZERO ? -paise : paise;
  return `${paise < ZERO ? "-" : ""}${abs / HUNDRED}.${String(abs % HUNDRED).padStart(2, "0")}`;
}

const groupFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Indian digit grouping, always 2 decimals, no symbol: "11,80,000.00" (or "—"). */
export function formatAmount(paise: Paise | null): string {
  if (paise === null) return "—";
  const neg = paise < ZERO;
  const abs = neg ? -paise : paise;
  const rupees = groupFmt.format(abs / HUNDRED);
  const p = String(abs % HUNDRED).padStart(2, "0");
  return `${neg ? "-" : ""}${rupees}.${p}`;
}

/** "₹11,80,000.00" (or "—"). */
export function formatINR(paise: Paise | null): string {
  return paise === null ? "—" : `₹${formatAmount(paise)}`;
}
