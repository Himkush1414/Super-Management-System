import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatDateTime, formatDay } from "@/lib/utils";
import { C, base, inr } from "./theme";
import { PdfHeader, PdfFooter } from "./Chrome";

export type AccountExport = {
  account: { username: string; role: string; display_name: string };
  orders: {
    id: string;
    product_name: string;
    client_name: string;
    transformer_rating: string;
    quantity: number;
    price: number | null;
    expected_delivery: string | null;
    description: string;
    stage: number;
    status: string;
    created_at: string;
    dispatched_by: string;
    production: string[];
  }[];
  stage_updates: {
    id: string;
    order_product: string | null;
    order_client: string | null;
    from_stage: number;
    to_stage: number;
    created_at: string;
  }[];
  notifications: { title: string; body: string; read: boolean; created_at: string }[];
};

const s = StyleSheet.create({
  section: { marginBottom: 16 },
  h: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.navy, marginBottom: 6 },
  none: { fontSize: 9, color: C.muted },
  row: { flexDirection: "row" },
  cell: {
    paddingVertical: 4.5,
    paddingHorizontal: 5,
    borderRight: `0.75 solid ${C.rule}`,
    borderBottom: `0.75 solid ${C.rule}`,
    fontSize: 7.8,
    color: C.ink,
  },
  head: { backgroundColor: C.head, fontFamily: "Helvetica-Bold", fontSize: 7.2, color: C.navy },
  first: { borderLeft: `0.75 solid ${C.rule}` },
  top: { borderTop: `0.75 solid ${C.rule}` },
  right: { textAlign: "right" },
});

type Col<T> = { label: string; width: number; right?: boolean; cell: (r: T) => string };

/** A ruled table: one value per cell, header repeated on each page. */
function Grid<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  const total = cols.reduce((n, c) => n + c.width, 0);
  const w = (c: Col<T>) => ({ width: `${(c.width / total) * 100}%` });
  return (
    <View>
      <View style={s.row} fixed>
        {cols.map((c, i) => (
          <Text key={c.label} style={[s.cell, s.head, s.top, w(c), c.right ? s.right : {}, i === 0 ? s.first : {}]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.row, ri % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
          {cols.map((c, i) => (
            <Text key={c.label} style={[s.cell, w(c), c.right ? s.right : {}, i === 0 ? s.first : {}]}>
              {c.cell(r)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Everything an account reset is about to delete, as a readable archive the
 * admin downloads first. Admin-only document, so order values are included.
 */
export function AccountArchive({ data, generatedAt }: { data: AccountExport; generatedAt: Date }) {
  type O = AccountExport["orders"][number];
  type E = AccountExport["stage_updates"][number];
  type N = AccountExport["notifications"][number];

  const summary: [string, string][] = [
    ["Account", data.account.display_name],
    ["Username", data.account.username],
    ["Orders", String(data.orders.length)],
    ["Stage updates", String(data.stage_updates.length)],
    ["Notifications", String(data.notifications.length)],
  ];

  return (
    <Document title={`Data archive — ${data.account.display_name}`} author="NR Industries">
      <Page size="A4" orientation="landscape" style={base.page}>
        <PdfHeader title="Account Data Archive" subtitle={data.account.display_name} generatedAt={generatedAt} />

        <View style={s.section}>
          <Grid<[string, string]>
            cols={[
              { label: "Field", width: 1, cell: (r) => r[0] },
              { label: "Value", width: 3, cell: (r) => r[1] },
            ]}
            rows={summary}
          />
        </View>

        <View style={s.section}>
          <Text style={s.h}>Orders</Text>
          {data.orders.length === 0 ? (
            <Text style={s.none}>None included.</Text>
          ) : (
            <Grid<O>
              cols={[
                { label: "Product name", width: 12, cell: (o) => o.product_name },
                { label: "Client name", width: 10, cell: (o) => o.client_name || "—" },
                { label: "Transformer rating", width: 9, cell: (o) => o.transformer_rating || "—" },
                { label: "Qty", width: 4, right: true, cell: (o) => String(o.quantity) },
                { label: "Order value", width: 11, right: true, cell: (o) => inr(o.price) },
                { label: "Expected delivery", width: 9, cell: (o) => formatDay(o.expected_delivery) },
                { label: "Current stage", width: 9, cell: (o) => `Stage ${o.stage} of ${MAX_STAGE}` },
                { label: "Status", width: 7, cell: (o) => (o.status === "active" ? "Active" : ORDER_STATUS_LABEL[o.status] ?? o.status) },
                { label: "Production", width: 12, cell: (o) => o.production.join(", ") || "—" },
                { label: "Punched by", width: 11, cell: (o) => o.dispatched_by || "—" },
                { label: "Punched on", width: 10, cell: (o) => formatDateTime(o.created_at) },
                { label: "Description", width: 13, cell: (o) => o.description || "—" },
              ]}
              rows={data.orders}
            />
          )}
        </View>

        {data.account.role === "production" && (
          <View style={s.section}>
            <Text style={s.h}>Stage updates made</Text>
            {data.stage_updates.length === 0 ? (
              <Text style={s.none}>None included.</Text>
            ) : (
              <Grid<E>
                cols={[
                  { label: "Order", width: 14, cell: (e) => e.order_product ?? "—" },
                  { label: "Client name", width: 12, cell: (e) => e.order_client || "—" },
                  { label: "From stage", width: 10, cell: (e) => `Stage ${e.from_stage} — ${stageName(e.from_stage)}` },
                  { label: "To stage", width: 10, cell: (e) => `Stage ${e.to_stage} — ${stageName(e.to_stage)}` },
                  { label: "When", width: 9, cell: (e) => formatDateTime(e.created_at) },
                ]}
                rows={data.stage_updates}
              />
            )}
          </View>
        )}

        <View style={s.section}>
          <Text style={s.h}>Notifications</Text>
          {data.notifications.length === 0 ? (
            <Text style={s.none}>None included.</Text>
          ) : (
            <Grid<N>
              cols={[
                { label: "Title", width: 12, cell: (n) => n.title },
                { label: "Message", width: 26, cell: (n) => n.body || "—" },
                { label: "Read", width: 4, cell: (n) => (n.read ? "Yes" : "No") },
                { label: "When", width: 9, cell: (n) => formatDateTime(n.created_at) },
              ]}
              rows={data.notifications}
            />
          )}
        </View>
        <PdfFooter />
      </Page>
    </Document>
  );
}
