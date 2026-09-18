import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireSession } from "@/lib/auth/session";
import { getOrders } from "@/lib/data/orders";
import { OrdersReport } from "@/lib/pdf/OrdersReport";

export async function GET() {
  const [ctx, orders] = await Promise.all([requireSession(), getOrders()]);

  const scopeLabel =
    ctx.role === "marketing"
      ? "Your dispatched orders"
      : ctx.role === "production"
        ? "Orders assigned to you"
        : "All orders";

  const buffer = await renderToBuffer(
    <OrdersReport
      orders={orders}
      showParties={ctx.role !== "marketing"}
      showPrice
      generatedBy={ctx.name}
      scopeLabel={scopeLabel}
    />,
  );

  const filename = `orders-report-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
