import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOrders } from "@/lib/data/orders";
import { stageName, ORDER_STATUS_LABEL } from "@/lib/orders";
import { formatDateTime } from "@/lib/utils";

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const ctx = await requireSession();
  const orders = await getOrders();
  const showDispatcher = ctx.role !== "marketing";

  const headers = [
    "Product",
    ...(showDispatcher ? ["Dispatched by"] : []),
    "Production",
    "Quantity",
    "Quality",
    "Power / type",
    "Stage",
    "Price",
    "Status",
    "Dispatched at",
  ];

  const rows = orders.map((o) =>
    [
      o.product_name,
      ...(showDispatcher ? [o.dispatcher?.full_name ?? ""] : []),
      o.assignee?.full_name ?? "",
      o.quantity,
      o.quality,
      o.power_type,
      `${o.stage} — ${stageName(o.stage)}`,
      o.price ?? "",
      ORDER_STATUS_LABEL[o.status] ?? o.status,
      formatDateTime(o.created_at),
    ]
      .map(csvField)
      .join(","),
  );

  const csv = [headers.map(csvField).join(","), ...rows].join("\r\n") + "\r\n";
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
