import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import { GST_PERCENT, MAX_STAGE, stageName, ORDER_STATUS_LABEL, itemTotal, orderAmounts } from "@/lib/orders";
import { formatDate, formatDay } from "@/lib/utils";
import { C, amount, base, inr } from "./theme";
import { PdfHeader, PdfFooter, PdfSignature } from "./Chrome";
import { fitWords } from "./fit";

/** The landscape A4 line between the page margins, in points. */
const LINE = 841.89 - 2 * 36;

const s = StyleSheet.create({
  summary: { flexDirection: "row", marginBottom: 10, fontSize: 9, color: C.body },
  group: {
    width: "100%",
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: C.navy,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  summaryItem: { marginRight: 18 },
  bold: { fontFamily: "Helvetica-Bold", color: C.ink },
  // Outer rules live on the cells (first column / header row), not the table
  // container, so no stray line runs past the last row at a page break.
  table: {},
  first: { borderLeft: `0.75 solid ${C.rule}` },
  top: { borderTop: `0.75 solid ${C.rule}` },
  row: { flexDirection: "row" },
  cell: {
    paddingVertical: 5,
    paddingHorizontal: 5,
    borderRight: `0.75 solid ${C.rule}`,
    borderBottom: `0.75 solid ${C.rule}`,
    fontSize: 7.8,
    color: C.ink,
  },
  head: {
    backgroundColor: C.head,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.2,
    color: C.navy,
  },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  sub: { fontSize: 6.8, color: C.muted, marginTop: 1 },
  // With the money columns (admin / marketing) the row holds 16 columns:
  // slightly smaller text and padding so long words and amounts never cross
  // a cell rule. Production's report keeps the regular size.
  cellCompact: { paddingHorizontal: 4, fontSize: 7 },
  headCompact: { fontSize: 6.6 },
  subCompact: { fontSize: 6.3 },
  block: { flexDirection: "column" },
  grow: { flexGrow: 1 },
});

type Col = {
  key: string;
  label: string;
  width: number;
  align?: "right" | "center";
  cell: (o: OrderRow) => string;
  sub?: (o: OrderRow) => string | undefined;
};
type ItemCol = { key: string; label: string; width: number; align?: "right"; cell: (i: OrderItem) => string };

/** Ship To in a narrow column: one paragraph, lines joined. */
const shipTo = (o: OrderRow) =>
  o.ship_to
    .split(/\n/)
    .map((l) => l.trim().replace(/[,;]+$/, ""))
    .filter(Boolean)
    .join(", ") || "—";

/**
 * Column widths are relative; amounts and dates are sized to fit on one line
 * (react-pdf can't forbid wrapping). Every order is one table row, every field
 * in its own ruled column — no two values ever share a cell. The product
 * columns form a block inside the row with one ruled line per product, so a
 * product's name, rating and quantity always line up (no descriptions in
 * the PDF — they stay on the order page). Stage = current stage only. The
 * money columns — each product's price and price + 18% GST, the order
 * subtotal (Σ price + GST, plus the Additional Amount) and the Additional
 * Amount itself — exist only when `showPrice` (never for production).
 *
 * Widths are in points of the 770pt landscape line (scaled to fit when some
 * columns are hidden). Money columns are headed "(INR)" and hold bare
 * numbers: one line up to ₹1 crore, larger ones break after a comma. Dates,
 * stages and 4-digit quantities never wrap; product names and ratings fit
 * an 11-letter capitalised word ("TRANSFORMER"). A longer word is hyphenated
 * (fit.ts) rather than drawn across a rule.
 */
export function OrdersReport({
  orders,
  groups,
  showDispatcher,
  showAssignees,
  showPrice,
  scopeLabel,
  periodLabel,
  generatedAt,
}: {
  orders: OrderRow[];
  /** sections in display order; each order belongs to exactly one */
  groups?: { heading: string; orders: OrderRow[] }[];
  showDispatcher: boolean;
  showAssignees: boolean;
  showPrice: boolean;
  scopeLabel: string;
  /** "All time", "October 2026", "Week 05/10/2026 – 11/10/2026", "2026" */
  periodLabel?: string;
  generatedAt: Date;
}) {
  const compact = showPrice;
  // [compact, regular] width of each column
  const W = (c: number, r: number) => (compact ? c : r);
  const lead: Col[] = [
    { key: "n", label: "#", width: 20, align: "center", cell: () => "" },
    { key: "client", label: "Client name", width: W(62, 70), cell: (o) => o.client_name || "—" },
    { key: "ship", label: "Ship To", width: W(61, 70), cell: shipTo },
  ];
  const itemCols: ItemCol[] = [
    { key: "product", label: "Product name", width: W(64, 84), cell: (i) => i.product_name },
    { key: "rating", label: "Transformer rating", width: W(58, 70), cell: (i) => i.transformer_rating || "—" },
    { key: "qty", label: "Qty", width: W(26, 28), align: "right", cell: (i) => String(i.quantity) },
    ...(showPrice
      ? [
          { key: "price", label: "Price (INR)", width: 50, align: "right" as const, cell: (i: OrderItem) => amount(i.price) },
          {
            key: "incl",
            label: `Total incl. ${GST_PERCENT}% GST (INR)`,
            width: 52,
            align: "right" as const,
            cell: (i: OrderItem) => amount(itemTotal(i)),
          },
        ]
      : []),
  ];
  const tail: Col[] = [
    ...(showPrice
      ? [
          {
            key: "value",
            label: "Order subtotal (INR)",
            width: 55,
            align: "right" as const,
            cell: (o: OrderRow) => amount(orderAmounts(o).subtotal),
          },
        ]
      : []),
    { key: "delivery", label: "Expected delivery", width: W(44, 62), cell: (o) => formatDay(o.expected_delivery) },
    {
      key: "stage",
      label: "Current stage",
      width: W(46, 66),
      cell: (o) => `Stage ${o.stage} of ${MAX_STAGE}`,
      sub: (o) => stageName(o.stage),
    },
    { key: "status", label: "Status", width: W(42, 52), cell: (o) => (o.status === "active" ? "Active" : ORDER_STATUS_LABEL[o.status] ?? o.status) },
    ...(showAssignees
      ? [{ key: "prod", label: "Production", width: 50, cell: (o: OrderRow) => o.assignees.map((a) => a.label).join(", ") || "—" }]
      : []),
    ...(showDispatcher
      ? [{ key: "by", label: "Punched by", width: 46, cell: (o: OrderRow) => o.dispatcher?.label ?? "—" }]
      : []),
    { key: "date", label: "Punched on", width: W(44, 62), cell: (o) => formatDate(o.created_at) },
    ...(showPrice
      ? [
          {
            key: "additional",
            label: "Additional Amount (INR)",
            width: 50,
            align: "right" as const,
            cell: (o: OrderRow) => amount(orderAmounts(o).additional),
          },
        ]
      : []),
  ];
  const cell = compact ? [s.cell, s.cellCompact] : [s.cell];
  // a word wider than its column is hyphenated instead of crossing the rule
  const fontSize = compact ? 7 : 7.8;
  const fit = (text: string, width: number) =>
    fitWords(text, (width / total) * LINE - 2 * (compact ? 4 : 5) - 0.5, fontSize);
  const head = compact ? [s.head, s.headCompact] : [s.head];
  const sub = compact ? [s.sub, s.subCompact] : [s.sub];
  const blockWidth = itemCols.reduce((n, c) => n + c.width, 0);
  const total = [...lead, ...tail].reduce((n, c) => n + c.width, 0) + blockWidth;
  const w = (width: number) => ({ width: `${(width / total) * 100}%` });
  const wIn = (width: number) => ({ width: `${(width / blockWidth) * 100}%` });
  const align = (c: { align?: "right" | "center" }) =>
    c.align === "right" ? s.right : c.align === "center" ? s.center : {};
  const subtotalOf = (os: OrderRow[]) => os.reduce((n, o) => n + (orderAmounts(o).subtotal ?? 0), 0);
  const totalValue = subtotalOf(orders);
  const productCount = orders.reduce((n, o) => n + o.items.length, 0);

  const orderCell = (o: OrderRow, c: Col, i: number) => (
    <View key={c.key} style={[...cell, w(c.width), c.key === "n" ? s.first : {}]}>
      <Text style={align(c)}>{c.key === "n" ? String(i + 1) : fit(c.cell(o), c.width)}</Text>
      {c.sub ? <Text style={sub}>{c.sub(o)}</Text> : null}
    </View>
  );

  return (
    <Document title="Orders report" author="NR Industries">
      <Page size="A4" orientation="landscape" style={base.page}>
        <PdfHeader
          title="Orders Report"
          subtitle={periodLabel ? `${periodLabel} · ${scopeLabel}` : scopeLabel}
          generatedAt={generatedAt}
        />

        <View style={s.summary}>
          <Text style={s.summaryItem}>
            Orders: <Text style={s.bold}>{orders.length}</Text>
          </Text>
          <Text style={s.summaryItem}>
            Products: <Text style={s.bold}>{productCount}</Text>
          </Text>
          {showPrice && (
            <Text style={s.summaryItem}>
              Total order subtotal (incl. {GST_PERCENT}% GST, Additional Amounts added):{" "}
              <Text style={s.bold}>{inr(totalValue)}</Text>
            </Text>
          )}
        </View>

        <View style={s.table}>
          <View style={s.row} fixed>
            {[...lead, ...itemCols, ...tail].map((c) => (
              <Text key={c.key} style={[...cell, ...head, s.top, w(c.width), align(c), c.key === "n" ? s.first : {}]}>
                {c.label}
              </Text>
            ))}
          </View>
          {orders.length === 0 ? (
            <View style={s.row}>
              <Text style={[s.cell, s.first, { width: "100%", color: C.muted }]}>
                No orders in this period.
              </Text>
            </View>
          ) : (
            (groups ?? [{ heading: "", orders }]).map((g) => (
              <View key={g.heading || "all"}>
                {g.heading ? (
                  <View style={s.row} wrap={false}>
                    <Text style={s.group}>
                      {g.heading} — {g.orders.length} order{g.orders.length === 1 ? "" : "s"}
                      {showPrice
                        ? ` · ${inr(subtotalOf(g.orders))}`
                        : ""}
                    </Text>
                  </View>
                ) : null}
                {g.orders.map((o) => {
                  const i = orders.indexOf(o);
                  return (
                    <View
                      key={o.id}
                      style={[s.row, i % 2 === 1 ? { backgroundColor: C.zebra } : {}]}
                      // kept on one page unless it may be taller than a page
                      wrap={o.items.length > 8}
                    >
                      {lead.map((c) => orderCell(o, c, i))}
                      <View style={[s.block, w(blockWidth)]}>
                        {o.items.map((it, k) => (
                          <View
                            key={it.id}
                            // the last line stretches, so the block's bottom rule meets the row's
                            style={[s.row, k === o.items.length - 1 ? s.grow : {}]}
                          >
                            {itemCols.map((c) => (
                              <Text key={c.key} style={[...cell, wIn(c.width), align(c)]}>
                                {fit(c.cell(it), c.width)}
                              </Text>
                            ))}
                          </View>
                        ))}
                      </View>
                      {tail.map((c) => orderCell(o, c, i))}
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </View>

        <PdfSignature />
        <PdfFooter />
      </Page>
    </Document>
  );
}
