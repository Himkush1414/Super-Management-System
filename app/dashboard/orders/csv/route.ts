import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOrders, type OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import { GST_PERCENT, MAX_STAGE, stageLabel, ORDER_STATUS_LABEL, itemTotal, orderAmounts } from "@/lib/orders";
import { formatCsvDateTime, formatDay } from "@/lib/utils";

function csvField(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  // A typed-in cell starting with = + - @ would run as a formula in Excel /
  // Sheets. Free-text columns only — numbers go through untouched.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Line = { o: OrderRow; item: OrderItem };
type Column = { header: string; value: (l: Line) => string | number | null };

/**
 * One row per PRODUCT (an order with three products is three rows, its order
 * fields repeated), one field per column — headers match the order form's
 * labels, nothing is combined into one cell. Per product: price, 18% GST and
 * price + GST. The order-level Additional Amount and Order subtotal are
 * filled on the order's FIRST product row only (blank on the others), so
 * summing any money column never double-counts. Dates are DD/MM/YYYY like
 * the rest of the system (timestamps in IST as DD/MM/YYYY HH:MM). Production
 * gets no money column at all.
 */
export async function GET() {
  const [ctx, orders] = await Promise.all([requireSession(), getOrders()]);

  const columns: Column[] = [
    { header: "Order ID", value: ({ o }) => o.id },
    { header: "Product no.", value: ({ o, item }) => `${item.position} of ${o.items.length}` },
    { header: "Product name", value: ({ item }) => item.product_name },
    { header: "Client name", value: ({ o }) => o.client_name },
    { header: "Ship To", value: ({ o }) => o.ship_to },
    { header: "Transformer rating", value: ({ item }) => item.transformer_rating },
    { header: "Quantity", value: ({ item }) => item.quantity },
    ...(ctx.can("price.view")
      ? ([
          { header: "Price (INR)", value: ({ item }: Line) => item.price },
          { header: `GST ${GST_PERCENT}% (INR)`, value: ({ item }: Line) => item.gst },
          { header: `Total incl. ${GST_PERCENT}% GST (INR)`, value: ({ item }: Line) => itemTotal(item) },
          {
            header: "Additional Amount (INR, per order)",
            value: ({ o, item }: Line) => (item.position === o.items[0]?.position ? orderAmounts(o).additional : null),
          },
          {
            header: `Order subtotal (INR, incl. ${GST_PERCENT}% GST + Additional Amount, per order)`,
            value: ({ o, item }: Line) => (item.position === o.items[0]?.position ? orderAmounts(o).subtotal : null),
          },
        ] satisfies Column[])
      : []),
    { header: "Expected delivery date", value: ({ o }) => (o.expected_delivery ? formatDay(o.expected_delivery) : "") },
    { header: "Current stage", value: ({ o }) => `${o.stage} of ${MAX_STAGE}` },
    { header: "Stage name", value: ({ o }) => stageLabel(o) },
    { header: "Status", value: ({ o }) => ORDER_STATUS_LABEL[o.status] ?? o.status },
    ...(ctx.role !== "production"
      ? [{ header: "Production", value: ({ o }: Line) => o.assignees.map((a) => a.label).join("; ") } satisfies Column]
      : []),
    ...(ctx.isAdminTier || ctx.can("orders.dispatchReview")
      ? [{ header: "Punched by", value: ({ o }: Line) => o.puncher?.label ?? "" } satisfies Column]
      : []),
    { header: "Punched at (IST)", value: ({ o }) => formatCsvDateTime(o.created_at) },
    { header: "Description", value: ({ item }) => item.description },
  ];

  const rows: Line[] = orders.flatMap((o) => o.items.map((item) => ({ o, item })));
  const lines = [
    columns.map((c) => csvField(c.header)).join(","),
    ...rows.map((l) => columns.map((c) => csvField(c.value(l))).join(",")),
  ];
  // BOM so Excel opens the non-ASCII text as UTF-8.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  const filename = `nr-orders-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
