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
      showDispatcher={ctx.isAdminTier}
      showAssignees={ctx.role !== "production"}
      // Production never gets a value column, not even an empty one.
      showPrice={ctx.can("price.view")}
      generatedBy={ctx.name}
      scopeLabel={scopeLabel}
    />,
  );

  const filename = `nr-orders-report-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
