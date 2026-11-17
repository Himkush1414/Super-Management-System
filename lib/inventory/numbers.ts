/**
 * lib/inventory/numbers.ts — exact quantities and money for the Inventory
 * module. Never floating point:
 *   quantity -> bigint thousandths ("milli"), numeric(14,3) in the database
 *   rate     -> bigint paise, numeric(14,2)
 *   value    =  quantity × rate, rounded half up to the paisa
 * Formatting is en-IN (1,23,456.5 · ₹1,23,456.00).
 *
 * No imports: the unit tests load this file straight into node --test.
 * (BigInt() calls rather than `0n` literals: tsconfig targets ES2017.)
 */

export type Milli = bigint;
export type Paise = bigint;

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);
const HALF_THOUSAND = BigInt(500);

/** Largest quantity the database accepts: numeric(14,3) < 10^11. */
export const MAX_QTY: Milli = BigInt("100000000000000"); // 10^11 × 1000

/**
 * A decimal text (or number) with up to `scale` decimals to an integer of
 * that scale, exactly. Spaces and thousands commas are ignored ("1,250.5").
 * Returns null for empty or malformed input, or for too many decimals.
 */
function parseScaled(value: string | number | null | undefined, scale: number): bigint | null {
  if (value === null || value === undefined) return null;
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  text = text.replace(/[\s,]/g, "");
  if (/e/i.test(text)) return null;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const frac = m[3] ?? "";
  if (frac.length > scale) {
    // trailing zeros beyond the scale are harmless ("2.500" at scale 2)
    if (/[^0]/.test(frac.slice(scale))) return null;
  }
  const digits = (m[2] || "0") + frac.slice(0, scale).padEnd(scale, "0");
  const n = BigInt(digits);
  return m[1] ? -n : n;
}

/** "12.5" -> 12500n thousandths. null when empty / malformed / > 3 decimals. */
export function parseQty(value: string | number | null | undefined): Milli | null {
  return parseScaled(value, 3);
}

/** "3.5" -> 350n paise. null when empty / malformed / > 2 decimals. */
export function parsePaise(value: string | number | null | undefined): Paise | null {
  return parseScaled(value, 2);
}

/** Thousandths -> the exact decimal text the database takes ("12.5", "0.125", "-3"). */
export function qtyToText(q: Milli): string {
  const neg = q < ZERO;
  const a = neg ? -q : q;
  const int = a / THOUSAND;
  const frac = (a % THOUSAND).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int.toString()}${frac ? "." + frac : ""}`;
}

/** Paise -> decimal text with 2 decimals ("3.50"). */
export function paiseToText(p: Paise): string {
  const neg = p < ZERO;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${(a / HUNDRED).toString()}.${(a % HUNDRED).toString().padStart(2, "0")}`;
}

/** en-IN digit grouping of a non-negative integer: 123456 -> "1,23,456". */
function groupIN(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** Thousandths -> en-IN text, up to 3 decimals, no trailing zeros: 123456500n -> "1,23,456.5". */
export function formatQty(q: Milli | null | undefined): string {
  if (q === null || q === undefined) return "—";
  const neg = q < ZERO;
  const a = neg ? -q : q;
  const frac = (a % THOUSAND).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "−" : ""}${groupIN(a / THOUSAND)}${frac ? "." + frac : ""}`;
}

/** Paise -> "₹1,23,456.00" (always 2 decimals, en-IN grouping). */
export function formatINR(p: Paise | null | undefined): string {
  if (p === null || p === undefined) return "—";
  const neg = p < ZERO;
  const a = neg ? -p : p;
  return `${neg ? "−" : ""}₹${groupIN(a / HUNDRED)}.${(a % HUNDRED).toString().padStart(2, "0")}`;
}

/** Stock value: quantity × rate, rounded half up to the paisa. */
export function valueOf(q: Milli, rate: Paise | null): Paise {
  if (rate === null) return ZERO;
  const x = q * rate; // paise × thousandths
  return x >= ZERO ? (x + HALF_THOUSAND) / THOUSAND : -((-x + HALF_THOUSAND) / THOUSAND);
}

/** Sum of bigints. */
export function sum(values: Iterable<bigint>): bigint {
  let t = ZERO;
  for (const v of values) t += v;
  return t;
}

/** A quantity typed by the user, checked: > 0, at most 3 decimals, within range. */
export function checkQty(text: string): { ok: true; qty: Milli } | { ok: false; message: string } {
  const t = text.trim();
  if (!t) return { ok: false, message: "Enter a quantity." };
  const decimals = /\.(\d+)$/.exec(t.replace(/[\s,]/g, ""))?.[1]?.replace(/0+$/, "").length ?? 0;
  if (decimals > 3) return { ok: false, message: "Use at most 3 decimal places." };
  const q = parseQty(t);
  if (q === null) return { ok: false, message: "Enter a number, like 12 or 2.5." };
  if (q <= ZERO) return { ok: false, message: "Enter a quantity above 0." };
  if (q >= MAX_QTY) return { ok: false, message: "That quantity is too large." };
  return { ok: true, qty: q };
}
