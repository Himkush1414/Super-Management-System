/**
 * lib/inventory/ledger.ts — the Inventory rules as pure functions.
 *
 * The database (migration 0028) is the authority: it applies these same
 * rules inside one transaction under a row lock. This module mirrors them
 * so the screen can check an entry and show "balance before → after" before
 * anything is sent, and so the rules are unit-tested without a database.
 *
 *   balance(day)  = opening_qty + Σ delta of entries dated up to that day
 *   delta         = +qty receipt, −qty issue; a reversal flips its entry's sign
 *   opening(month)= balance before its first day = previous month's closing
 *   received / issued (month) = that month's sums (reversals net out of
 *                   their own column)
 *   an entry's date: in the current month, not in the future (IST)
 *   an issue may not exceed the balance; the same idempotency key records once
 *
 * Dates are "YYYY-MM-DD" strings (IST calendar days); quantities are bigint
 * thousandths (lib/inventory/numbers.ts). No imports: node --test loads it.
 */

export type Kind = "receive" | "issue";

export interface LedgerEntry {
  id: number;
  productId: string;
  kind: Kind;
  qty: bigint;
  date: string;
  reversesId: number | null;
  key: string;
}

export interface LedgerProduct {
  id: string;
  openingQty: bigint;
  /** first day of the month the product was added: "2026-11-01" */
  openingMonth: string;
  active: boolean;
}

export interface MonthFigures {
  opening: bigint;
  received: bigint;
  issued: bigint;
  closing: bigint;
}

export interface LedgerState {
  products: Map<string, LedgerProduct>;
  entries: LedgerEntry[];
  /** `${productId}|${month}` -> figures, for closed months */
  snapshots: Map<string, MonthFigures>;
  closedMonths: string[];
  nextId: number;
}

const ZERO = BigInt(0);

// ── dates ───────────────────────────────────────────────────────────────

/** "2026-11-17" -> "2026-11-01" */
export const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;

/** "2026-12-01" + n months */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

/** Last day of the month containing `day`. */
export function monthEnd(day: string): string {
  const next = addMonths(monthOf(day), 1);
  const d = new Date(`${next}T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Is `date` a valid entry date when today is `today`? (current month, not future) */
export function isEntryDateAllowed(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return false;
  return date <= today && date >= monthOf(today);
}

// ── figures ─────────────────────────────────────────────────────────────

/** Signed effect of an entry on the balance. */
export function delta(e: Pick<LedgerEntry, "kind" | "qty" | "reversesId">): bigint {
  const plus = (e.kind === "receive") === (e.reversesId === null);
  return plus ? e.qty : -e.qty;
}

const ofProduct = (entries: LedgerEntry[], productId: string) => entries.filter((e) => e.productId === productId);

/** Balance at the end of `upTo` (inclusive); every entry when omitted. */
export function balanceOf(p: LedgerProduct, entries: LedgerEntry[], upTo?: string): bigint {
  let b = p.openingQty;
  for (const e of ofProduct(entries, p.id)) if (upTo === undefined || e.date <= upTo) b += delta(e);
  return b;
}

/** Opening (balance before `from`), received / issued inside [from, to], closing at `to`. */
export function rangeFigures(p: LedgerProduct, entries: LedgerEntry[], from: string, to: string): MonthFigures {
  let before = ZERO;
  let received = ZERO;
  let issued = ZERO;
  for (const e of ofProduct(entries, p.id)) {
    if (e.date < from) before += delta(e);
    else if (e.date <= to) {
      if (e.kind === "receive") received += delta(e);
      else issued -= delta(e);
    }
  }
  const opening = p.openingQty + before;
  return { opening, received, issued, closing: opening + received - issued };
}

/** A calendar month's figures, from the ledger. */
export function monthFigures(p: LedgerProduct, entries: LedgerEntry[], month: string): MonthFigures {
  return rangeFigures(p, entries, month, monthEnd(month));
}

// ── writes ──────────────────────────────────────────────────────────────

export type WriteResult =
  | { status: "ok"; id: number; before: bigint; after: bigint }
  | { status: "duplicate"; id: number; after: bigint }
  | { status: "insufficient"; balance: bigint }
  | { status: "invalid"; message: string }
  | { status: "not_found" | "archived" };

export function emptyState(): LedgerState {
  return { products: new Map(), entries: [], snapshots: new Map(), closedMonths: [], nextId: 1 };
}

export function addProduct(s: LedgerState, p: Omit<LedgerProduct, "active">, today: string): LedgerProduct {
  const product = { ...p, openingMonth: monthOf(today), active: true };
  s.products.set(p.id, product);
  return product;
}

/** Record a receipt or an issue (inv_record_transaction). */
export function record(
  s: LedgerState,
  input: { productId: string; kind: Kind; qty: bigint; date: string; key: string },
  today: string,
): WriteResult {
  const p = s.products.get(input.productId);
  if (!p) return { status: "not_found" };
  const dup = s.entries.find((e) => e.key === input.key);
  if (dup) return { status: "duplicate", id: dup.id, after: balanceOf(p, s.entries) };
  if (!p.active) return { status: "archived" };
  if (input.qty <= ZERO) return { status: "invalid", message: "Enter a quantity above 0." };
  if (!isEntryDateAllowed(input.date, today)) {
    return { status: "invalid", message: "The date must be in the current month and not in the future." };
  }
  const before = balanceOf(p, s.entries);
  if (input.kind === "issue" && input.qty > before) return { status: "insufficient", balance: before };
  const id = s.nextId++;
  s.entries.push({ id, productId: p.id, kind: input.kind, qty: input.qty, date: input.date, reversesId: null, key: input.key });
  return { status: "ok", id, before, after: before + (input.kind === "receive" ? input.qty : -input.qty) };
}

/** Reverse an entry of this month (inv_reverse_transaction). */
export function reverse(s: LedgerState, entryId: number, key: string, today: string): WriteResult {
  const orig = s.entries.find((e) => e.id === entryId);
  if (!orig) return { status: "not_found" };
  const p = s.products.get(orig.productId)!;
  const dup = s.entries.find((e) => e.key === key);
  if (dup) return { status: "duplicate", id: dup.id, after: balanceOf(p, s.entries) };
  if (!p.active) return { status: "archived" };
  if (orig.reversesId !== null) return { status: "invalid", message: "A reversal cannot be reversed." };
  if (s.entries.some((e) => e.reversesId === orig.id)) return { status: "invalid", message: "This entry has already been reversed." };
  if (orig.date < monthOf(today)) return { status: "invalid", message: "Only entries from this month can be reversed." };
  const before = balanceOf(p, s.entries);
  const after = before - delta(orig);
  if (after < ZERO) return { status: "insufficient", balance: before };
  const id = s.nextId++;
  s.entries.push({ id, productId: p.id, kind: orig.kind, qty: orig.qty, date: today, reversesId: orig.id, key });
  return { status: "ok", id, before, after };
}

// ── month rollover ──────────────────────────────────────────────────────

/**
 * Close every ended month not closed yet, oldest first (inv_rollover):
 * one snapshot per product that existed in it. Idempotent. Returns the
 * months it closed.
 */
export function rollover(s: LedgerState, today: string): string[] {
  const cur = monthOf(today);
  const last = s.closedMonths.length ? s.closedMonths[s.closedMonths.length - 1] : null;
  const firstProductMonth = [...s.products.values()].map((p) => p.openingMonth).sort()[0];
  let m = last ? addMonths(last, 1) : firstProductMonth;
  const closed: string[] = [];
  while (m && m < cur) {
    for (const p of s.products.values()) {
      if (p.openingMonth > m) continue;
      const k = `${p.id}|${m}`;
      if (!s.snapshots.has(k)) s.snapshots.set(k, monthFigures(p, s.entries, m));
    }
    s.closedMonths.push(m);
    closed.push(m);
    m = addMonths(m, 1);
  }
  return closed;
}

/** This month's figures for a product: opening = last month's closing. */
export function currentFigures(s: LedgerState, productId: string, today: string): MonthFigures {
  const p = s.products.get(productId)!;
  return rangeFigures(p, s.entries, monthOf(today), today);
}
