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
import { AdminStageControl } from "@/components/dashboard/AdminStageControl";
import { StageTimerBar } from "@/components/dashboard/StageTimerBar";
import { LiveRefresh } from "@/components/dashboard/LiveRefresh";
import { DeleteButton } from "@/components/dashboard/DeleteButton";
import { MAX_STAGE, orderTitle, stageName, totalQuantity } from "@/lib/orders";
import { GST_RATE, formatINR, orderMoney } from "@/lib/money";
import { perf } from "@/lib/perf";
import { formatDateTime, formatDay } from "@/lib/utils";

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
  const pf = perf("page.order");
  const supabase = await createClient();
  // Everything in one parallel round. production_settings is RLS-scoped
  // (admin tier sees all, production only itself) and only shown to admins.
  const [ctx, order, { data: events }, { data: phones }] = await Promise.all([
    pf.time("requireSession", requireSession()),
    pf.time("getOrder", getOrder(id)),
    pf.time(
      "stage_events",
      supabase.from("order_stage_events").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    ),
    pf.time("production_settings", supabase.from("production_settings").select("profile_id, phone, confirmed_at")),
  ]);
  if (!order) notFound();

  const isAssignedProduction =
    ctx.role === "production" && order.assignee_ids.includes(ctx.userId);
  // Price follows the role rule, not "whatever the row happened to carry".
  const canSeePrice = ctx.can("price.view");
  const showPuncher = ctx.isAdminTier;
  const showAssignees = ctx.role !== "production";
  // Admin tier moves any order to any stage, without the timer, after confirming.
  const canOverrideStage = ctx.can("orders.overrideStage");
  const money = orderMoney(order);

  pf.end({ role: ctx.role });

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
                  <Field label={`Grand total (incl. ${GST_RATE}% GST)`} value={formatINR(money.grandTotal)} />
                )}
                {canSeePrice && (
                  <Field label="Additional Amount" value={formatINR(money.additional)} />
                )}
                <Field
                  label="Products"
                  value={`${order.items.length} · ${totalQuantity(order)} unit${totalQuantity(order) === 1 ? "" : "s"}`}
                />
                <Field label="Punched" value={formatDateTime(order.created_at)} />
                {showPuncher && (
                  <Field label="Punched by" value={order.puncher?.label ?? "—"} />
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
              {order.items.map((it, k) => (
                <li key={it.id} className="flex gap-3 px-5 py-4 text-[13px]">
                  <span className="mt-px w-5 shrink-0 text-text-tertiary tnum">{it.position}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-text">{it.product_name}</p>
                    <p className="mt-0.5 text-text-secondary">
                      {/* with prices, Qty is the first money column below */}
                      {[it.transformer_rating, canSeePrice ? null : `Qty ${it.quantity}`].filter(Boolean).join(" · ")}
                    </p>
                    {it.description && (
                      <p className="mt-1.5 whitespace-pre-wrap text-text-tertiary">{it.description}</p>
                    )}
                    {canSeePrice && (
                      // the single-order PDF's columns, same figures (lib/money.ts)
                      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                        {(
                          [
                            ["Qty", String(it.quantity)],
                            ["Unit price", formatINR(money.rows[k].unit)],
                            ["Additional amount", formatINR(money.rows[k].additional)],
                            [`Total (incl. ${GST_RATE}% GST)`, formatINR(money.rows[k].total)],
                          ] as const
                        ).map(([label, value], j) => (
                          <div key={label} className="sm:text-right">
                            <dt className="text-[11px] text-text-tertiary">{label}</dt>
                            <dd className={j === 3 ? "font-medium tnum text-text" : "tnum text-text-secondary"}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </li>
              ))}
              {canSeePrice && (
                <li className="space-y-1.5 px-5 py-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span className="pl-8 text-text-secondary">Subtotal (before GST)</span>
                    <span className="tnum">{formatINR(money.subtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="pl-8 text-text-secondary">GST @ {GST_RATE}%</span>
                    <span className="tnum">{formatINR(money.gst)}</span>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold">
                    <span className="pl-8">Grand total (incl. {GST_RATE}% GST)</span>
                    <span className="tnum">{formatINR(money.grandTotal)}</span>
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
              {canOverrideStage ? (
                <div className="rounded-lg border border-border bg-bg-subtle p-4">
                  <AdminStageControl orderId={order.id} stage={order.stage} />
                </div>
              ) : isAssignedProduction ? (
                <div className="rounded-lg border border-border bg-bg-subtle p-4">
                  <StageControl
                    orderId={order.id}
                    stage={order.stage}
                    waiting={order.status === "waiting_on_production_phone"}
                    stageReadyAt={order.stage_ready_at}
                  />
                </div>
              ) : null}
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
                          : e.to_stage < e.from_stage
                              ? `Moved back to Stage ${e.to_stage} — ${stageName(e.to_stage)}`
                              : `Stage ${e.to_stage} — ${stageName(e.to_stage)}`}
                      </p>
                      {e.from_stage === 1 && e.to_stage === 2 && !e.changed_by && (
                        <p className="text-[12px] text-text-tertiary">
                          Moved on automatically (one-off, 7 Oct 2026)
                        </p>
                      )}
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
                    `Punched by ${order.puncher?.label ?? "—"} · Stage ${order.stage} — ${stageName(order.stage)}`,
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
