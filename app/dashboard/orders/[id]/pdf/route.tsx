import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getOrder } from "@/lib/data/orders";
import { OrderSpecSheet } from "@/lib/pdf/OrderSpecSheet";
import type { OrderStageEvent } from "@/types/database.types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const [ctx, order, { data: events }] = await Promise.all([
    requireSession(),
    getOrder(id),
    supabase
      .from("order_stage_events")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!order) return new NextResponse("Not found", { status: 404 });


  const buffer = await renderToBuffer(
    <OrderSpecSheet
      order={order}
      events={(events ?? []) as OrderStageEvent[]}
      showPrice={ctx.can("price.view")}
      showDispatcher={ctx.isAdminTier}
      showAssignees={ctx.role !== "production"}
      generatedBy={ctx.name}
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
