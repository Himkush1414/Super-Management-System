/** Shapes returned by the inventory RPCs (migration 0028). Numbers arrive as decimal text. */

export type ColumnType = "text" | "number" | "date";

export interface InvColumn {
  id: string;
  /** set on the 8 default columns */
  key: "serial_no" | "description" | "specification" | "rate" | "opening" | "receiving" | "issue" | "balance" | null;
  label: string;
  data_type: ColumnType;
  position: number;
  is_default: boolean;
  visible: boolean;
  archived: boolean;
}

export interface InvProductRow {
  id: string;
  serial_no: string;
  description: string;
  specification: string;
  rate: string | null;
  custom: Record<string, string>;
  is_active: boolean;
  created_at?: string;
  opening: string;
  received: string;
  issued: string;
  balance: string;
  /** 0031: the stock count adjustment inside the range / month ("0" when none) */
  adjustment?: string;
  /** 0031: balance not counted yet this month (the figures are not confirmed) */
  pending?: boolean;
}

export interface InvSettings {
  person_name: string;
  phone: string;
}

export interface InvOverview {
  today: string;
  current_month: string;
  month: string;
  is_current: boolean;
  columns: InvColumn[];
  settings: InvSettings | null;
  /** closed months, newest first */
  months: string[];
  products: InvProductRow[];
  trend: { month: string; received: string; issued: string }[];
  top_issued: { id: string; serial_no: string; description: string; specification: string; issued: string }[];
}

export interface InvHistoryEntry {
  id: number;
  kind: "receive" | "issue";
  qty: string;
  delta: string;
  entry_date: string;
  note: string | null;
  source: "app" | "import";
  created_at: string;
  reverses_id: number | null;
  reversed_by: number | null;
  reversible: boolean;
  by: string | null;
}

/** A stock count (0031): the balance the store person counted. adjustment = counted − balance before. */
export interface InvStockCount {
  id: number;
  month: string;
  entry_date: string;
  counted: string;
  balance_before: string;
  adjustment: string;
  source: "app" | "import";
  note: string | null;
  created_at: string;
  by: string | null;
}

export interface InvHistory {
  entries: InvHistoryEntry[];
  /** entry id -> its details (0030; entries without details are absent) */
  details?: Record<string, InvEntryDetails>;
  /** 0031: newest first */
  counts?: InvStockCount[];
  /** closed months; 0031 adds the adjustment and whether the balance was counted */
  months: { month: string; opening: string; adjustment?: string; received: string; issued: string; closing: string; confirmed?: boolean }[];
  changes: { action: string; created_at: string }[];
}

export interface InvRangeReport {
  from: string;
  to: string;
  /** 0031 */
  current_month?: string;
  columns: InvColumn[];
  settings: InvSettings | null;
  products: InvProductRow[];
}

/** Result of every write RPC. */
export interface InvWriteResult {
  status: "ok" | "duplicate" | "insufficient" | "invalid" | "not_found" | "archived" | "pending";
  id?: string | number;
  message?: string;
  balance?: string;
  balance_before?: string;
  balance_after?: string;
  archived?: boolean;
}

/** The custom columns to show, in order (active + visible). */
export function visibleCustomColumns(columns: InvColumn[]): InvColumn[] {
  return columns.filter((c) => !c.is_default && !c.archived && c.visible).sort((a, b) => a.position - b.position);
}

/** Active custom columns (visible or not), in order — for forms. */
export function activeCustomColumns(columns: InvColumn[]): InvColumn[] {
  return columns.filter((c) => !c.is_default && !c.archived).sort((a, b) => a.position - b.position);
}

/** inv_page (0029): the same data as InvOverview, products as arrays in `fields` order. */
export interface InvPage extends Omit<InvOverview, "products" | "trend" | "top_issued"> {
  ledger_seq: number;
  fields: string[];
  rows: unknown[][];
  trend: InvOverview["trend"] | null;
  top_issued: InvOverview["top_issued"] | null;
}

/** inv_page rows -> product objects (pure; tested). */
export function pageProducts(page: Pick<InvPage, "fields" | "rows">): InvProductRow[] {
  const at = (name: string) => page.fields.indexOf(name);
  const i = {
    id: at("id"), serial_no: at("serial_no"), description: at("description"), specification: at("specification"),
    rate: at("rate"), custom: at("custom"), is_active: at("is_active"), opening: at("opening"),
    received: at("received"), issued: at("issued"), balance: at("balance"),
  };
  return page.rows.map((r) => ({
    id: r[i.id] as string,
    serial_no: r[i.serial_no] as string,
    description: (r[i.description] as string) ?? "",
    specification: (r[i.specification] as string) ?? "",
    rate: (r[i.rate] as string | null) ?? null,
    custom: (r[i.custom] as Record<string, string>) ?? {},
    is_active: r[i.is_active] as boolean,
    opening: r[i.opening] as string,
    received: r[i.received] as string,
    issued: r[i.issued] as string,
    balance: r[i.balance] as string,
  }));
}

/** inv_page2 (0030): inv_page's data with three more fields per row (min_stock, last_party, last_received), the low count and party names. */
export interface InvPage2 extends InvPage {
  low_count: number;
  parties: string[];
}

/** The three 0030 fields of each row, by product id (pure; tested). */
export function pageExtras(page: Pick<InvPage, "fields" | "rows">): Map<string, [string | null, string | null, string | null]> {
  const id = page.fields.indexOf("id");
  const m = page.fields.indexOf("min_stock");
  const p = page.fields.indexOf("last_party");
  const d = page.fields.indexOf("last_received");
  const out = new Map<string, [string | null, string | null, string | null]>();
  if (m < 0) return out;
  for (const r of page.rows) out.set(r[id] as string, [(r[m] as string | null) ?? null, p < 0 ? null : ((r[p] as string | null) ?? null), d < 0 ? null : ((r[d] as string | null) ?? null)]);
  return out;
}

/** An entry's details (0030): only the ones that were filled in. */
export interface InvEntryDetails {
  party?: string;
  challan_no?: string;
  bill_no?: string;
  bill_date?: string;
  job_no?: string;
  rating?: string;
  no_of_jobs?: string;
}

/**
 * inv_page3 (0031): inv_page2 with two more fields per row (adjustment,
 * pending), the counts beside the totals, and the stock-count sequence.
 */
export interface InvPage3 extends InvPage2 {
  /** first month month-start counting applies ("infinity" = not set) */
  counts_from: string;
  count_seq: number;
  active_count: number;
  pending_count: number;
}

/** The two 0031 fields of each row, by product id (pure; tested). Absent fields read as "0" / false. */
export function pageMonthFields(page: Pick<InvPage, "fields" | "rows">): Map<string, { adjustment: string; pending: boolean }> {
  const id = page.fields.indexOf("id");
  const a = page.fields.indexOf("adjustment");
  const p = page.fields.indexOf("pending");
  const out = new Map<string, { adjustment: string; pending: boolean }>();
  if (a < 0 && p < 0) return out;
  for (const r of page.rows) {
    out.set(r[id] as string, { adjustment: a < 0 ? "0" : ((r[a] as string | null) ?? "0"), pending: p < 0 ? false : r[p] === true });
  }
  return out;
}

/** Month-start counting applies in `month` (counts_from "infinity" = never). */
export function countingApplies(countsFrom: string | null | undefined, month: string): boolean {
  return Boolean(countsFrom) && /^\d{4}-\d{2}-\d{2}$/.test(countsFrom!) && month >= countsFrom!;
}
