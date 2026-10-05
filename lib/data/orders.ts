import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Order, Profile } from "@/types/database.types";
import { displayName } from "@/lib/names";

type Party = Pick<Profile, "id" | "username" | "full_name" | "real_name" | "role"> & {
  /** "Real Name (Production 1)" / account label — see lib/names.ts */
  label: string;
};

export type OrderRow = Order & {
  dispatcher: Party | null;
  /** Assigned production members the viewer is allowed to resolve (RLS). */
  assignees: Party[];
};

/**
 * Reads orders through `order_feed` (price nulled for anyone who shouldn't see
 * it) and resolves the dispatcher / assignee names within whatever the
 * viewer's profile RLS allows (unresolvable names are simply left out).
 */
export async function getOrders(
  /** only orders dispatched in [from, to) — UTC instants (see lib/periods.ts) */
  range?: { from: string; to: string } | null,
): Promise<OrderRow[]> {
  const supabase = await createClient();
  let q = supabase.from("order_feed").select("*");
  if (range) q = q.gte("created_at", range.from).lt("created_at", range.to);
  const [{ data: orders }, parties] = await Promise.all([
    q.order("created_at", { ascending: false }),
    visibleParties(supabase),
  ]);
  return attach((orders ?? []) as Order[], parties);
}

/**
 * `cache()`d: the order detail page calls this from both generateMetadata and
 * the page body — without it every detail render fetched the order twice.
 */
export const getOrder = cache(async (id: string): Promise<OrderRow | null> => {
  const supabase = await createClient();
  const [{ data }, parties] = await Promise.all([
    supabase.from("order_feed").select("*").eq("id", id).maybeSingle(),
    visibleParties(supabase),
  ]);
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

function attach(orders: Order[], byId: Map<string, Party>): OrderRow[] {
  return orders.map((o) => ({
    ...o,
    assignee_ids: o.assignee_ids ?? [],
    dispatcher: byId.get(o.created_by) ?? null,
    assignees: (o.assignee_ids ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Party => Boolean(p))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "en", { numeric: true })), // by account, stable
  }));
}
