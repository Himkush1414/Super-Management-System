import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { GST_RATE, formatAmount, orderMoney, type RowMoney } from "@/lib/money";
import { formatDateTime, formatDay } from "@/lib/utils";
import { C, base } from "./theme";
import { PdfHeader, PdfFooter } from "./Chrome";
import { fitWords } from "./fit";

/** The landscape A4 line between the page margins, in points. */
const LINE = 841.89 - 2 * 36;

export type AccountExport = {
  account: { username: string; role: string; display_name: string };
  orders: {
    id: string;
    product_name: string;
    client_name: string;
    /** 0021+ */
    ship_to?: string;
    transformer_rating: string;
    quantity: number;
    price: number | null;
    /** 0021+: the order's Additional Amount (older orders: their FEAT amounts) */
    additional_amount?: number | null;
    expected_delivery: string | null;
    description: string;
    stage: number;
    status: string;
    created_at: string;
    /** the punching marketing account (JSON key kept from before the rename) */
    dispatched_by: string;
    production: string[];
    /** 0019+: the order's products (orders exported before then have none) */
    items?: {
      position: number;
      product_name: string;
      transformer_rating: string;
      quantity: number;
      price: number | null;
      /** 0021+: 18% GST on price */
      gst?: number | null;
      /** 0020+: the product's own extra amount (orders punched before 0021) */
      feat?: number | null;
      description: string;
    }[];
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
  // the 16-column orders table: slightly smaller so nothing crosses a rule
  cellCompact: { paddingHorizontal: 4, fontSize: 7 },
  headCompact: { fontSize: 6.6 },
  first: { borderLeft: `0.75 solid ${C.rule}` },
  top: { borderTop: `0.75 solid ${C.rule}` },
  right: { textAlign: "right" },
});

type Col<T> = { label: string; width: number; right?: boolean; cell: (r: T) => string };

/** A ruled table: one value per cell, header repeated on each page. */
function Grid<T>({ cols, rows, compact }: { cols: Col<T>[]; rows: T[]; compact?: boolean }) {
  const total = cols.reduce((n, c) => n + c.width, 0);
  const w = (c: Col<T>) => ({ width: `${(c.width / total) * 100}%` });
  const cell = compact ? [s.cell, s.cellCompact] : [s.cell];
  const head = compact ? [s.head, s.headCompact] : [s.head];
  // a word wider than its column is hyphenated instead of crossing the rule
  const fit = (text: string, c: Col<T>) =>
    fitWords(text, (c.width / total) * LINE - 2 * (compact ? 4 : 5) - 0.5, compact ? 7 : 7.8);
  return (
    <View>
      <View style={s.row} fixed>
        {cols.map((c, i) => (
          <Text key={c.label} style={[...cell, ...head, s.top, w(c), c.right ? s.right : {}, i === 0 ? s.first : {}]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.row, ri % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
          {cols.map((c, i) => (
            <Text key={c.label} style={[...cell, w(c), c.right ? s.right : {}, i === 0 ? s.first : {}]}>
              {fit(c.cell(r), c)}
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
  // One row per product (order fields repeated), like the CSV export. Its
  // money is that product's row in lib/money.ts — the same figures as the
  // order PDFs (the Additional Amount on the order's first product).
  type P = O & { line: string; item: NonNullable<O["items"]>[number]; money: RowMoney };
  const productRows: P[] = data.orders.flatMap((o) => {
    const items = o.items?.length
      ? o.items
      : [{ position: 1, product_name: o.product_name, transformer_rating: o.transformer_rating,
           quantity: o.quantity, price: o.price, gst: null, description: o.description }];
    const money = orderMoney({ items, additional_amount: o.additional_amount ?? null });
    return items.map((item, k) => ({ ...o, item, money: money.rows[k], line: `${item.position} of ${items.length}` }));
  });
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
            <Grid<P>
              compact
              // widths in points of the 770pt line; amounts are bare numbers
              // under "(INR)" headers: one line up to ₹1 crore
              cols={[
                { label: "Product name", width: 60, cell: (r) => r.item.product_name },
                { label: "No.", width: 26, cell: (r) => r.line },
                { label: "Client name", width: 52, cell: (r) => r.client_name || "—" },
                { label: "Ship To", width: 56, cell: (r) => r.ship_to || "—" },
                { label: "Transformer rating", width: 54, cell: (r) => r.item.transformer_rating || "—" },
                { label: "Qty", width: 26, right: true, cell: (r) => String(r.item.quantity) },
                { label: "Unit price (INR)", width: 50, right: true, cell: (r) => formatAmount(r.money.unit) },
                { label: "Additional amount (INR)", width: 50, right: true, cell: (r) => formatAmount(r.money.additional) },
                {
                  label: `Total (incl. ${GST_RATE}% GST) (INR)`,
                  width: 52,
                  right: true,
                  cell: (r) => formatAmount(r.money.total),
                },
                { label: "Expected delivery", width: 44, cell: (r) => formatDay(r.expected_delivery) },
                { label: "Current stage", width: 46, cell: (r) => `Stage ${r.stage} of ${MAX_STAGE}` },
                { label: "Status", width: 42, cell: (r) => (r.status === "active" ? "Active" : ORDER_STATUS_LABEL[r.status] ?? r.status) },
                { label: "Production", width: 50, cell: (r) => r.production.join(", ") || "—" },
                { label: "Punched by", width: 46, cell: (r) => r.dispatched_by || "—" },
                { label: "Punched on", width: 50, cell: (r) => formatDateTime(r.created_at) },
                { label: "Description", width: 66, cell: (r) => r.item.description || "—" },
              ]}
              rows={productRows}
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
