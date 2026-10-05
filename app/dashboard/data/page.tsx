import Link from "next/link";
import { DatabaseZap, ScrollText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge, StageBadge } from "@/components/shared/Badge";
import { Table, THead, TR, TH, TD } from "@/components/ui/Table";
import { DeleteButton } from "@/components/dashboard/DeleteButton";
import { ResetAccount } from "@/components/dashboard/ResetAccount";
import { stageName } from "@/lib/orders";
import { cn, formatDateTime, formatDay } from "@/lib/utils";

export const metadata = { title: "Data management" };

type Account = {
  profile_id: string;
  username: string;
  full_name: string;
  role: "marketing" | "production";
  orders_dispatched: number;
  orders_assigned: number;
  stage_updates: number;
  notifications: number;
};

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const ctx = await requireSession();
  if (!ctx.can("data.delete")) redirect("/dashboard/orders");
  const supabase = await createClient();
  const { account: selectedId } = await searchParams;

  // admin_account_overview() re-checks admin tier in the database.
  const { data: overview } = await supabase.rpc("admin_account_overview");
  const accounts = (overview ?? []) as Account[];
  const selected = accounts.find((a) => a.profile_id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Data management"
        description="Remove data that marketing and production accounts have built up over time. Every deletion is recorded in the activity log with a copy of what was removed."
        action={
          <Link
            href="/dashboard/activity"
            className="nr-interactive inline-flex h-8 items-center gap-2 rounded-md border border-border bg-elevated px-3 text-[13px] font-medium hover:border-border-strong"
          >
            <ScrollText size={14} /> Activity log
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <nav aria-label="Accounts" className="space-y-5">
          {(["marketing", "production"] as const).map((role) => (
            <div key={role}>
              <p className="nr-section-label px-1">{role === "marketing" ? "Marketing" : "Production"}</p>
              <ul className="space-y-1.5">
                {accounts
                  .filter((a) => a.role === role)
                  .map((a) => {
                    const active = a.profile_id === selected?.profile_id;
                    const items =
                      role === "marketing" ? a.orders_dispatched : a.stage_updates;
                    return (
                      <li key={a.profile_id}>
                        <Link
                          href={`/dashboard/data?account=${a.profile_id}`}
                          scroll={false}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "nr-interactive flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                            active
                              ? "border-accent/50 bg-accent/[0.07]"
                              : "border-border bg-panel/60 hover:border-border-strong",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{a.full_name}</span>
                            <span className="block font-mono text-[11px] text-text-tertiary">{a.username}</span>
                          </span>
                          <span className="shrink-0 text-right text-[11px] text-text-tertiary">
                            <span className="block font-medium text-text-secondary tnum">{items}</span>
                            {role === "marketing" ? "orders" : "updates"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {!selected ? (
            <EmptyState
              icon={<DatabaseZap size={22} />}
              title="Choose an account"
              description="Pick a marketing or production account to review and delete the data it has generated."
            />
          ) : (
            <AccountPanel account={selected} supabase={supabase} />
          )}
        </div>
      </div>
    </>
  );
}

async function AccountPanel({
  account,
  supabase,
}: {
  account: Account;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const isMarketing = account.role === "marketing";

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-tight">{account.full_name}</h2>
              <Badge tone={isMarketing ? "info" : "accent"}>{account.role}</Badge>
            </div>
            <p className="mt-0.5 font-mono text-[12px] text-text-tertiary">{account.username}</p>
          </div>
          <dl className="grid grid-cols-3 gap-5 text-right">
            <Stat label={isMarketing ? "Orders" : "Assigned"} value={isMarketing ? account.orders_dispatched : account.orders_assigned} />
            <Stat label="Updates" value={account.stage_updates} />
            <Stat label="Notifications" value={account.notifications} />
          </dl>
        </CardBody>
      </Card>

      {isMarketing ? (
        <MarketingOrders account={account} supabase={supabase} />
      ) : (
        <ProductionUpdates account={account} supabase={supabase} />
      )}

      <Card className="border-status-danger/25">
        <CardBody>
          <ResetAccount
            key={account.profile_id}
            profileId={account.profile_id}
            username={account.username}
            fullName={account.full_name}
            role={account.role}
            counts={account}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tnum">{value}</dd>
    </div>
  );
}

async function MarketingOrders({
  account,
  supabase,
}: {
  account: Account;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data } = await supabase
    .from("order_feed")
    .select("id, product_name, client_name, transformer_rating, quantity, stage, expected_delivery, created_at")
    .eq("created_by", account.profile_id)
    .order("created_at", { ascending: false });
  const orders = data ?? [];

  return (
    <Card>
      <CardHeader
        title="Orders dispatched"
        description="Deleting an order also removes its stage history and the notifications about it."
      />
      {orders.length === 0 ? (
        <CardBody>
          <p className="text-[13px] text-text-tertiary">No orders from this account.</p>
        </CardBody>
      ) : (
        <div className="p-2 sm:p-3">
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Stage</TH>
                <TH numeric>Dispatched</TH>
                <TH className="w-12"><span className="sr-only">Delete</span></TH>
              </TR>
            </THead>
            <tbody>
              {orders.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/dashboard/orders/${o.id}`} className="font-medium hover:text-accent">
                      {o.product_name}
                    </Link>
                    <span className="block text-[12px] text-text-tertiary">
                      {[o.client_name, o.transformer_rating, `Qty ${o.quantity}`].filter(Boolean).join(" · ")}
                    </span>
                  </TD>
                  <TD><StageBadge stage={o.stage} /></TD>
                  <TD numeric className="text-text-tertiary">{formatDateTime(o.created_at)}</TD>
                  <TD className="text-right">
                    <DeleteButton
                      compact
                      kind="order"
                      id={o.id}
                      title={o.product_name}
                      lines={[
                        `${o.client_name} · ${o.transformer_rating} · Qty ${o.quantity}`,
                        `Stage ${o.stage} — ${stageName(o.stage)} · dispatched ${formatDateTime(o.created_at)}`,
                        ...(o.expected_delivery ? [`Expected delivery ${formatDay(o.expected_delivery)}`] : []),
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

async function ProductionUpdates({
  account,
  supabase,
}: {
  account: Account;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data } = await supabase
    .from("order_stage_events")
    .select("id, from_stage, to_stage, created_at, order_id, orders(product_name, client_name)")
    .eq("changed_by", account.profile_id)
    .not("from_stage", "is", null)
    .order("created_at", { ascending: false });
  const events = (data ?? []) as unknown as {
    id: string;
    from_stage: number;
    to_stage: number;
    created_at: string;
    order_id: string;
    orders: { product_name: string; client_name: string } | null;
  }[];

  return (
    <Card>
      <CardHeader
        title="Stage updates made"
        description="Removes the history entry only — the order keeps its current stage."
      />
      {events.length === 0 ? (
        <CardBody>
          <p className="text-[13px] text-text-tertiary">No stage updates from this account.</p>
        </CardBody>
      ) : (
        <div className="p-2 sm:p-3">
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Update</TH>
                <TH numeric>When</TH>
                <TH className="w-12"><span className="sr-only">Delete</span></TH>
              </TR>
            </THead>
            <tbody>
              {events.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <Link href={`/dashboard/orders/${e.order_id}`} className="font-medium hover:text-accent">
                      {e.orders?.product_name ?? "—"}
                    </Link>
                    <span className="block text-[12px] text-text-tertiary">{e.orders?.client_name}</span>
                  </TD>
                  <TD className="text-text-secondary">
                    Stage {e.from_stage} → {e.to_stage}
                    <span className="block text-[12px] text-text-tertiary">{stageName(e.to_stage)}</span>
                  </TD>
                  <TD numeric className="text-text-tertiary">{formatDateTime(e.created_at)}</TD>
                  <TD className="text-right">
                    <DeleteButton
                      compact
                      kind="stage_event"
                      id={e.id}
                      title={`Stage ${e.from_stage} → ${e.to_stage} (${stageName(e.to_stage)})`}
                      lines={[
                        `On "${e.orders?.product_name ?? "?"}" — ${e.orders?.client_name ?? ""}`,
                        `Made by ${account.full_name} · ${formatDateTime(e.created_at)}`,
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
