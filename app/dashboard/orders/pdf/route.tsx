import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireSession } from "@/lib/auth/session";
import { getOrders } from "@/lib/data/orders";
import { OrdersReport } from "@/lib/pdf/OrdersReport";
import { groupingFor, istDay, periodBounds, periodContaining, type PeriodKind } from "@/lib/periods";

const KINDS: PeriodKind[] = ["all", "week", "month", "year"];

/**
 * "Download All Orders": every order the caller may see (RLS), optionally
 * limited to the week / month / year containing `at` (by punch date, IST),
 * grouped into sections (year→months, month→weeks, week→days, all→months).
 * The order-value column, totals and subtotals exist only for roles with
 * price.view — never for production.
 *
 *   /dashboard/orders/pdf?period=month&at=2026-10-05
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = (KINDS as string[]).includes(q.get("period") ?? "") ? (q.get("period") as PeriodKind) : "all";
  const atRaw = q.get("at") ?? "";
  const at = /^\d{4}-\d{2}-\d{2}$/.test(atRaw) && !Number.isNaN(Date.parse(atRaw)) ? atRaw : istDay(new Date());
  const period = periodContaining(kind, at);

  const [ctx, orders] = await Promise.all([requireSession(), getOrders(periodBounds(period))]);

  const grouping = groupingFor(kind);
  const byKey = new Map<string, { heading: string; orders: typeof orders }>();
  for (const o of orders) {
    const [key, heading] = grouping.label(o.created_at);
    if (!byKey.has(key)) byKey.set(key, { heading, orders: [] });
    byKey.get(key)!.orders.push(o);
  }
  const keys = [...byKey.keys()].sort().reverse(); // newest section first, like the rows
  const groups = keys.map((k) => byKey.get(k)!);
  const ordered = groups.flatMap((g) => g.orders);

  const scopeLabel =
    ctx.role === "marketing"
      ? "Your punched orders"
      : ctx.role === "production"
        ? "Orders assigned to you"
        : "All orders";

  const buffer = await renderToBuffer(
    <OrdersReport
      orders={ordered}
      groups={groups}
      showPuncher={ctx.isAdminTier || ctx.can("orders.dispatchReview")}
      showAssignees={ctx.role !== "production"}
      // Production never gets a value column, total or subtotal.
      showPrice={ctx.can("price.view")}
      scopeLabel={scopeLabel}
      periodLabel={period.label}
      generatedAt={new Date()}
    />,
  );

  const slug = kind === "all" ? "all" : `${kind}-${period.start}`;
  const filename = `nr-orders-${slug}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
