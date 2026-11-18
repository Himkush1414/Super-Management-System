import { isLow, parsePaise, parseQty, valueOf } from "@/lib/inventory/numbers";
import type { InvColumn, InvProductRow } from "@/lib/inventory/types";

/** A product with its figures parsed once (bigint thousandths / paise). */
export interface Row extends InvProductRow {
  o: bigint;
  r: bigint;
  i: bigint;
  b: bigint;
  ratePaise: bigint | null;
  value: bigint;
  /** minimum stock (thousandths), null = none */
  min: bigint | null;
  minText: string | null;
  lastParty: string | null;
  lastReceived: string | null;
  /** 0031: the month's stock count adjustment (thousandths) */
  a: bigint;
  /** 0031: balance not counted yet this month */
  pending: boolean;
}

const Z = BigInt(0);

/** Low: a minimum is set and the balance is below it (live: follows saves). Never while the balance is pending. */
export const rowLow = (r: Pick<Row, "is_active" | "b" | "min"> & { pending?: boolean }) => r.is_active && !r.pending && isLow(r.b, r.min);

export function toRow(
  p: InvProductRow,
  extra?: [string | null, string | null, string | null],
  month?: { adjustment: string; pending: boolean },
): Row {
  const o = parseQty(p.opening) ?? Z;
  const r = parseQty(p.received) ?? Z;
  const i = parseQty(p.issued) ?? Z;
  const b = parseQty(p.balance) ?? Z;
  const ratePaise = p.rate == null ? null : parsePaise(p.rate);
  const minText = extra?.[0] ?? null;
  return {
    ...p, o, r, i, b, ratePaise, value: valueOf(b, ratePaise),
    min: minText === null ? null : parseQty(minText), minText,
    lastParty: extra?.[1] ?? null, lastReceived: extra?.[2] ?? null,
    a: parseQty(month?.adjustment ?? p.adjustment ?? "0") ?? Z,
    pending: month?.pending ?? p.pending ?? false,
  };
}

/** The text a custom column shows for a row (dates as DD/MM/YYYY). */
export function customText(row: Pick<InvProductRow, "custom">, col: InvColumn): string {
  const v = row.custom?.[col.id] ?? "";
  if (col.data_type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return v;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-01" -> "November 2026" */
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "2026-11-01" -> "Nov" */
export const monthShort = (iso: string) => SHORT[Number(iso.slice(5, 7)) - 1];
