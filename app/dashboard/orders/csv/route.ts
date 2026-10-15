import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOrders, type OrderRow } from "@/lib/data/orders";
import type { OrderItem } from "@/types/database.types";
import { MAX_STAGE, stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { GST_RATE, orderMoney, plainAmount, type OrderMoney } from "@/lib/money";
import { formatCsvDateTime, formatDay } from "@/lib/utils";

function csvField(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  // A typed-in cell starting with = + - @ would run as a formula in Excel /
  // Sheets. Free-text columns only — numbers go through untouched.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Line = { o: OrderRow; item: OrderItem; k: number; money: OrderMoney };
type Column = { header: string; value: (l: Line) => string | number | null };

/**
 * One row per PRODUCT (an order with three products is three rows, its order
 * fields repeated), one field per column — headers match the order form's
 * labels, nothing is combined into one cell. Per product row (lib/money.ts,
 * the same figures as the PDFs): unit price, additional amount (the order's
 * Additional Amount on its first product, 0.00 on the others), row subtotal
 * before GST, 18% GST and row total incl. GST — so summing any of these
 * columns never double-counts. The order's grand total is filled on its
 * FIRST product row only (blank on the others). Dates are DD/MM/YYYY like
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
          { header: "Unit price (INR)", value: ({ k, money }: Line) => plainAmount(money.rows[k].unit) },
          { header: "Additional amount (INR)", value: ({ k, money }: Line) => plainAmount(money.rows[k].additional) },
          { header: "Subtotal before GST (INR)", value: ({ k, money }: Line) => plainAmount(money.rows[k].base) },
          { header: `GST ${GST_RATE}% (INR)`, value: ({ k, money }: Line) => plainAmount(money.rows[k].gst) },
          { header: `Total (incl. ${GST_RATE}% GST) (INR)`, value: ({ k, money }: Line) => plainAmount(money.rows[k].total) },
          {
            header: `Order grand total (incl. ${GST_RATE}% GST) (INR, per order)`,
            value: ({ k, money }: Line) => (k === 0 ? plainAmount(money.grandTotal) : null),
          },
        ] satisfies Column[])
      : []),
    { header: "Expected delivery date", value: ({ o }) => (o.expected_delivery ? formatDay(o.expected_delivery) : "") },
    { header: "Current stage", value: ({ o }) => `${o.stage} of ${MAX_STAGE}` },
    { header: "Stage name", value: ({ o }) => stageName(o.stage) },
    { header: "Status", value: ({ o }) => ORDER_STATUS_LABEL[o.status] ?? o.status },
    ...(ctx.role !== "production"
      ? [{ header: "Production", value: ({ o }: Line) => o.assignees.map((a) => a.label).join("; ") } satisfies Column]
      : []),
    ...(ctx.isAdminTier
      ? [{ header: "Punched by", value: ({ o }: Line) => o.puncher?.label ?? "" } satisfies Column]
      : []),
    { header: "Punched at (IST)", value: ({ o }) => formatCsvDateTime(o.created_at) },
    { header: "Description", value: ({ item }) => item.description },
  ];

  const rows: Line[] = orders.flatMap((o) => {
    const money = orderMoney(o);
    return o.items.map((item, k) => ({ o, item, k, money }));
  });
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
