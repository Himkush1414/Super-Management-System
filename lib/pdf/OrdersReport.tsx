import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OrderRow } from "@/lib/data/orders";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatDate, formatDay } from "@/lib/utils";
import { C, base, inr } from "./theme";
import { PdfHeader, PdfFooter, PdfSignature } from "./Chrome";

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
});

type Col = {
  key: string;
  label: string;
  width: number;
  align?: "right" | "center";
  cell: (o: OrderRow) => string;
  sub?: (o: OrderRow) => string | undefined;
};

/**
 * Column widths are relative; amounts and dates are sized to fit on one line
 * (react-pdf can't forbid wrapping). Every order as one table row, every field in its own ruled column — no
 * two values ever share a cell. Stage = current stage only. The order-value
 * column exists only when `showPrice` (never for production).
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
  const cols: Col[] = [
    { key: "n", label: "#", width: 2.8, align: "center", cell: () => "" },
    { key: "product", label: "Product name", width: 12, cell: (o) => o.product_name },
    { key: "client", label: "Client name", width: 10, cell: (o) => o.client_name || "—" },
    { key: "rating", label: "Transformer rating", width: 10, cell: (o) => o.transformer_rating || "—" },
    { key: "qty", label: "Qty", width: 4, align: "right", cell: (o) => String(o.quantity) },
    ...(showPrice
      ? [{ key: "value", label: "Order value", width: 13, align: "right" as const, cell: (o: OrderRow) => inr(o.price) }]
      : []),
    { key: "delivery", label: "Expected delivery", width: 9, cell: (o) => formatDay(o.expected_delivery) },
    {
      key: "stage",
      label: "Current stage",
      width: 9.5,
      cell: (o) => `Stage ${o.stage} of ${MAX_STAGE}`,
      sub: (o) => stageName(o.stage),
    },
    { key: "status", label: "Status", width: 7.5, cell: (o) => (o.status === "active" ? "Active" : ORDER_STATUS_LABEL[o.status] ?? o.status) },
    ...(showAssignees
      ? [{ key: "prod", label: "Production", width: 12, cell: (o: OrderRow) => o.assignees.map((a) => a.label).join(", ") || "—" }]
      : []),
    ...(showDispatcher
      ? [{ key: "by", label: "Punched by", width: 11, cell: (o: OrderRow) => o.dispatcher?.label ?? "—" }]
      : []),
    { key: "date", label: "Punched on", width: 9, cell: (o) => formatDate(o.created_at) },
    { key: "desc", label: "Description", width: 12, cell: (o) => o.description || "—" },
  ];
  const total = cols.reduce((n, c) => n + c.width, 0);
  const w = (c: Col) => ({ width: `${(c.width / total) * 100}%` });
  const align = (c: Col) => (c.align === "right" ? s.right : c.align === "center" ? s.center : {});
  const totalValue = orders.reduce((n, o) => n + (o.price ?? 0), 0);

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
          {showPrice && (
            <Text style={s.summaryItem}>
              Total order value: <Text style={s.bold}>{inr(totalValue)}</Text>
            </Text>
          )}
        </View>

        <View style={s.table}>
          <View style={s.row} fixed>
            {cols.map((c) => (
              <Text key={c.key} style={[s.cell, s.head, s.top, w(c), align(c), c.key === "n" ? s.first : {}]}>
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
                        ? ` · ${inr(g.orders.reduce((n, o) => n + (o.price ?? 0), 0))}`
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
                      wrap={false}
                    >
                      {cols.map((c) => (
                        <View key={c.key} style={[s.cell, w(c), c.key === "n" ? s.first : {}]}>
                          <Text style={align(c)}>{c.key === "n" ? String(i + 1) : c.cell(o)}</Text>
                          {c.sub ? <Text style={s.sub}>{c.sub(o)}</Text> : null}
                        </View>
                      ))}
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
