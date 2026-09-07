import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getOrders, type OrderRow } from "@/lib/data/orders";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { StatCard } from "@/components/ui/Card";
import { Table, THead, TR, TH, TD } from "@/components/ui/Table";
import { StageBadge, OrderStatusBadge } from "@/components/shared/Badge";
import { Button } from "@/components/ui/Button";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { StageTracker } from "@/components/dashboard/StageTracker";
import { formatCurrency, formatDate } from "@/lib/utils";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const ctx = await requireSession();
  const orders = await getOrders();

  if (ctx.role === "production") return <ProductionView orders={orders} />;

  const isMarketing = ctx.role === "marketing";
  const stats = {
    total: orders.length,
    active: orders.filter((o) => o.status === "active" && o.stage < 5).length,
    waiting: orders.filter((o) => o.status === "waiting_on_production_phone").length,
    delivered: orders.filter((o) => o.stage >= 5).length,
  };

  return (
    <>
      <LiveRefresh channel="orders-list" table="orders" />
      <PageHeader
        title={isMarketing ? "Your orders" : "Orders"}
        description={
          isMarketing
            ? "Everything you've dispatched. Only you and administrators can see these."
            : "Every order dispatched by marketing and its production progress."
        }
        action={
          isMarketing ? (
            <Link href="/dashboard/orders/new">
              <Button size="sm">
                <Plus size={15} /> Dispatch order
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="In production" value={stats.active} />
        <StatCard label="Awaiting phone" value={stats.waiting} />
        <StatCard label="Delivered" value={stats.delivered} />
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
              <Link href="/dashboard/orders/new">
                <Button size="sm">
                  <Plus size={15} /> Dispatch order
                </Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              {!isMarketing && <TH>Dispatched by</TH>}
              <TH>Production</TH>
              <TH numeric>Qty</TH>
              <TH>Stage</TH>
              <TH numeric>Price</TH>
              <TH>Status</TH>
              <TH numeric>Date</TH>
            </TR>
          </THead>
          <tbody>
            {orders.map((o) => (
              <TR key={o.id} className="cursor-pointer">
                <TD>
                  <Link
                    href={`/dashboard/orders/${o.id}`}
                    className="font-medium text-text hover:text-accent"
                  >
                    {o.product_name}
                  </Link>
                  {o.power_type && (
                    <span className="block text-[12px] text-text-tertiary">
                      {o.power_type}
                    </span>
                  )}
                </TD>
                {!isMarketing && (
                  <TD className="text-text-secondary">
                    {o.dispatcher?.full_name ?? "—"}
                  </TD>
                )}
                <TD className="text-text-secondary">
                  {o.assignee?.full_name ?? "—"}
                </TD>
                <TD numeric>{o.quantity}</TD>
                <TD>
                  <StageBadge stage={o.stage} />
                </TD>
                <TD numeric>{formatCurrency(o.price)}</TD>
                <TD>
                  <OrderStatusBadge status={o.status} />
                </TD>
                <TD numeric className="text-text-tertiary">
                  {formatDate(o.created_at)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

/* ── production: deliberately minimal (they mostly work via WhatsApp) ── */
function ProductionView({ orders }: { orders: OrderRow[] }) {
  return (
    <>
      <LiveRefresh channel="orders-list-prod" table="orders" />
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
                    Qty {o.quantity}
                    {o.power_type ? ` · ${o.power_type}` : ""}
                    {o.quality ? ` · ${o.quality}` : ""}
                  </p>
                </div>
                <OrderStatusBadge status={o.status} />
              </div>
              <div className="mt-3">
                <StageTracker stage={o.stage} compact />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
