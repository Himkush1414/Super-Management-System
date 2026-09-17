import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import { stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatCurrency, formatDate } from "@/lib/utils";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: "#111827", fontFamily: "Helvetica" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: "1.5 solid #111827",
    paddingBottom: 12,
    marginBottom: 16,
  },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 9, color: "#6B7280", marginTop: 2 },
  meta: { fontSize: 8, color: "#6B7280", textAlign: "right" },
  rowHead: {
    flexDirection: "row",
    borderBottom: "1 solid #111827",
    paddingBottom: 6,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    borderBottom: "0.5 solid #E5E7EB",
    paddingVertical: 5,
  },
  th: { fontSize: 7, textTransform: "uppercase", color: "#6B7280" },
  colProduct: { width: "26%" },
  colParty: { width: "18%" },
  colQty: { width: "8%" },
  colStage: { width: "18%" },
  colPrice: { width: "12%" },
  colStatus: { width: "16%" },
  colDate: { width: "12%" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 7.5,
    color: "#9CA3AF",
    textAlign: "center",
    borderTop: "0.5 solid #E5E7EB",
    paddingTop: 8,
  },
});

export function OrdersReport({
  orders,
  showParties,
  showPrice,
  generatedBy,
  scopeLabel,
}: {
  orders: OrderRow[];
  showParties: boolean;
  showPrice: boolean;
  generatedBy: string;
  scopeLabel: string;
}) {
  return (
    <Document title="Orders Report">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>NR Industries</Text>
            <Text style={styles.docTitle}>Orders Report — {scopeLabel}</Text>
          </View>
          <View>
            <Text style={styles.meta}>{new Date().toLocaleString("en-IN")}</Text>
            <Text style={styles.meta}>by {generatedBy}</Text>
            <Text style={styles.meta}>{orders.length} order{orders.length === 1 ? "" : "s"}</Text>
          </View>
        </View>

        <View style={styles.rowHead}>
          <Text style={[styles.th, styles.colProduct]}>Product</Text>
          {showParties && <Text style={[styles.th, styles.colParty]}>Dispatched by</Text>}
          <Text style={[styles.th, styles.colParty]}>Production</Text>
          <Text style={[styles.th, styles.colQty]}>Qty</Text>
          <Text style={[styles.th, styles.colStage]}>Stage</Text>
          {showPrice && <Text style={[styles.th, styles.colPrice]}>Price</Text>}
          <Text style={[styles.th, styles.colStatus]}>Status</Text>
          <Text style={[styles.th, styles.colDate]}>Date</Text>
        </View>

        {orders.map((o) => (
          <View key={o.id} style={styles.row} wrap={false}>
            <Text style={styles.colProduct}>{o.product_name}</Text>
            {showParties && (
              <Text style={styles.colParty}>{o.dispatcher?.full_name ?? "—"}</Text>
            )}
            <Text style={styles.colParty}>{o.assignee?.full_name ?? "—"}</Text>
            <Text style={styles.colQty}>{o.quantity}</Text>
            <Text style={styles.colStage}>
              {o.stage} — {stageName(o.stage)}
            </Text>
            {showPrice && <Text style={styles.colPrice}>{formatCurrency(o.price)}</Text>}
            <Text style={styles.colStatus}>
              {ORDER_STATUS_LABEL[o.status] ?? o.status}
            </Text>
            <Text style={styles.colDate}>{formatDate(o.created_at)}</Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          NR Industries — internal document. Not for external distribution.
        </Text>
      </Page>
    </Document>
  );
}
