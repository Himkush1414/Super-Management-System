import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import { stageName, MAX_STAGE } from "@/lib/orders";
import { formatDate, formatDateTime, formatDay } from "@/lib/utils";
import { C, base, inr } from "./theme";
import { PdfHeader, PdfFooter } from "./Chrome";

const s = StyleSheet.create({
  stats: { flexDirection: "row", marginBottom: 16 },
  stat: {
    flex: 1,
    border: `0.75 solid ${C.rule}`,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 8,
  },
  statLabel: {
    fontSize: 6.8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: C.muted,
    marginBottom: 3,
  },
  statValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.ink },
  rowHead: {
    flexDirection: "row",
    backgroundColor: C.tint,
    borderBottom: `0.75 solid ${C.ink}`,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: "row",
    borderBottom: `0.5 solid ${C.rule}`,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  th: { fontSize: 6.6, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted },
  td: { fontSize: 8.2 },
  sub: { fontSize: 7, color: C.muted, marginTop: 1 },
  right: { textAlign: "right" },
  totals: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.ink,
  },
});

type Col = {
  key: string;
  label: string;
  width: number;
  right?: boolean;
  cell: (o: OrderRow) => { main: string; sub?: string };
};

export function OrdersReport({
  orders,
  showDispatcher,
  showAssignees,
  showPrice,
  generatedBy,
  scopeLabel,
}: {
  orders: OrderRow[];
  showDispatcher: boolean;
  showAssignees: boolean;
  showPrice: boolean;
  generatedBy: string;
  scopeLabel: string;
}) {
  const cols: Col[] = [
    { key: "ref", label: "Ref", width: 7, cell: (o) => ({ main: o.id.slice(0, 8).toUpperCase() }) },
    {
      key: "product",
      label: "Product / client",
      width: 22,
      cell: (o) => ({ main: o.product_name, sub: o.client_name }),
    },
    { key: "rating", label: "Rating", width: 12, cell: (o) => ({ main: o.transformer_rating || "—" }) },
    { key: "qty", label: "Qty", width: 5, right: true, cell: (o) => ({ main: String(o.quantity) }) },
    ...(showPrice
      ? [{ key: "value", label: "Value", width: 11, right: true, cell: (o: OrderRow) => ({ main: inr(o.price) }) }]
      : []),
    {
      key: "delivery",
      label: "Delivery",
      width: 9,
      cell: (o) => ({ main: formatDay(o.expected_delivery) }),
    },
    {
      key: "stage",
      label: "Stage",
      width: 14,
      cell: (o) => ({
        main: `${o.stage} — ${stageName(o.stage)}`,
        sub: o.status === "active" ? undefined : "Waiting on phone",
      }),
    },
    ...(showDispatcher
      ? [{ key: "by", label: "Dispatched by", width: 10, cell: (o: OrderRow) => ({ main: o.dispatcher?.full_name ?? "—" }) }]
      : []),
    ...(showAssignees
      ? [
          {
            key: "prod",
            label: "Production",
            width: 12,
            cell: (o: OrderRow) => ({ main: o.assignees.map((a) => a.full_name).join(", ") || "—" }),
          },
        ]
      : []),
    { key: "date", label: "Dispatched", width: 8, cell: (o) => ({ main: formatDate(o.created_at) }) },
  ];
  const totalWidth = cols.reduce((n, c) => n + c.width, 0);
  const w = (c: Col) => ({ width: `${(c.width / totalWidth) * 100}%` });

  const delivered = orders.filter((o) => o.stage >= MAX_STAGE).length;
  const waiting = orders.filter((o) => o.status !== "active").length;
  const totalValue = orders.reduce((n, o) => n + (o.price ?? 0), 0);

  const stats: [string, string][] = [
    ["Orders", String(orders.length)],
    ["In production", String(orders.length - delivered - waiting)],
    ["Awaiting phone", String(waiting)],
    ["Delivered", String(delivered)],
    ...(showPrice ? ([["Total value", inr(totalValue)]] as [string, string][]) : []),
  ];

  return (
    <Document title="Orders report" author="NR Industries">
      <Page size="A4" orientation="landscape" style={base.page}>
        <PdfHeader
          docType={`Orders report — ${scopeLabel}`}
          metaLines={[`Generated ${formatDateTime(new Date().toISOString())}`, `by ${generatedBy}`]}
        />

        <View style={s.stats}>
          {stats.map(([label, value], i) => (
            <View key={label} style={[s.stat, i === stats.length - 1 ? { marginRight: 0 } : {}]}>
              <Text style={s.statLabel}>{label}</Text>
              <Text style={s.statValue}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={s.rowHead} fixed>
          {cols.map((c) => (
            <Text key={c.key} style={[s.th, w(c), c.right ? s.right : {}]}>
              {c.label}
            </Text>
          ))}
        </View>

        {orders.length === 0 ? (
          <Text style={{ color: C.muted, marginTop: 10 }}>No orders.</Text>
        ) : (
          orders.map((o, i) => (
            <View
              key={o.id}
              style={[s.row, i % 2 === 1 ? { backgroundColor: "#FBFBFC" } : {}]}
              wrap={false}
            >
              {cols.map((c) => {
                const v = c.cell(o);
                return (
                  <View key={c.key} style={w(c)}>
                    <Text style={[s.td, c.right ? s.right : {}]}>{v.main}</Text>
                    {v.sub ? <Text style={s.sub}>{v.sub}</Text> : null}
                  </View>
                );
              })}
            </View>
          ))
        )}

        {showPrice && orders.length > 0 && (
          <View style={s.totals}>
            <Text>Total order value: {inr(totalValue)}</Text>
          </View>
        )}

        <PdfFooter />
      </Page>
    </Document>
  );
}
