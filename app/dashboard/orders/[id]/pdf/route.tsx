import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireSession } from "@/lib/auth/session";
import { getOrder } from "@/lib/data/orders";
import { OrderSpecSheet } from "@/lib/pdf/OrderSpecSheet";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Only the current stage is printed, so no stage-history query.
  const [ctx, order] = await Promise.all([requireSession(), getOrder(id)]);
  if (!order) return new NextResponse("Not found", { status: 404 });

  const buffer = await renderToBuffer(
    <OrderSpecSheet
      order={order}
      showPrice={ctx.can("price.view")}
      showPuncher={ctx.isAdminTier}
      showAssignees={ctx.role !== "production"}
      generatedAt={new Date()}
    />,
  );

  const slug = order.product_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const filename = `${slug || "order"}-${order.id.slice(0, 8)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
