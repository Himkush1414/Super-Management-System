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

export interface InvHistory {
  entries: InvHistoryEntry[];
  months: { month: string; opening: string; received: string; issued: string; closing: string }[];
  changes: { action: string; created_at: string }[];
}

export interface InvRangeReport {
  from: string;
  to: string;
  columns: InvColumn[];
  settings: InvSettings | null;
  products: InvProductRow[];
}

/** Result of every write RPC. */
export interface InvWriteResult {
  status: "ok" | "duplicate" | "insufficient" | "invalid" | "not_found" | "archived";
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
