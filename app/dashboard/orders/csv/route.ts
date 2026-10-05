import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOrders } from "@/lib/data/orders";
import { stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatDateTime } from "@/lib/utils";

function csvField(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  // A typed-in cell starting with = + - @ would run as a formula in Excel /
  // Sheets. Free-text columns only — numbers go through untouched.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const [ctx, orders] = await Promise.all([requireSession(), getOrders()]);
  const showDispatcher = ctx.isAdminTier;
  const showAssignees = ctx.role !== "production";
  // Production never gets an order-value column — not even an empty one.
  const showPrice = ctx.can("price.view");

  const columns: { header: string; value: (o: (typeof orders)[number]) => string | number | null }[] = [
    { header: "Order ID", value: (o) => o.id.slice(0, 8) },
    { header: "Product", value: (o) => o.product_name },
    { header: "Client", value: (o) => o.client_name },
    { header: "Transformer rating", value: (o) => o.transformer_rating },
    { header: "Quantity", value: (o) => o.quantity },
    ...(showPrice ? [{ header: "Order value (INR)", value: (o: (typeof orders)[number]) => o.price }] : []),
    { header: "Expected delivery", value: (o) => o.expected_delivery },
    { header: "Stage", value: (o) => `${o.stage} — ${stageName(o.stage)}` },
    { header: "Status", value: (o) => ORDER_STATUS_LABEL[o.status] ?? o.status },
    ...(showDispatcher
      ? [{ header: "Dispatched by", value: (o: (typeof orders)[number]) => o.dispatcher?.label ?? "" }]
      : []),
    ...(showAssignees
      ? [{ header: "Production", value: (o: (typeof orders)[number]) => o.assignees.map((a) => a.label).join("; ") }]
      : []),
    { header: "Dispatched at", value: (o) => formatDateTime(o.created_at) },
    { header: "Description", value: (o) => o.description },
  ];

  const lines = [
    columns.map((c) => csvField(c.header)).join(","),
    ...orders.map((o) => columns.map((c) => csvField(c.value(o))).join(",")),
  ];
  // BOM so Excel opens the ₹ / non-ASCII text as UTF-8.
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
