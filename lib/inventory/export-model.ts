import { parsePaise, parseQty, summarize, valueOf, formatQty, formatINR } from "@/lib/inventory/numbers";
import { exportFileName } from "@/lib/inventory/ranges";
import { visibleCustomColumns, type InvColumn, type InvRangeReport } from "@/lib/inventory/types";

/** One export row, figures exact (bigint thousandths / paise). */
export interface ExportRow {
  serial: string;
  description: string;
  specification: string;
  archived: boolean;
  rate: bigint | null;
  opening: bigint;
  received: bigint;
  issued: bigint;
  closing: bigint;
  value: bigint;
  custom: string[];
}

export interface ExportModel {
  title: string;
  from: string;
  to: string;
  rangeLabel: string;
  generatedAt: Date;
  person: string | null;
  customColumns: InvColumn[];
  rows: ExportRow[];
  totals: { received: bigint; issued: bigint; value: bigint };
}

const Z = BigInt(0);

function customText(v: string | undefined, col: InvColumn): string {
  if (!v) return "";
  if (col.data_type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return v;
}

/** The range report as rows for the PDF and the Word file. */
export function buildExportModel(report: InvRangeReport, rangeLabel: string, generatedAt: Date): ExportModel {
  const customColumns = visibleCustomColumns(report.columns);
  const rows = report.products.map((p): ExportRow => {
    const rate = p.rate == null ? null : parsePaise(p.rate);
    const closing = parseQty(p.balance) ?? Z;
    return {
      serial: p.serial_no,
      description: p.description,
      specification: p.specification,
      archived: !p.is_active,
      rate,
      opening: parseQty(p.opening) ?? Z,
      received: parseQty(p.received) ?? Z,
      issued: parseQty(p.issued) ?? Z,
      closing,
      value: valueOf(closing, rate),
      custom: customColumns.map((c) => customText(p.custom?.[c.id], c)),
    };
  });
  // the same summary as the Inventory page: closing value counts active products only
  const s = summarize(rows.map((x) => ({ is_active: !x.archived, r: x.received, i: x.issued, b: x.closing, ratePaise: x.rate })));
  return {
    title: exportFileName(report.from, report.to, "pdf").replace(/\.pdf$/, ""),
    from: report.from,
    to: report.to,
    rangeLabel,
    generatedAt,
    person: report.settings?.person_name?.trim() || null,
    customColumns,
    rows,
    totals: { received: s.received, issued: s.issued, value: s.value },
  };
}

/** Plain-text cells for a table export (Word), in column order. */
export function textTable(model: ExportModel): { head: string[]; right: boolean[]; rows: string[][] } {
  const head = ["Serial No", "Material Description", "Specification", "Rate", "Opening", "Received", "Issued", "Closing", "Closing value", ...model.customColumns.map((c) => c.label)];
  const right = head.map((_, i) => i >= 3 && i <= 8);
  const rows = model.rows.map((r) => [
    r.serial,
    r.archived ? `${r.description} (archived)` : r.description,
    r.specification || "—",
    r.rate === null ? "—" : formatINR(r.rate),
    formatQty(r.opening),
    formatQty(r.received),
    formatQty(r.issued),
    formatQty(r.closing),
    formatINR(r.value),
    ...r.custom,
  ]);
  return { head, right, rows };
}
