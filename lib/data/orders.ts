import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Order, OrderItem, Profile } from "@/types/database.types";
import { displayName } from "@/lib/names";
import { perf } from "@/lib/perf";

type Party = Pick<Profile, "id" | "username" | "full_name" | "real_name" | "role"> & {
  /** "Real Name (Production 1)" / account label — see lib/names.ts */
  label: string;
};

export type OrderRow = Order & {
  /** The marketing account that punched the order (orders.created_by). */
  puncher: Party | null;
  /** Assigned production members the viewer is allowed to resolve (RLS). */
  assignees: Party[];
};

/**
 * Reads orders through `order_feed` (price nulled for anyone who shouldn't see
 * it) and resolves the puncher / assignee names within whatever the
 * viewer's profile RLS allows (unresolvable names are simply left out).
 */
export async function getOrders(
  /** only orders punched in [from, to) — UTC instants (see lib/periods.ts) */
  range?: { from: string; to: string } | null,
): Promise<OrderRow[]> {
  const pf = perf("getOrders");
  const supabase = await createClient();
  let q = supabase.from("order_feed").select("*");
  if (range) q = q.gte("created_at", range.from).lt("created_at", range.to);
  const [{ data: orders }, parties] = await Promise.all([
    pf.time("order_feed", q.order("created_at", { ascending: false })),
    pf.time("profiles", visibleParties(supabase)),
  ]);
  pf.end({ rows: orders?.length ?? 0 });
  return attach((orders ?? []) as Order[], parties);
}

/**
 * `cache()`d: the order detail page calls this from both generateMetadata and
 * the page body — without it every detail render fetched the order twice.
 */
export const getOrder = cache(async (id: string): Promise<OrderRow | null> => {
  const pf = perf("getOrder");
  const supabase = await createClient();
  const [{ data }, parties] = await Promise.all([
    pf.time("order_feed", supabase.from("order_feed").select("*").eq("id", id).maybeSingle()),
    pf.time("profiles", visibleParties(supabase)),
  ]);
  pf.end();
  if (!data) return null;
  return attach([data as Order], parties)[0] ?? null;
});

/**
 * Every profile the viewer may resolve (RLS-scoped; ten fixed accounts at
 * most), fetched in PARALLEL with the orders instead of after them.
 */
async function visibleParties(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, Party>> {
  const { data } = await supabase.from("profiles").select("id, username, full_name, real_name, role");
  return new Map(
    (data ?? []).map((p) => [p.id as string, { ...(p as Omit<Party, "label">), label: displayName(p as Profile) }]),
  );
}

/** jsonb numerics can arrive as strings; prices / GST are numbers or null. */
function items(o: Order): OrderItem[] {
  return (o.items ?? [])
    .map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      price: i.price === null || i.price === undefined ? null : Number(i.price),
      gst: i.gst === null || i.gst === undefined ? null : Number(i.gst),
      feat: i.feat === null || i.feat === undefined ? null : Number(i.feat),
    }))
    .sort((a, b) => a.position - b.position);
}

function attach(orders: Order[], byId: Map<string, Party>): OrderRow[] {
  return orders.map((o) => ({
    ...o,
    items: items(o),
    ship_to: o.ship_to ?? "",
    price: o.price === null || o.price === undefined ? null : Number(o.price),
    additional_amount:
      o.additional_amount === null || o.additional_amount === undefined ? null : Number(o.additional_amount),
    assignee_ids: o.assignee_ids ?? [],
    puncher: byId.get(o.created_by) ?? null,
    assignees: (o.assignee_ids ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Party => Boolean(p))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "en", { numeric: true })), // by account, stable
  }));
}
