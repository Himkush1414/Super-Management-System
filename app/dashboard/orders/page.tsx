import Link from "next/link";
import { Package, Plus, FileSpreadsheet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getOrders, type OrderRow } from "@/lib/data/orders";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { StatCard } from "@/components/ui/Card";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { StageTracker } from "@/components/dashboard/StageTracker";
import { OrdersTable } from "@/components/dashboard/OrdersTable";
import { BulkExport } from "@/components/dashboard/BulkExport";
import { istDay } from "@/lib/periods";
import { OrderStatusBadge } from "@/components/shared/Badge";
import { formatDay } from "@/lib/utils";
import { orderTitle, reviewStatus, stageLabel, stageName, totalQuantity } from "@/lib/orders";
import { cn } from "@/lib/utils";

export const metadata = { title: "Orders" };

const exportLink =
  "nr-interactive inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-elevated px-3 text-[13px] font-medium text-text hover:border-border-strong hover:bg-panel-2";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [ctx, orders, { tab }] = await Promise.all([requireSession(), getOrders(), searchParams]);

  if (ctx.role === "production") return <ProductionView orders={orders} userId={ctx.userId} />;
  if (ctx.can("orders.dispatchReview"))
    return <DispatcherView orders={orders} tab={tab === "dispatched" ? "dispatched" : "queue"} />;

  const isMarketing = ctx.role === "marketing";
  const stats = {
    total: orders.length,
    review: orders.filter((o) => o.stage === 1).length,
    active: orders.filter((o) => o.status === "active" && o.stage > 1 && o.stage < 5).length,
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
            ? "Everything you've punched. Only you and administrators can see these."
            : "Every order punched by marketing and its production progress."
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
                <BulkExport punchedAt={orders.map((o) => o.created_at)} today={istDay(new Date())} />
              </>
            )}
            {isMarketing && (
              <Link
                href="/dashboard/orders/new"
                className="nr-interactive nr-press ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover sm:ml-0"
              >
                <Plus size={15} /> Punch Order
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Dispatch review" value={stats.review} />
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
              ? "Punch your first order to send it to a production team."
              : "Marketing hasn't punched anything yet."
          }
          action={
            isMarketing ? (
              <Link
                href="/dashboard/orders/new"
                className="nr-interactive nr-press inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
              >
                <Plus size={15} /> Punch Order
              </Link>
            ) : null
          }
        />
      ) : (
        <OrdersTable
          orders={orders}
          showPuncher={!isMarketing}
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
                  <p className="font-medium">{orderTitle(o)}</p>
                  <p className="mt-0.5 text-[13px] text-text-secondary">
                    {[
                      o.client_name,
                      o.items.length > 1 ? `${o.items.length} products` : o.items[0]?.transformer_rating,
                      `Qty ${totalQuantity(o)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
                  {o.stage === 1 && <span> — waiting for a dispatcher</span>}
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

/* ── dispatchers: the Stage 1 queue, then everything already dispatched ── */
function DispatcherView({ orders, tab }: { orders: OrderRow[]; tab: "queue" | "dispatched" }) {
  // oldest first: the queue is worked in the order things were punched
  const queue = orders.filter((o) => o.stage === 1).reverse();
  const dispatched = orders.filter((o) => o.stage > 1);
  const tabLink = (t: "queue" | "dispatched", label: string, n: number) => (
    <Link
      href={t === "queue" ? "/dashboard/orders" : "/dashboard/orders?tab=dispatched"}
      className={cn(
        "nr-interactive inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium",
        tab === t ? "bg-elevated text-text" : "text-text-secondary hover:text-text",
      )}
      aria-current={tab === t ? "page" : undefined}
    >
      {label} <span className="tnum text-text-tertiary">{n}</span>
    </Link>
  );

  return (
    <>
      <LiveRefresh channel="orders-list-dispatch" tables={[{ table: "orders" }]} />
      <PageHeader
        title="Dispatch review"
        description="Every punched order starts here. Check its product details, then dispatch it to production."
        action={
          orders.length > 0 ? (
            <div className="flex items-center gap-2">
              <a href="/dashboard/orders/csv" download className={exportLink} aria-label="Export CSV" title="Export CSV">
                <FileSpreadsheet size={14} />
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sm:hidden">CSV</span>
              </a>
              <BulkExport punchedAt={orders.map((o) => o.created_at)} today={istDay(new Date())} />
            </div>
          ) : null
        }
      />
      <nav className="mb-4 flex gap-1" aria-label="Dispatch review">
        {tabLink("queue", "To dispatch", queue.length)}
        {tabLink("dispatched", "Dispatched", dispatched.length)}
      </nav>

      {tab === "dispatched" ? (
        dispatched.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title="Nothing dispatched yet" description="Orders you dispatch to production show up here." />
        ) : (
          <OrdersTable orders={dispatched} showPuncher showPrice={false} />
        )
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<Package size={22} />}
          title="Nothing to dispatch"
          description="New orders appear here as soon as marketing punches them."
        />
      ) : (
        <div className="space-y-3">
          {queue.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/orders/${o.id}`}
              className="nr-interactive nr-lift block rounded-xl border border-border bg-panel/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{orderTitle(o)}</p>
                  <p className="mt-0.5 text-[13px] text-text-secondary">
                    {[
                      o.client_name,
                      o.items.length > 1 ? `${o.items.length} products` : o.items[0]?.transformer_rating,
                      `Qty ${totalQuantity(o)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-0.5 text-[12px] text-text-tertiary">
                    {[
                      o.puncher ? `Punched by ${o.puncher.label}` : null,
                      o.assignees.length ? `→ ${o.assignees.map((a) => a.label).join(", ")}` : null,
                      o.expected_delivery ? `Delivery ${formatDay(o.expected_delivery)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {o.status !== "active" ? (
                  <OrderStatusBadge status={o.status} />
                ) : (
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
                      o.review_started_at
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border-strong text-text-secondary",
                    )}
                  >
                    {reviewStatus(o)}
                  </span>
                )}
              </div>
              <p className="mt-3 text-[12px] text-text-secondary">
                Stage 1 of 5 · <span className="text-text">{stageLabel(o)}</span>
                {o.reviewer && o.review_started_at ? ` — ${o.reviewer.label}` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
