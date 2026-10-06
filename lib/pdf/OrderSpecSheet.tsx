import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatDateTime, formatDay } from "@/lib/utils";
import { C, base, inr } from "./theme";
import { PdfHeader, PdfFooter, PdfSignature } from "./Chrome";

const s = StyleSheet.create({
  table: { borderTop: `0.75 solid ${C.rule}`, borderLeft: `0.75 solid ${C.rule}` },
  row: { flexDirection: "row" },
  label: {
    width: "32%",
    backgroundColor: C.head,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRight: `0.75 solid ${C.rule}`,
    borderBottom: `0.75 solid ${C.rule}`,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.ink,
  },
  value: {
    width: "68%",
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRight: `0.75 solid ${C.rule}`,
    borderBottom: `0.75 solid ${C.rule}`,
    fontSize: 10,
    color: C.ink,
  },
  long: { lineHeight: 1.5, fontSize: 9.5 },
  // pushes the signature to the foot of the (last) page
  fill: { flexGrow: 1 },
});

/**
 * One order, one field per table row — nothing shares a cell. Only the
 * CURRENT stage is shown (no stage-by-stage history). The order-value row
 * only exists when `showPrice` (never for production).
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
  const rows: [string, string][] = [
    ["Product name", order.product_name],
    ["Client name", order.client_name || "—"],
    ["Transformer rating", order.transformer_rating || "—"],
    ["Quantity", String(order.quantity)],
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
    ["Description", order.description || "—"],
  ];

  return (
    <Document title={`${order.product_name} — Order specification`} author="NR Industries">
      <Page size="A4" style={base.page}>
        <PdfHeader
          title="Order Specification"
          subtitle={`Ref ${order.id.slice(0, 8).toUpperCase()}`}
          generatedAt={generatedAt}
        />
        <View style={s.table}>
          {rows.map(([label, value]) => (
            <View key={label} style={s.row} wrap={label === "Description"}>
              <Text style={s.label}>{label}</Text>
              <Text style={[s.value, label === "Description" ? s.long : {}]}>{value}</Text>
            </View>
          ))}
        </View>
        <View style={s.fill} />
        <PdfSignature />
        <PdfFooter />
      </Page>
    </Document>
  );
}
