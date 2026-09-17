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
  const ctx = await requireSession();
  const order = await getOrder(id);
  if (!order) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: events } = await supabase
    .from("order_stage_events")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: false });

  const showPrice = order.price !== null || ctx.can("price.view");
  const showParties = ctx.isAdminTier;

  const buffer = await renderToBuffer(
    <OrderSpecSheet
      order={order}
      events={(events ?? []) as OrderStageEvent[]}
      showPrice={showPrice}
      showParties={showParties}
      generatedBy={ctx.name}
    />,
  );

  const filename = `${order.product_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-spec-sheet.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
