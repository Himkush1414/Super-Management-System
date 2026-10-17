import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { GST_RATE, orderMoney, sumMoney, type OrderMoney, type Paise } from "@/lib/money";
import { formatDate, formatDay } from "@/lib/utils";
import { C, base } from "./theme";
import { PdfHeader, PdfFooter, PdfSignature } from "./Chrome";
import { fitWords } from "./fit";
import { Rupees } from "./Rupees";

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
  // With the money columns (admin / marketing) the row holds 15 columns:
  // slightly smaller text and padding so long words and amounts never cross
  // a cell rule. Production's report keeps the regular size.
  cellCompact: { paddingHorizontal: 4, fontSize: 7 },
  headCompact: { fontSize: 6.6 },
  subCompact: { fontSize: 6.3 },
  block: { flexDirection: "column" },
  grow: { flexGrow: 1 },
  // Subtotal / GST / Grand total under the table, right-aligned
  totals: { alignSelf: "flex-end", width: 320, marginTop: 10 },
  totalsLabel: { width: "58%", backgroundColor: C.head, textAlign: "right", fontSize: 8.5 },
  totalsValue: { width: "42%", textAlign: "right", fontSize: 8.5 },
  totalsGrand: { fontSize: 9.5, color: C.navy },
});

type Col = {
  key: string;
  label: string;
  width: number;
  align?: "right" | "center";
  cell: (o: OrderRow) => string;
  sub?: (o: OrderRow) => string | undefined;
};
type ItemCol = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  cell: (i: OrderItem) => string;
  /** a money column, drawn as "₹1,00,000.00": the product's row in lib/money (k = its index in the order) */
  money?: (o: OrderRow, k: number) => Paise | null;
};

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
 * money is per product line: Qty | Unit price | Total (incl. 18% GST) =
 * (unit price × qty + the line's Additional Amount) + 18% GST on that — an
 * order's Additional Amount sits on its first product (lib/money.ts). The
 * Additional Amount has no column of its own (room for Remarks): its sum
 * over the report is printed by the totals, as "Additional cost". Under the
 * table: Additional cost (included in the subtotal) / Subtotal (before GST) /
 * GST @ 18% / Grand total (incl. 18% GST) — the sums of those lines, so the
 * rows add up to the totals to the paisa. All of it exists only when
 * `showPrice` (never for production).
 *
 * The last column, Remarks, is always blank: room to write by hand on the
 * printed copy. Nothing in the system fills it.
 *
 * Widths are in points of the 770pt landscape line (scaled to fit when some
 * columns are hidden). Money cells read "₹2,51,50,000.00": one line up to
 * ₹99,99,99,999.99, larger ones break after a comma. Dates,
 * stages and 4-digit quantities never wrap; product names and ratings fit
 * an 11-letter capitalised word ("TRANSFORMER"). A longer word is hyphenated
 * (fit.ts) rather than drawn across a rule.
 */
export function OrdersReport({
  orders,
  groups,
  showPuncher,
  showAssignees,
  showPrice,
  scopeLabel,
  periodLabel,
  generatedAt,
}: {
  orders: OrderRow[];
  /** sections in display order; each order belongs to exactly one */
  groups?: { heading: string; orders: OrderRow[] }[];
  showPuncher: boolean;
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
    { key: "client", label: "Client name", width: W(57, 70), cell: (o) => o.client_name || "—" },
    { key: "ship", label: "Ship To", width: W(56, 70), cell: shipTo },
  ];
  const itemCols: ItemCol[] = [
    { key: "product", label: "Product name", width: W(71, 84), cell: (i) => i.product_name },
    { key: "rating", label: "Transformer rating", width: W(58, 70), cell: (i) => i.transformer_rating || "—" },
    { key: "qty", label: "Qty", width: W(26, 28), align: "right", cell: (i) => String(i.quantity) },
    ...(showPrice
      ? [
          { key: "unit", label: "Unit price", width: 64, align: "right" as const, cell: () => "", money: (o: OrderRow, k: number) => m(o).rows[k].unit },
          { key: "value", label: `Total (incl. ${GST_RATE}% GST)`, width: 66, align: "right" as const, cell: () => "", money: (o: OrderRow, k: number) => m(o).rows[k].total },
        ]
      : []),
  ];
  // every order's money, once (lib/money.ts)
  const moneyOf = new Map<string, OrderMoney>(orders.map((o) => [o.id, orderMoney(o)]));
  const m = (o: OrderRow) => moneyOf.get(o.id)!;
  const tail: Col[] = [
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
    ...(showPuncher
      ? [{ key: "by", label: "Punched by", width: 46, cell: (o: OrderRow) => o.puncher?.label ?? "—" }]
      : []),
    { key: "date", label: "Punched on", width: W(44, 62), cell: (o) => formatDate(o.created_at) },
    // blank on purpose: written on by hand after printing
    { key: "remarks", label: "Remarks", width: W(80, 100), cell: () => "" },
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
  const sumOf = (os: OrderRow[]) => sumMoney(os.map(m));
  const totals = sumOf(orders);
  // Σ the orders' Additional Amounts — already inside the subtotal
  const additionalCost = orders.reduce((n, o) => n + m(o).additional, BigInt(0));
  // an amount sized to its column (the inner width fit() uses)
  const rupees = (v: Paise | null, width: number) => (
    <Rupees value={v} fit={{ width: (width / total) * LINE - 2 * (compact ? 4 : 5) - 0.5, fontSize }} />
  );
  const productCount = orders.reduce((n, o) => n + o.items.length, 0);

  const orderCell = (o: OrderRow, c: Col, i: number) => (
    <View key={c.key} style={[...cell, w(c.width), c.key === "n" ? s.first : {}]}>
      <Text style={align(c)}>
        {c.key === "n" ? String(i + 1) : fit(c.cell(o), c.width)}
      </Text>
      {c.sub ? <Text style={sub}>{c.sub(o)}</Text> : null}
    </View>
  );

  // one order: its own cells, then one ruled line per product
  const orderRow = (o: OrderRow) => {
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
                  {c.money ? rupees(c.money(o, k), c.width) : fit(c.cell(it), c.width)}
                </Text>
              ))}
            </View>
          ))}
        </View>
        {tail.map((c) => orderCell(o, c, i))}
      </View>
    );
  };

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
              Additional cost:{" "}
              <Text style={s.bold}>
                <Rupees value={additionalCost} />
              </Text>
            </Text>
          )}
          {showPrice && (
            <Text style={s.summaryItem}>
              Grand total (incl. {GST_RATE}% GST):{" "}
              <Text style={s.bold}>
                <Rupees value={totals.grandTotal} />
              </Text>
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
            (groups ?? [{ heading: "", orders }]).map((g) => {
              const heading = g.heading ? (
                <View style={s.row}>
                  <Text style={s.group}>
                    {g.heading} — {g.orders.length} order{g.orders.length === 1 ? "" : "s"}
                    {showPrice ? " · Subtotal (before GST) " : ""}
                    {showPrice ? <Rupees value={sumOf(g.orders).subtotal} /> : null}
                  </Text>
                </View>
              ) : null;
              const [first, ...rest] = g.orders;
              return (
                <View key={g.heading || "all"}>
                  {/* the heading is never left alone at a page foot: it stays
                      with its first order (unless that order may outgrow a page) */}
                  {first && first.items.length <= 8 ? (
                    <View wrap={false}>
                      {heading}
                      {orderRow(first)}
                    </View>
                  ) : (
                    <>
                      {heading}
                      {first && orderRow(first)}
                    </>
                  )}
                  {rest.map(orderRow)}
                </View>
              );
            })
          )}
        </View>

        {showPrice && orders.length > 0 && (
          <View style={[s.totals, s.top]} wrap={false}>
            {(
              [
                ["Additional cost (included in subtotal)", additionalCost],
                ["Subtotal (before GST)", totals.subtotal],
                [`GST @ ${GST_RATE}%`, totals.gst],
                [`Grand total (incl. ${GST_RATE}% GST)`, totals.grandTotal],
              ] as const
            ).map(([label, value], k) => (
              <View key={label} style={s.row}>
                <Text style={[s.cell, s.first, s.totalsLabel, k === 3 ? s.totalsGrand : {}]}>{label}</Text>
                <Text style={[s.cell, s.totalsValue, k === 3 ? s.totalsGrand : {}]}>
                  <Rupees value={value} />
                </Text>
              </View>
            ))}
          </View>
        )}

        <PdfSignature />
        <PdfFooter />
      </Page>
    </Document>
  );
}
