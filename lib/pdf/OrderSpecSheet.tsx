import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderStageEvent } from "@/types/database.types";
import type { OrderRow } from "@/lib/data/orders";
import { STAGES, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatDateTime, formatDay } from "@/lib/utils";
import { C, base, inr } from "./theme";
import { PdfHeader, PdfFooter } from "./Chrome";

const s = StyleSheet.create({
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 3 },
  subtitle: { fontSize: 10, color: C.muted, marginBottom: 16 },
  pillRow: { flexDirection: "row", marginBottom: 18 },
  pill: {
    fontSize: 7.5,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 8,
    marginRight: 6,
    border: `0.75 solid ${C.rule}`,
    color: C.body,
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    border: `0.75 solid ${C.rule}`,
    borderRadius: 6,
    marginBottom: 18,
  },
  fact: {
    width: "33.333%",
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderBottom: `0.75 solid ${C.rule}`,
  },
  factLabel: {
    fontSize: 6.8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: C.muted,
    marginBottom: 3,
  },
  factValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink },
  section: { marginBottom: 18 },
  description: {
    backgroundColor: C.tint,
    borderRadius: 6,
    padding: 11,
    fontSize: 9.5,
    lineHeight: 1.5,
  },
  rail: { flexDirection: "row", marginBottom: 6 },
  railStep: { flex: 1, marginRight: 4 },
  railBar: { height: 4, borderRadius: 2, marginBottom: 5 },
  railLabel: { fontSize: 7, color: C.muted },
  rowHead: {
    flexDirection: "row",
    borderBottom: `0.75 solid ${C.ink}`,
    paddingBottom: 5,
    marginBottom: 1,
  },
  row: { flexDirection: "row", borderBottom: `0.5 solid ${C.rule}`, paddingVertical: 6 },
  th: { fontSize: 6.8, textTransform: "uppercase", letterSpacing: 0.6, color: C.muted },
  colWhat: { width: "60%" },
  colWhen: { width: "40%", textAlign: "right" },
});

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

export function OrderSpecSheet({
  order,
  events,
  showPrice,
  showDispatcher,
  showAssignees,
  generatedBy,
}: {
  order: OrderRow;
  events: OrderStageEvent[];
  showPrice: boolean;
  showDispatcher: boolean;
  showAssignees: boolean;
  generatedBy: string;
}) {
  const facts: [string, string][] = [
    ["Client", order.client_name || "—"],
    ["Transformer rating", order.transformer_rating || "—"],
    ["Quantity", String(order.quantity)],
    ...(showPrice ? ([["Order value", inr(order.price)]] as [string, string][]) : []),
    ["Expected delivery", formatDay(order.expected_delivery)],
    ["Dispatched", formatDateTime(order.created_at)],
    ...(showDispatcher
      ? ([["Dispatched by", order.dispatcher?.label ?? "—"]] as [string, string][])
      : []),
    ...(showAssignees
      ? ([["Production", order.assignees.map((a) => a.label).join(", ") || "—"]] as [
          string,
          string,
        ][])
      : []),
  ];

  return (
    <Document title={`${order.product_name} — Order specification`} author="NR Industries">
      <Page size="A4" style={base.page}>
        <PdfHeader
          docType="Order specification"
          metaLines={[
            `Ref ${order.id.slice(0, 8).toUpperCase()}`,
            `Generated ${formatDateTime(new Date().toISOString())}`,
            `by ${generatedBy}`,
          ]}
        />

        <Text style={s.title}>{order.product_name}</Text>
        <Text style={s.subtitle}>
          {[order.client_name, order.transformer_rating].filter(Boolean).join("  ·  ")}
        </Text>

        <View style={s.pillRow}>
          <Text style={[s.pill, { color: C.accent, borderColor: C.accent }]}>
            Stage {order.stage} — {stageName(order.stage)}
          </Text>
          <Text
            style={[
              s.pill,
              order.status === "active"
                ? { color: C.success, borderColor: C.success }
                : { color: C.warning, borderColor: C.warning },
            ]}
          >
            {ORDER_STATUS_LABEL[order.status] ?? order.status}
          </Text>
        </View>

        <View style={s.facts}>
          {facts.map(([label, value]) => (
            <Fact key={label} label={label} value={value} />
          ))}
        </View>

        {order.description ? (
          <View style={s.section}>
            <Text style={base.sectionTitle}>Description</Text>
            <Text style={s.description}>{order.description}</Text>
          </View>
        ) : null}

        <View style={s.section} wrap={false}>
          <Text style={base.sectionTitle}>Progress</Text>
          <View style={s.rail}>
            {STAGES.map((st) => (
              <View key={st.n} style={s.railStep}>
                <View
                  style={[
                    s.railBar,
                    {
                      backgroundColor:
                        st.n < order.stage ? C.success : st.n === order.stage ? C.accent : C.rule,
                    },
                  ]}
                />
                <Text style={[s.railLabel, st.n === order.stage ? { color: C.ink } : {}]}>
                  {st.n}. {st.name}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.section}>
          <Text style={base.sectionTitle}>Stage history</Text>
          <View style={s.rowHead}>
            <Text style={[s.th, s.colWhat]}>Event</Text>
            <Text style={[s.th, s.colWhen]}>When</Text>
          </View>
          {events.length === 0 ? (
            <Text style={{ color: C.muted, marginTop: 6 }}>No stage changes recorded.</Text>
          ) : (
            events.map((e) => (
              <View key={e.id} style={s.row} wrap={false}>
                <Text style={s.colWhat}>
                  {e.from_stage === null
                    ? "Order dispatched"
                    : `Stage ${e.to_stage} — ${stageName(e.to_stage)}`}
                </Text>
                <Text style={s.colWhen}>{formatDateTime(e.created_at)}</Text>
              </View>
            ))
          )}
        </View>

        <PdfFooter />
      </Page>
    </Document>
  );
}
