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
import { MAX_STAGE, stageName } from "@/lib/orders";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrder(id);
  return { title: order ? order.product_name : "Order" };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
  if (!order) notFound();

  const isAssignedProduction =
    ctx.role === "production" && order.assigned_to === ctx.userId;
  const canSeePrice = order.price !== null || ctx.can("price.view");
  const showParties = ctx.isAdminTier;

  return (
    <>
      <LiveRefresh channel={`order-${id}`} table="orders" filter={`id=eq.${id}`} />
      <LiveRefresh
        channel={`order-events-${id}`}
        table="order_stage_events"
        filter={`order_id=eq.${id}`}
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
        title={order.product_name}
        description={order.power_type || undefined}
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
                <Field label="Quantity" value={String(order.quantity)} />
                <Field label="Quality" value={order.quality || "—"} />
                <Field label="Power / type" value={order.power_type || "—"} />
                {canSeePrice && (
                  <Field label="Price" value={formatCurrency(order.price)} />
                )}
                {showParties && (
                  <>
                    <Field
                      label="Dispatched by"
                      value={order.dispatcher?.full_name ?? "—"}
                    />
                    <Field
                      label="Production"
                      value={order.assignee?.full_name ?? "—"}
                    />
                  </>
                )}
                <Field label="Dispatched" value={formatDateTime(order.created_at)} />
              </dl>
              {order.description && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-secondary">
                    {order.description}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Progress"
              description={`Currently Stage ${order.stage} — ${stageName(order.stage)}`}
            />
            <CardBody className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
              <StageTracker stage={order.stage} />
              {isAssignedProduction && (
                <div className="rounded-lg border border-border bg-bg-subtle p-4">
                  <StageControl
                    orderId={order.id}
                    stage={order.stage}
                    waiting={order.status === "waiting_on_production_phone"}
                    stageReadyAt={order.stage_ready_at}
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
              {order.production_phone && ctx.isAdminTier && (
                <p className="text-[12px] text-text-tertiary">
                  Destination number on file: {order.production_phone}
                </p>
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
                          ? "Order dispatched"
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
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-text">{value}</dd>
    </div>
  );
}
