import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import {
  GST_PERCENT,
  MAX_STAGE,
  stageName,
  ORDER_STATUS_LABEL,
  itemTotal,
  orderAmounts,
  orderTitle,
  totalQuantity,
} from "@/lib/orders";
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
  sumLabel: { textAlign: "right", backgroundColor: C.head },
  sumCell: { paddingVertical: 4 },
  // pushes the signature to the foot of the (last) page
  fill: { flexGrow: 1 },
});

type PCol = { key: string; label: string; width: number; align?: "right" | "center"; cell: (i: OrderItem) => string };

/**
 * One order: an order-details table (one field per row — nothing shares a
 * cell), then a ruled products table (no descriptions — those stay on the
 * order page), then the signature. Only the CURRENT
 * stage is shown (no stage-by-stage history). The price / GST / total
 * columns, the subtotal breakdown and the subtotal + Additional Amount rows
 * only exist when `showPrice` (never for production).
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
  const amounts = orderAmounts(order);
  const rows: [string, string][] = [
    ["Client name", order.client_name || "—"],
    ["Ship To", order.ship_to || "—"],
    ["Products", `${order.items.length} (${units} unit${units === 1 ? "" : "s"})`],
    ...(showPrice ? ([["Order subtotal", inr(amounts.subtotal)]] as [string, string][]) : []),
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
    ...(showPrice ? ([["Additional Amount", inr(amounts.additional)]] as [string, string][]) : []),
  ];

  // No description in the PDF (it stays on the order page). Total = price + GST.
  // Amount columns fit crore-sized values on one line ("INR 1,17,99,999.99";
  // the total column up to "INR 99,99,99,999.99"); anything larger wraps
  // after "INR", never past the cell.
  const cols: PCol[] = [
    { key: "n", label: "#", width: 4, align: "center", cell: (i) => String(i.position) },
    { key: "name", label: "Product name", width: showPrice ? 22 : 30, cell: (i) => i.product_name },
    { key: "rating", label: "Transformer rating", width: showPrice ? 16 : 22, cell: (i) => i.transformer_rating || "—" },
    { key: "qty", label: "Qty", width: 6, align: "right", cell: (i) => String(i.quantity) },
    ...(showPrice
      ? [
          { key: "price", label: "Price", width: 17.5, align: "right" as const, cell: (i: OrderItem) => inr(i.price) },
          { key: "gst", label: `GST ${GST_PERCENT}%`, width: 15, align: "right" as const, cell: (i: OrderItem) => inr(i.gst) },
          { key: "value", label: `Total incl. GST`, width: 19.5, align: "right" as const, cell: (i: OrderItem) => inr(itemTotal(i)) },
        ]
      : []),
  ];
  const total = cols.reduce((n, c) => n + c.width, 0);
  const w = (width: number) => ({ width: `${(width / total) * 100}%` });
  const align = (c: PCol) => (c.align === "right" ? s.right : c.align === "center" ? s.center : {});
  // The breakdown rows' labels span every column before the total column.
  const valueCol = cols.find((c) => c.key === "value");
  const beforeValue = cols.slice(0, cols.findIndex((c) => c.key === "value")).reduce((n, c) => n + c.width, 0);
  const breakdown: [string, string, boolean][] = [
    [`Products, including ${GST_PERCENT}% GST`, inr(amounts.products), false],
    ["Additional Amount added", amounts.additional === null ? "—" : `+ ${inr(amounts.additional)}`, false],
    ["Order subtotal", inr(amounts.subtotal), true],
  ];

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
          {showPrice && valueCol && (
            <View wrap={false}>
              {breakdown.map(([label, value, bold]) => (
                <View key={label} style={s.row}>
                  <Text style={[s.pCell, s.sumCell, bold ? s.totalLabel : s.sumLabel, w(beforeValue)]}>{label}</Text>
                  <Text style={[s.pCell, s.sumCell, bold ? s.totalValue : s.right, w(valueCol.width)]}>{value}</Text>
                </View>
              ))}
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
