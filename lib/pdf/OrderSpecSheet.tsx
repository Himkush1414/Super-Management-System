import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderStageEvent } from "@/types/database.types";
import type { OrderRow } from "@/lib/data/orders";
import { stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#111827", fontFamily: "Helvetica" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: "1.5 solid #111827",
    paddingBottom: 12,
    marginBottom: 18,
  },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 9, color: "#6B7280", marginTop: 2 },
  generatedAt: { fontSize: 8, color: "#6B7280", textAlign: "right" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#6B7280", marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#6B7280",
    marginBottom: 8,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  field: { width: "33%", marginBottom: 10, paddingRight: 8 },
  label: { fontSize: 7.5, textTransform: "uppercase", color: "#6B7280", marginBottom: 2 },
  value: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  paragraph: { fontSize: 10, lineHeight: 1.4 },
  row: {
    flexDirection: "row",
    borderBottom: "0.5 solid #E5E7EB",
    paddingVertical: 6,
  },
  rowHead: {
    flexDirection: "row",
    borderBottom: "1 solid #111827",
    paddingBottom: 6,
    marginBottom: 2,
  },
  colStage: { width: "45%" },
  colDate: { width: "35%" },
  colWhat: { width: "20%" },
  th: { fontSize: 7.5, textTransform: "uppercase", color: "#6B7280" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: "#9CA3AF",
    textAlign: "center",
    borderTop: "0.5 solid #E5E7EB",
    paddingTop: 8,
  },
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function OrderSpecSheet({
  order,
  events,
  showPrice,
  showParties,
  generatedBy,
}: {
  order: OrderRow;
  events: OrderStageEvent[];
  showPrice: boolean;
  showParties: boolean;
  generatedBy: string;
}) {
  return (
    <Document title={`${order.product_name} — Spec Sheet`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>NR Industries</Text>
            <Text style={styles.docTitle}>Order Spec Sheet</Text>
          </View>
          <View>
            <Text style={styles.generatedAt}>
              Generated {formatDateTime(new Date().toISOString())}
            </Text>
            <Text style={styles.generatedAt}>by {generatedBy}</Text>
          </View>
        </View>

        <Text style={styles.title}>{order.product_name}</Text>
        <Text style={styles.subtitle}>
          Order #{order.id.slice(0, 8)} · Stage {order.stage} — {stageName(order.stage)} ·{" "}
          {ORDER_STATUS_LABEL[order.status] ?? order.status}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order details</Text>
          <View style={styles.grid}>
            <Field label="Quantity" value={String(order.quantity)} />
            <Field label="Quality" value={order.quality || "—"} />
            <Field label="Power / type" value={order.power_type || "—"} />
            {showPrice && <Field label="Price" value={formatCurrency(order.price)} />}
            {showParties && (
              <>
                <Field label="Dispatched by" value={order.dispatcher?.full_name ?? "—"} />
                <Field label="Production" value={order.assignee?.full_name ?? "—"} />
              </>
            )}
            <Field label="Dispatched" value={formatDateTime(order.created_at)} />
          </View>
        </View>

        {order.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.paragraph}>{order.description}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stage history</Text>
          <View style={styles.rowHead}>
            <Text style={[styles.th, styles.colStage]}>Stage</Text>
            <Text style={[styles.th, styles.colDate]}>When</Text>
          </View>
          {events.length === 0 ? (
            <Text style={[styles.paragraph, { color: "#6B7280", marginTop: 6 }]}>
              No stage changes recorded.
            </Text>
          ) : (
            events.map((e) => (
              <View key={e.id} style={styles.row}>
                <Text style={styles.colStage}>
                  {e.from_stage === null
                    ? "Order dispatched"
                    : `Stage ${e.to_stage} — ${stageName(e.to_stage)}`}
                </Text>
                <Text style={styles.colDate}>{formatDateTime(e.created_at)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.footer} fixed>
          NR Industries — internal document. Not for external distribution.
        </Text>
      </Page>
    </Document>
  );
}
