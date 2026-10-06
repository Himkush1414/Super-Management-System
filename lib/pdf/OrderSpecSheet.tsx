import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL, itemValue, orderTitle, totalQuantity } from "@/lib/orders";
import { formatDateTime, formatDay } from "@/lib/utils";
import { C, base, inr } from "./theme";
import { PdfHeader, PdfFooter, PdfSignature } from "./Chrome";

const cellRule = { borderRight: `0.75 solid ${C.rule}`, borderBottom: `0.75 solid ${C.rule}` };

const s = StyleSheet.create({
  table: { borderTop: `0.75 solid ${C.rule}`, borderLeft: `0.75 solid ${C.rule}` },
  row: { flexDirection: "row" },
  label: {
    width: "32%",
    backgroundColor: C.head,
    paddingVertical: 7,
    paddingHorizontal: 9,
    ...cellRule,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.ink,
  },
  value: {
    width: "68%",
    paddingVertical: 7,
    paddingHorizontal: 9,
    ...cellRule,
    fontSize: 10,
    color: C.ink,
  },
  heading: { marginTop: 18, marginBottom: 6, fontSize: 11, fontFamily: "Helvetica-Bold", color: C.navy },
  // products table
  pCell: { paddingVertical: 6, paddingHorizontal: 6, ...cellRule, fontSize: 9, color: C.ink },
  pHead: { backgroundColor: C.head, fontFamily: "Helvetica-Bold", fontSize: 8.2, color: C.navy },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  totalLabel: { fontFamily: "Helvetica-Bold", textAlign: "right", backgroundColor: C.head },
  totalValue: { fontFamily: "Helvetica-Bold", textAlign: "right" },
  // pushes the signature to the foot of the (last) page
  fill: { flexGrow: 1 },
});

type PCol = { key: string; label: string; width: number; align?: "right" | "center"; cell: (i: OrderItem) => string };

/**
 * One order: an order-details table (one field per row — nothing shares a
 * cell), then a ruled products table (no descriptions — those stay on the
 * order page), then the signature. Only the CURRENT
 * stage is shown (no stage-by-stage history). The price / FEAT / value
 * columns, the total and the order-value row only exist when `showPrice`
 * (never for production).
 */
export function OrderSpecSheet({
  order,
  showPrice,
  showDispatcher,
  showAssignees,
  generatedAt,
}: {
  order: OrderRow;
  showPrice: boolean;
  showDispatcher: boolean;
  showAssignees: boolean;
  generatedAt: Date;
}) {
  const units = totalQuantity(order);
  const rows: [string, string][] = [
    ["Client name", order.client_name || "—"],
    ["Products", `${order.items.length} (${units} unit${units === 1 ? "" : "s"})`],
    ...(showPrice ? ([["Order value", inr(order.price)]] as [string, string][]) : []),
    ["Expected delivery date", formatDay(order.expected_delivery)],
    ["Current stage", `Stage ${order.stage} of ${MAX_STAGE} — ${stageName(order.stage)}`],
    ["Status", ORDER_STATUS_LABEL[order.status] ?? order.status],
    ...(showAssignees
      ? ([["Production", order.assignees.map((a) => a.label).join(", ") || "—"]] as [string, string][])
      : []),
    ...(showDispatcher
      ? ([["Punched by", order.dispatcher?.label ?? "—"]] as [string, string][])
      : []),
    ["Punched on", formatDateTime(order.created_at)],
  ];

  // No description in the PDF (it stays on the order page). Value = price + FEAT.
  const cols: PCol[] = [
    { key: "n", label: "#", width: 4, align: "center", cell: (i) => String(i.position) },
    { key: "name", label: "Product name", width: 30, cell: (i) => i.product_name },
    { key: "rating", label: "Transformer rating", width: 22, cell: (i) => i.transformer_rating || "—" },
    { key: "qty", label: "Qty", width: 7, align: "right", cell: (i) => String(i.quantity) },
    ...(showPrice
      ? [
          { key: "price", label: "Price", width: 14, align: "right" as const, cell: (i: OrderItem) => inr(i.price) },
          { key: "feat", label: "FEAT", width: 12, align: "right" as const, cell: (i: OrderItem) => inr(i.feat) },
          { key: "value", label: "Value", width: 14, align: "right" as const, cell: (i: OrderItem) => inr(itemValue(i)) },
        ]
      : []),
  ];
  const total = cols.reduce((n, c) => n + c.width, 0);
  const w = (width: number) => ({ width: `${(width / total) * 100}%` });
  const align = (c: PCol) => (c.align === "right" ? s.right : c.align === "center" ? s.center : {});
  // The total row's label spans every column before Value.
  const beforeValue = cols.slice(0, cols.findIndex((c) => c.key === "value")).reduce((n, c) => n + c.width, 0);

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
                  {c.cell(it)}
                </Text>
              ))}
            </View>
          ))}
          {showPrice && order.items.length > 1 && (
            <View style={s.row} wrap={false}>
              <Text style={[s.pCell, s.totalLabel, w(beforeValue)]}>Order total</Text>
              <Text style={[s.pCell, s.totalValue, w(14)]}>{inr(order.price)}</Text>
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
