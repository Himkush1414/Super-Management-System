import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText, Trash2, RotateCcw, History } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/shared/Page";
import { Badge } from "@/components/shared/Badge";
import { formatDateTime, formatCurrency, formatDay } from "@/lib/utils";
import { stageName } from "@/lib/orders";
import type { Json } from "@/types/database.types";

export const metadata = { title: "Activity log" };

const PAGE_SIZE = 100;

type Entry = {
  id: string;
  created_at: string;
  actor_label: string;
  action: "order.delete" | "stage_event.delete" | "account.reset" | string;
  summary: string;
  details: Record<string, Json>;
  batch_id: string | null;
  target_profile_id: string | null;
};

const ACTION: Record<string, { label: string; icon: typeof Trash2 }> = {
  "order.delete": { label: "Order deleted", icon: Trash2 },
  "stage_event.delete": { label: "Stage update deleted", icon: History },
  "account.reset": { label: "Account reset", icon: RotateCcw },
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const ctx = await requireSession();
  if (!ctx.can("audit.view")) redirect("/dashboard/orders");
  const supabase = await createClient();
  const { account } = await searchParams;

  // RLS (audit_log_select) decides which rows come back.
  let q = supabase
    .from("audit_log")
    .select("id, created_at, actor_label, action, summary, details, batch_id, target_profile_id")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (account && /^[0-9a-f-]{36}$/i.test(account)) q = q.eq("target_profile_id", account);
  const { data } = await q;
  const entries = (data ?? []) as Entry[];

  // Items deleted as part of an account reset are shown under that reset.
  const resetIds = new Set(entries.filter((e) => e.action === "account.reset").map((e) => e.batch_id));
  const children = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.action !== "account.reset" && e.batch_id && resetIds.has(e.batch_id)) {
      children.set(e.batch_id, [...(children.get(e.batch_id) ?? []), e]);
    }
  }
  const top = entries.filter(
    (e) => e.action === "account.reset" || !e.batch_id || !resetIds.has(e.batch_id),
  );

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every deletion made from Data management or an order page: what was removed, by whom, and when. Entries can't be edited or deleted."
        action={
          account ? (
            <Link href="/dashboard/activity" className="text-[13px] text-text-secondary hover:text-text">
              Show all accounts
            </Link>
          ) : undefined
        }
      />

      {top.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={22} />}
          title="Nothing deleted yet"
          description="Deletions will appear here as they happen."
        />
      ) : (
        <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
          {top.map((e) => (
            <EntryRow key={e.id} entry={e} items={e.batch_id ? children.get(e.batch_id) : undefined} />
          ))}
        </ol>
      )}
      {entries.length === PAGE_SIZE && (
        <p className="mt-4 text-center text-[12px] text-text-tertiary">
          Showing the latest {PAGE_SIZE} entries.
        </p>
      )}
    </>
  );
}

function EntryRow({ entry, items }: { entry: Entry; items?: Entry[] }) {
  const meta = ACTION[entry.action] ?? { label: entry.action, icon: ScrollText };
  const Icon = meta.icon;
  return (
    <li className="relative flex gap-3">
      <span className="relative z-10 mt-3 flex size-[31px] shrink-0 items-center justify-center rounded-full border border-border-strong bg-panel text-text-secondary">
        <Icon size={14} />
      </span>
      <details className="group min-w-0 flex-1 rounded-xl border border-border bg-panel/60 open:border-border-strong">
        <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={entry.action === "account.reset" ? "danger" : "warning"}>{meta.label}</Badge>
              <span className="text-[12px] text-text-tertiary">
                by <span className="font-mono text-text-secondary">{entry.actor_label}</span>
              </span>
            </span>
            <span className="mt-1 block text-[13px] text-text">{entry.summary}</span>
          </span>
          <span className="shrink-0 text-[12px] text-text-tertiary tnum">{formatDateTime(entry.created_at)}</span>
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          <Snapshot entry={entry} />
          {items && items.length > 0 && (
            <div>
              <p className="nr-section-label">Items removed in this reset</p>
              <ul className="space-y-1">
                {items.map((i) => (
                  <li key={i.id} className="text-[12px] text-text-secondary">• {i.summary}</li>
                ))}
              </ul>
            </div>
          )}
          <details className="text-[12px]">
            <summary className="cursor-pointer text-text-tertiary hover:text-text-secondary">Raw record</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg-subtle p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    </li>
  );
}

function Snapshot({ entry }: { entry: Entry }) {
  const d = entry.details as Record<string, never>;
  let rows: [string, string][] = [];
  if (entry.action === "order.delete" && d.order) {
    const o = d.order as Record<string, never>;
    rows = [
      ["Product", String(o.product_name ?? "—")],
      ["Client", String(o.client_name || "—")],
      ["Rating", String(o.transformer_rating || "—")],
      ["Quantity", String(o.quantity ?? "—")],
      ["Order value", formatCurrency(o.price === null ? null : Number(o.price))],
      ["Expected delivery", formatDay(o.expected_delivery ?? null)],
      ["Stage at deletion", `${o.stage} — ${stageName(Number(o.stage))}`],
      ["Punched by", String(d.dispatched_by ?? "—")],
      ["Production", ((d.assignees as unknown as string[]) ?? []).join(", ") || "—"],
      ["Stage history removed", String(((d.stage_events as unknown as unknown[]) ?? []).length)],
    ];
  } else if (entry.action === "stage_event.delete" && d.event) {
    const ev = d.event as Record<string, never>;
    rows = [
      ["Order", String(d.order_product ?? "—")],
      ["Update", `Stage ${ev.from_stage} → ${ev.to_stage}`],
      ["Made by", String(d.made_by ?? "—")],
      ["Made at", formatDateTime(String(ev.created_at))],
    ];
  } else if (entry.action === "account.reset" && d.counts) {
    const c = d.counts as Record<string, number>;
    const a = d.account as Record<string, string>;
    rows = [
      ["Account", `${a?.username} (${a?.role})`],
      ["Orders deleted", String(c.orders)],
      ["Stage updates deleted", String(c.stage_updates)],
      ["Notifications deleted", String(c.notifications)],
    ];
  }
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
          <dt className="text-text-tertiary">{k}</dt>
          <dd className="text-right text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
