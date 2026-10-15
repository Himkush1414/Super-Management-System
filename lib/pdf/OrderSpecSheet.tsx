import type { ReactNode } from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL, orderTitle, totalQuantity } from "@/lib/orders";
import { GST_RATE, orderMoney, type Paise } from "@/lib/money";
import { formatDateTime, formatDay } from "@/lib/utils";
import { C, base } from "./theme";
import { PdfHeader, PdfFooter, PdfSignature } from "./Chrome";
import { Rupees } from "./Rupees";

const cellRule = { borderRight: `0.75 solid ${C.rule}`, borderBottom: `0.75 solid ${C.rule}` };

const s = StyleSheet.create({
  table: { borderTop: `0.75 solid ${C.rule}`, borderLeft: `0.75 solid ${C.rule}` },
  row: { flexDirection: "row" },
  label: {
    width: "32%",
    backgroundColor: C.head,
    paddingVertical: 5,
    paddingHorizontal: 9,
    ...cellRule,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.ink,
  },
  value: {
    width: "68%",
    paddingVertical: 5,
    paddingHorizontal: 9,
    ...cellRule,
    fontSize: 10,
    color: C.ink,
  },
  heading: { marginTop: 18, marginBottom: 6, fontSize: 11, fontFamily: "Helvetica-Bold", color: C.navy },
  // products table
  pCell: { paddingVertical: 5, paddingHorizontal: 6, ...cellRule, fontSize: 9, color: C.ink },
  pHead: { backgroundColor: C.head, fontFamily: "Helvetica-Bold", fontSize: 8.2, color: C.navy },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  totalLabel: { fontFamily: "Helvetica-Bold", textAlign: "right", backgroundColor: C.head },
  totalValue: { fontFamily: "Helvetica-Bold", textAlign: "right" },
  // the breakdown lines above the subtotal: same cells, regular weight
  sumCell: { paddingVertical: 4 },
  // pushes the signature to the foot of the (last) page
  fill: { flexGrow: 1 },
});

type PCol = {
  key: string;
  label: string;
  width: number;
  align?: "right" | "center";
  cell: (i: OrderItem, k: number) => ReactNode;
};

/** The A4 portrait line between the page margins, in points. */
const LINE = 595.28 - 2 * 36;

/**
 * One order: an order-details table (one field per row — nothing shares a
 * cell), then a ruled products table (no descriptions — those stay on the
 * order page), then the signature. Only the CURRENT
 * stage is shown (no stage-by-stage history). The money — Unit price /
 * Additional amount / Total (incl. 18% GST) columns, the Grand total
 * (incl. 18% GST) row under them and the details-table rows — only exists
 * when `showPrice` (never for production). Every figure comes from
 * lib/money.ts, and the row totals add up to the grand total to the paisa.
 */
export function OrderSpecSheet({
  order,
  showPrice,
  showPuncher,
  showAssignees,
  generatedAt,
}: {
  order: OrderRow;
  showPrice: boolean;
  showPuncher: boolean;
  showAssignees: boolean;
  generatedAt: Date;
}) {
  const units = totalQuantity(order);
  const money = orderMoney(order);
  const rows: [string, ReactNode][] = [
    ["Client name", order.client_name || "—"],
    ["Ship To", order.ship_to || "—"],
    ["Products", `${order.items.length} (${units} unit${units === 1 ? "" : "s"})`],
    ...(showPrice
      ? ([[`Grand total (incl. ${GST_RATE}% GST)`, <Rupees key="g" value={money.grandTotal} />]] as [string, ReactNode][])
      : []),
    ["Expected delivery date", formatDay(order.expected_delivery)],
    ["Current stage", `Stage ${order.stage} of ${MAX_STAGE} — ${stageName(order.stage)}`],
    ["Status", ORDER_STATUS_LABEL[order.status] ?? order.status],
    ...(showAssignees
      ? ([["Production", order.assignees.map((a) => a.label).join(", ") || "—"]] as [string, string][])
      : []),
    ...(showPuncher
      ? ([["Punched by", order.puncher?.label ?? "—"]] as [string, string][])
      : []),
    ["Punched on", formatDateTime(order.created_at)],
    ...(showPrice ? ([["Additional Amount", <Rupees key="a" value={money.additional} />]] as [string, ReactNode][]) : []),
  ];

  // No description in the PDF (it stays on the order page).
  // Qty | Unit price | Additional amount | Total (incl. 18% GST), per product
  // row: (unit price × qty + the row's Additional Amount) + 18% GST on that.
  // The order's Additional Amount sits on its first product row (lib/money).
  // Amounts fit up to "₹99,99,99,999.99" on one line; anything larger breaks
  // after a comma, never past the cell.
  const cols: PCol[] = [
    { key: "n", label: "#", width: 4, align: "center", cell: (i) => String(i.position) },
    { key: "name", label: "Product name", width: showPrice ? 20 : 30, cell: (i) => i.product_name },
    { key: "rating", label: "Transformer rating", width: showPrice ? 15 : 22, cell: (i) => i.transformer_rating || "—" },
    { key: "qty", label: "Qty", width: 6, align: "right", cell: (i) => String(i.quantity) },
    ...(showPrice
      ? [
          { key: "unit", label: "Unit price", width: 18, align: "right" as const, cell: (_: OrderItem, k: number) => rupees(money.rows[k].unit, 18) },
          { key: "additional", label: "Additional amount", width: 17, align: "right" as const, cell: (_: OrderItem, k: number) => rupees(money.rows[k].additional, 17) },
          { key: "value", label: `Total (incl. ${GST_RATE}% GST)`, width: 20, align: "right" as const, cell: (_: OrderItem, k: number) => rupees(money.rows[k].total, 20) },
        ]
      : []),
  ];
  const total = cols.reduce((n, c) => n + c.width, 0);
  const w = (width: number) => ({ width: `${(width / total) * 100}%` });
  // an amount sized to its column (cell padding 6 + 6, a hairline to spare)
  const rupees = (v: Paise | null, width: number) => (
    <Rupees value={v} fit={{ width: (width / total) * LINE - 12 - 0.5, fontSize: 9 }} />
  );
  const align = (c: PCol) => (c.align === "right" ? s.right : c.align === "center" ? s.center : {});
  const widthOf = (key: string) => cols.find((c) => c.key === key)?.width ?? 0;
  const before = (key: string) => cols.slice(0, cols.findIndex((c) => c.key === key)).reduce((n, c) => n + c.width, 0);

  return (
    <Document title={`${orderTitle(order)} — Order specification`} author="NR Industries">
      <Page size="A4" style={base.page}>
        <PdfHeader
          title="Order Specification"
          subtitle={`Ref ${order.id.slice(0, 8).toUpperCase()}`}
          generatedAt={generatedAt}
        />
        <View style={s.table}>
          {rows.map(([label, value]) => (
            <View key={label} style={s.row} wrap={false}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.value}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={s.heading} minPresenceAhead={60}>
          Products
        </Text>
        <View style={s.table}>
          <View style={s.row} fixed>
            {cols.map((c) => (
              <Text key={c.key} style={[s.pCell, s.pHead, w(c.width), align(c)]}>
                {c.label}
              </Text>
            ))}
          </View>
          {order.items.map((it, ri) => (
            <View key={it.id} style={[s.row, ri % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
              {cols.map((c) => (
                <Text key={c.key} style={[s.pCell, w(c.width), align(c)]}>
                  {c.cell(it, ri)}
                </Text>
              ))}
            </View>
          ))}
          {/* Grand total = Σ the row totals above (lib/money.ts); its label spans
              every column before the Total column. */}
          {showPrice && (
            <View style={s.row} wrap={false}>
              <Text style={[s.pCell, s.sumCell, s.totalLabel, w(before("value"))]}>
                Grand total (incl. {GST_RATE}% GST)
              </Text>
              <Text style={[s.pCell, s.sumCell, s.totalValue, w(widthOf("value"))]}>
                {rupees(money.grandTotal, widthOf("value"))}
              </Text>
            </View>
          )}
        </View>

        <View style={s.fill} />
        <PdfSignature />
        <PdfFooter />
      </Page>
    </Document>
  );
}
