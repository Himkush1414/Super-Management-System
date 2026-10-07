import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileDown } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getOrder } from "@/lib/data/orders";
import { PageHeader } from "@/components/shared/Page";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { OrderStatusBadge, WhatsAppBadge } from "@/components/shared/Badge";
import { StageTracker } from "@/components/dashboard/StageTracker";
import { StageControl } from "@/components/dashboard/StageControl";
import { StageTimerBar } from "@/components/dashboard/StageTimerBar";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { DeleteButton } from "@/components/dashboard/DeleteButton";
import { GST_PERCENT, MAX_STAGE, itemTotal, orderAmounts, orderTitle, stageName, totalQuantity } from "@/lib/orders";
import { formatCurrency, formatDateTime, formatDay } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrder(id);
  return { title: order ? orderTitle(order) : "Order" };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // Everything in one parallel round. production_settings is RLS-scoped
  // (admin tier sees all, production only itself) and only shown to admins.
  const [ctx, order, { data: events }, { data: phones }] = await Promise.all([
    requireSession(),
    getOrder(id),
    supabase
      .from("order_stage_events")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("production_settings").select("profile_id, phone, confirmed_at"),
  ]);
  if (!order) notFound();

  const isAssignedProduction =
    ctx.role === "production" && order.assignee_ids.includes(ctx.userId);
  // Price follows the role rule, not "whatever the row happened to carry".
  const canSeePrice = ctx.can("price.view");
  const showDispatcher = ctx.isAdminTier;
  const showAssignees = ctx.role !== "production";
  // Admin tier advances any order, without the timer, after confirming.
  const canOverrideStage = ctx.can("orders.overrideStage");
  const amounts = orderAmounts(order);

  // Admin tier: which assigned members have a WhatsApp number on file.
  const phoneOf = new Map(
    (phones ?? [])
      .filter((p) => p.phone && p.confirmed_at)
      .map((p) => [p.profile_id as string, p.phone as string]),
  );

  return (
    <>
      <LiveRefresh
        channel={`order-${id}`}
        tables={[
          { table: "orders", filter: `id=eq.${id}` },
          { table: "order_stage_events", filter: `order_id=eq.${id}` },
        ]}
      />

      <Link
        href="/dashboard/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text"
      >
        <ArrowLeft size={14} /> Orders
      </Link>

      {isAssignedProduction && order.status === "active" && order.stage < MAX_STAGE && (
        <StageTimerBar stageReadyAt={order.stage_ready_at} nextStage={order.stage + 1} />
      )}

      <PageHeader
        title={orderTitle(order)}
        description={
          [
            order.client_name,
            order.items.length > 1 ? `${order.items.length} products` : order.items[0]?.transformer_rating,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        action={
          <div className="flex items-center gap-3">
            <OrderStatusBadge status={order.status} />
            <a href={`/dashboard/orders/${id}/pdf`} download>
              <Button variant="secondary" size="sm">
                <FileDown size={14} /> Download PDF
              </Button>
            </a>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Order details" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px] sm:grid-cols-3">
                <Field label="Client" value={order.client_name || "—"} />
                <Field label="Ship To" value={order.ship_to || "—"} wide />
                <Field label="Expected delivery" value={formatDay(order.expected_delivery)} />
                {canSeePrice && (
                  <Field label="Order subtotal" value={formatCurrency(amounts.subtotal)} />
                )}
                {canSeePrice && (
                  <Field label="Additional Amount" value={formatCurrency(amounts.additional)} />
                )}
                <Field
                  label="Products"
                  value={`${order.items.length} · ${totalQuantity(order)} unit${totalQuantity(order) === 1 ? "" : "s"}`}
                />
                <Field label="Punched" value={formatDateTime(order.created_at)} />
                {showDispatcher && (
                  <Field label="Punched by" value={order.dispatcher?.label ?? "—"} />
                )}
                {showAssignees && (
                  <Field
                    label="Production"
                    value={order.assignees.map((a) => a.label).join(", ") || "—"}
                  />
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Products"
              description={order.items.length === 1 ? "1 product" : `${order.items.length} products`}
            />
            <ol className="divide-y divide-border">
              {order.items.map((it) => (
                <li key={it.id} className="flex gap-3 px-5 py-4 text-[13px]">
                  <span className="mt-px w-5 shrink-0 text-text-tertiary tnum">{it.position}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-text">{it.product_name}</p>
                    <p className="mt-0.5 text-text-secondary">
                      {[it.transformer_rating, `Qty ${it.quantity}`].filter(Boolean).join(" · ")}
                    </p>
                    {it.description && (
                      <p className="mt-1.5 whitespace-pre-wrap text-text-tertiary">{it.description}</p>
                    )}
                  </div>
                  {canSeePrice && (
                    <div className="shrink-0 text-right">
                      <p className="font-medium tnum">{formatCurrency(itemTotal(it))}</p>
                      {it.price !== null && (
                        <p className="mt-0.5 text-[12px] text-text-tertiary tnum">
                          Price {formatCurrency(it.price)} + GST {GST_PERCENT}% {formatCurrency(it.gst)}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {canSeePrice && (
                <li className="space-y-1.5 px-5 py-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span className="pl-8 text-text-secondary">Products, including {GST_PERCENT}% GST</span>
                    <span className="tnum">{formatCurrency(amounts.products)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="pl-8 text-text-secondary">Additional Amount added</span>
                    <span className="tnum">
                      {amounts.additional === null ? "—" : `+ ${formatCurrency(amounts.additional)}`}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold">
                    <span className="pl-8">Order subtotal</span>
                    <span className="tnum">{formatCurrency(amounts.subtotal)}</span>
                  </div>
                </li>
              )}
            </ol>
          </Card>

          <Card>
            <CardHeader
              title="Progress"
              description={`Currently Stage ${order.stage} — ${stageName(order.stage)}`}
            />
            <CardBody className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
              <StageTracker stage={order.stage} />
              {(isAssignedProduction || canOverrideStage) && (
                <div className="rounded-lg border border-border bg-bg-subtle p-4">
                  <StageControl
                    orderId={order.id}
                    stage={order.stage}
                    waiting={order.status === "waiting_on_production_phone"}
                    stageReadyAt={order.stage_ready_at}
                    override={canOverrideStage}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="WhatsApp" />
            <CardBody className="space-y-2 text-[13px]">
              <WhatsAppBadge created={order.whatsapp_group_created} />
              <p className="text-[12px] text-text-tertiary">
                {order.whatsapp_group_created
                  ? "Group created — updates are posted there."
                  : "No WhatsApp Business API is connected yet. Stage updates are recorded here; group creation and messaging are pending that setup."}
              </p>
              {ctx.isAdminTier && order.assignees.length > 0 && (
                <ul className="space-y-1 pt-1 text-[12px]">
                  {order.assignees.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3">
                      <span className="text-text-secondary">{a.label}</span>
                      <span className={phoneOf.has(a.id) ? "tnum text-text-tertiary" : "text-status-warning"}>
                        {phoneOf.get(a.id) ?? "no number yet"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Stage history" />
            <CardBody className="space-y-3">
              {(events ?? []).length === 0 ? (
                <p className="text-[13px] text-text-tertiary">No changes yet.</p>
              ) : (
                (events ?? []).map((e) => (
                  <div key={e.id} className="flex gap-3 text-[13px]">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                    <div>
                      <p className="text-text">
                        {e.from_stage === null
                          ? "Order punched"
                          : `Stage ${e.to_stage} — ${stageName(e.to_stage)}`}
                      </p>
                      <p className="text-[12px] text-text-tertiary">
                        {formatDateTime(e.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          {ctx.can("data.delete") && (
            <Card className="border-status-danger/25">
              <CardHeader
                title="Delete order"
                description="Removes the order, its stage history and its notifications. Recorded in the activity log."
              />
              <CardBody>
                <DeleteButton
                  kind="order"
                  id={order.id}
                  title={orderTitle(order)}
                  redirectTo="/dashboard/orders"
                  lines={[
                    [order.client_name, `${order.items.length} product${order.items.length === 1 ? "" : "s"}`, `Qty ${totalQuantity(order)}`].filter(Boolean).join(" · "),
                    `Punched by ${order.dispatcher?.label ?? "—"} · Stage ${order.stage} — ${stageName(order.stage)}`,
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-full" : undefined}>
      <dt className="text-[11px] uppercase tracking-wide text-text-tertiary">
        {label}
      </dt>
      <dd className={wide ? "mt-1 whitespace-pre-wrap break-words font-medium text-text" : "mt-1 font-medium text-text"}>
        {value}
      </dd>
    </div>
  );
}
