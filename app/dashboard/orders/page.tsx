import Link from "next/link";
import { Package, Plus, FileDown, FileSpreadsheet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getOrders, type OrderRow } from "@/lib/data/orders";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { StatCard } from "@/components/ui/Card";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { StageTracker } from "@/components/dashboard/StageTracker";
import { OrdersTable } from "@/components/dashboard/OrdersTable";
import { OrderStatusBadge } from "@/components/shared/Badge";
import { formatDay } from "@/lib/utils";
import { stageName } from "@/lib/orders";

export const metadata = { title: "Orders" };

const exportLink =
  "nr-interactive inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-elevated px-3 text-[13px] font-medium text-text hover:border-border-strong hover:bg-panel-2";

export default async function OrdersPage() {
  const [ctx, orders] = await Promise.all([requireSession(), getOrders()]);

  if (ctx.role === "production") return <ProductionView orders={orders} userId={ctx.userId} />;

  const isMarketing = ctx.role === "marketing";
  const stats = {
    total: orders.length,
    active: orders.filter((o) => o.status === "active" && o.stage < 5).length,
    waiting: orders.filter((o) => o.status === "waiting_on_production_phone").length,
    delivered: orders.filter((o) => o.stage >= 5).length,
  };

  return (
    <>
      <LiveRefresh channel="orders-list" tables={[{ table: "orders" }]} />
      <PageHeader
        title={isMarketing ? "Your orders" : "Orders"}
        description={
          isMarketing
            ? "Everything you've dispatched. Only you and administrators can see these."
            : "Every order dispatched by marketing and its production progress."
        }
        action={
          <div className="flex items-center gap-2">
            {orders.length > 0 && (
              <>
                <a
                  href="/dashboard/orders/csv"
                  download
                  className={exportLink}
                  aria-label="Export CSV"
                  title="Export CSV"
                >
                  <FileSpreadsheet size={14} />
                  <span className="hidden sm:inline">Export CSV</span>
                  <span className="sm:hidden">CSV</span>
                </a>
                <a
                  href="/dashboard/orders/pdf"
                  download
                  className={exportLink}
                  aria-label="Export PDF"
                  title="Export PDF"
                >
                  <FileDown size={14} />
                  <span className="hidden sm:inline">Export PDF</span>
                  <span className="sm:hidden">PDF</span>
                </a>
              </>
            )}
            {isMarketing && (
              <Link
                href="/dashboard/orders/new"
                className="nr-interactive nr-press ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover sm:ml-0"
              >
                <Plus size={15} /> Dispatch order
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="In production" value={stats.active} />
        <StatCard label="Awaiting phone" value={stats.waiting} />
        <StatCard label="Completed" value={stats.delivered} />
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<Package size={22} />}
          title="No orders yet"
          description={
            isMarketing
              ? "Dispatch your first order to send it to a production team."
              : "Marketing hasn't dispatched anything yet."
          }
          action={
            isMarketing ? (
              <Link
                href="/dashboard/orders/new"
                className="nr-interactive nr-press inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
              >
                <Plus size={15} /> Dispatch order
              </Link>
            ) : null
          }
        />
      ) : (
        <OrdersTable
          orders={orders}
          showDispatcher={!isMarketing}
          showPrice={ctx.can("price.view")}
        />
      )}
    </>
  );
}

/* ── production: deliberately minimal (they mostly work via WhatsApp) ── */
function ProductionView({ orders, userId }: { orders: OrderRow[]; userId: string }) {
  return (
    <>
      <LiveRefresh
        channel="orders-list-prod"
        tables={[
          { table: "orders" },
          // a new assignment is what makes a new order visible to production
          { table: "order_assignees", filter: `profile_id=eq.${userId}` },
        ]}
      />
      <PageHeader
        title="Assigned orders"
        description="Orders sent to you. Open one to advance its stage."
      />
      {orders.length === 0 ? (
        <EmptyState
          icon={<Package size={22} />}
          title="Nothing assigned yet"
          description="You'll see an order here when marketing sends one to you."
        />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/orders/${o.id}`}
              className="nr-interactive nr-lift block rounded-xl border border-border bg-panel/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{o.product_name}</p>
                  <p className="mt-0.5 text-[13px] text-text-secondary">
                    {o.client_name}
                    {o.transformer_rating ? ` · ${o.transformer_rating}` : ""}
                    {` · Qty ${o.quantity}`}
                  </p>
                  {o.expected_delivery && (
                    <p className="mt-0.5 text-[12px] text-text-tertiary">
                      Expected delivery {formatDay(o.expected_delivery)}
                    </p>
                  )}
                </div>
                <OrderStatusBadge status={o.status} />
              </div>
              <div className="mt-3.5 flex items-center justify-between gap-3 text-[12px]">
                <span className="text-text-secondary">
                  Stage {o.stage} of 5 · <span className="text-text">{stageName(o.stage)}</span>
                </span>
              </div>
              <div className="mt-2">
                <StageTracker stage={o.stage} compact />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
