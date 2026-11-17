import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PdfHeader, COMPANY } from "@/lib/pdf/Chrome";
import { C } from "@/lib/pdf/theme";
import { Rupees } from "@/lib/pdf/Rupees";
import { formatQty } from "@/lib/inventory/numbers";
import { dmySlash } from "@/lib/inventory/ranges";
import type { ExportRow, ExportModel } from "@/lib/inventory/export-model";

/**
 * "NR Industries Product Specification" — A4 landscape. Reuses the order
 * PDFs' letterhead (logo, address, title, generated time) and print-first
 * theme without changing them. The letterhead and the column header repeat
 * on every page; the footer carries "Page X of Y".
 *
 * The page style here has no lineHeight on purpose: react-pdf doesn't draw
 * `render` text (the page numbers) under a page-level lineHeight.
 */

const PAGE_W = 841.89;
const MARGIN = 30;
const INNER = PAGE_W - MARGIN * 2;

const s = StyleSheet.create({
  page: {
    paddingTop: 26,
    paddingBottom: 44,
    paddingHorizontal: MARGIN,
    fontSize: 8,
    color: C.body,
    fontFamily: "Helvetica-Bold",
  },
  summary: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8, fontSize: 8.5 },
  summaryItem: { marginRight: 18, marginBottom: 2 },
  label: { color: C.navy },
  row: { flexDirection: "row" },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRight: `0.75 solid ${C.rule}`,
    borderBottom: `0.75 solid ${C.rule}`,
    fontSize: 7.6,
    lineHeight: 1.25,
    color: C.ink,
  },
  first: { borderLeft: `0.75 solid ${C.rule}` },
  head: { backgroundColor: C.head, fontSize: 7, color: C.navy, borderTop: `0.75 solid ${C.rule}` },
  zebra: { backgroundColor: C.zebra },
  right: { textAlign: "right" },
  totals: { flexDirection: "row", marginTop: 8, justifyContent: "flex-end", fontSize: 8.5 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: MARGIN,
    right: MARGIN,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: `0.75 solid ${C.rule}`,
    paddingTop: 5,
    fontSize: 7.5,
  },
  empty: { marginTop: 20, textAlign: "center", fontSize: 9 },
});

type Col = { key: string; label: string; width: number; align?: "right"; cell: (r: ExportRow) => React.ReactNode };

function columns(model: ExportModel): Col[] {
  const custom = model.customColumns;
  const customW = custom.length ? Math.max(42, Math.min(64, 190 / custom.length)) : 0;
  const fixed: Col[] = [
    { key: "serial", label: "Serial No", width: 50, cell: (r) => r.serial },
    { key: "desc", label: "Material Description", width: 0, cell: (r) => (r.archived ? `${r.description} (archived)` : r.description) },
    { key: "spec", label: "Specification", width: 104, cell: (r) => r.specification || "—" },
    { key: "rate", label: "Rate", width: 56, align: "right", cell: (r) => <Rupees value={r.rate} /> },
    { key: "open", label: "Opening", width: 56, align: "right", cell: (r) => formatQty(r.opening) },
    { key: "recv", label: "Received", width: 56, align: "right", cell: (r) => formatQty(r.received) },
    { key: "iss", label: "Issued", width: 56, align: "right", cell: (r) => formatQty(r.issued) },
    { key: "close", label: "Closing", width: 58, align: "right", cell: (r) => formatQty(r.closing) },
    { key: "value", label: "Closing value", width: 72, align: "right", cell: (r) => <Rupees value={r.value} /> },
  ];
  const cols = [...fixed, ...custom.map((c, i): Col => ({ key: `c${i}`, label: c.label, width: customW, cell: (r) => r.custom[i] || "" }))];
  const used = cols.reduce((a, c) => a + c.width, 0);
  cols[1].width = Math.max(90, INNER - used);
  return cols;
}

function Cells({ cols, row, head, zebra }: { cols: Col[]; row?: ExportRow; head?: boolean; zebra?: boolean }) {
  return (
    <View style={s.row} wrap={false} fixed={head}>
      {cols.map((c, i) => (
        <Text
          key={c.key}
          style={[s.cell, { width: c.width }, i === 0 ? s.first : {}, head ? s.head : {}, zebra ? s.zebra : {}, c.align === "right" ? s.right : {}]}
        >
          {head ? c.label : c.cell(row!)}
        </Text>
      ))}
    </View>
  );
}

export function InventoryReport({ model }: { model: ExportModel }) {
  const cols = columns(model);
  const subtitle = `${dmySlash(model.from)} to ${dmySlash(model.to)} · ${model.rangeLabel}`;
  return (
    <Document title={model.title} author={COMPANY.name} creator={COMPANY.name} producer={COMPANY.name}>
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <PdfHeader title="Product Specification" subtitle={subtitle} generatedAt={model.generatedAt} />
        <View style={s.summary}>
          <Text style={s.summaryItem}>
            <Text style={s.label}>Products: </Text>
            {model.rows.length.toLocaleString("en-IN")}
          </Text>
          <Text style={s.summaryItem}>
            <Text style={s.label}>Received: </Text>
            {formatQty(model.totals.received)}
          </Text>
          <Text style={s.summaryItem}>
            <Text style={s.label}>Issued: </Text>
            {formatQty(model.totals.issued)}
          </Text>
          {model.person && (
            <Text style={s.summaryItem}>
              <Text style={s.label}>Inventory: </Text>
              {model.person}
            </Text>
          )}
        </View>
        <Cells cols={cols} head />
        {model.rows.length === 0 ? (
          <Text style={s.empty}>No products in this range.</Text>
        ) : (
          model.rows.map((r, i) => <Cells key={r.serial + i} cols={cols} row={r} zebra={i % 2 === 1} />)
        )}
        <View style={s.totals} wrap={false}>
          <Text>
            <Text style={s.label}>Total closing value: </Text>
            <Rupees value={model.totals.value} />
          </Text>
        </View>
        <View style={s.footer} fixed>
          <Text>{COMPANY.name} · Product Specification</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
