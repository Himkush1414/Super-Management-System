import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOrders, type OrderRow } from "@/lib/data/orders";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatCsvDateTime, formatDay } from "@/lib/utils";

function csvField(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  // A typed-in cell starting with = + - @ would run as a formula in Excel /
  // Sheets. Free-text columns only — numbers go through untouched.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Column = { header: string; value: (o: OrderRow) => string | number | null };

/**
 * One row per order, one field per column — headers match the order form's
 * labels, nothing is combined into one cell. Dates are DD/MM/YYYY like the
 * rest of the system (timestamps in IST as DD/MM/YYYY HH:MM). Production gets no
 * order-value column at all.
 */
export async function GET() {
  const [ctx, orders] = await Promise.all([requireSession(), getOrders()]);

  const columns: Column[] = [
    { header: "Order ID", value: (o) => o.id },
    { header: "Product name", value: (o) => o.product_name },
    { header: "Client name", value: (o) => o.client_name },
    { header: "Transformer rating", value: (o) => o.transformer_rating },
    { header: "Quantity", value: (o) => o.quantity },
    ...(ctx.can("price.view")
      ? [{ header: "Order value (INR)", value: (o: OrderRow) => o.price } satisfies Column]
      : []),
    { header: "Expected delivery date", value: (o) => (o.expected_delivery ? formatDay(o.expected_delivery) : "") },
    { header: "Current stage", value: (o) => `${o.stage} of ${MAX_STAGE}` },
    { header: "Stage name", value: (o) => stageName(o.stage) },
    { header: "Status", value: (o) => ORDER_STATUS_LABEL[o.status] ?? o.status },
    ...(ctx.role !== "production"
      ? [{ header: "Production", value: (o: OrderRow) => o.assignees.map((a) => a.label).join("; ") } satisfies Column]
      : []),
    ...(ctx.isAdminTier
      ? [{ header: "Dispatched by", value: (o: OrderRow) => o.dispatcher?.label ?? "" } satisfies Column]
      : []),
    { header: "Dispatched at (IST)", value: (o) => formatCsvDateTime(o.created_at) },
    { header: "Description", value: (o) => o.description },
  ];

  const lines = [
    columns.map((c) => csvField(c.header)).join(","),
    ...orders.map((o) => columns.map((c) => csvField(c.value(o))).join(",")),
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
