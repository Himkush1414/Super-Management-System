import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Order, Profile } from "@/types/database.types";

type Party = Pick<Profile, "id" | "username" | "full_name">;

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
export async function getOrders(): Promise<OrderRow[]> {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("order_feed")
    .select("*")
    .order("created_at", { ascending: false });

  return attachProfiles(supabase, (orders ?? []) as Order[]);
}

/**
 * `cache()`d: the order detail page calls this from both generateMetadata and
 * the page body — without it every detail render fetched the order twice.
 */
export const getOrder = cache(async (id: string): Promise<OrderRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_feed")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [row] = await attachProfiles(supabase, [data as Order]);
  return row ?? null;
});

async function attachProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orders: Order[],
): Promise<OrderRow[]> {
  const ids = [
    ...new Set(orders.flatMap((o) => [o.created_by, ...(o.assignee_ids ?? [])])),
  ];
  const { data: profiles } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, username, full_name")
        .in("id", ids)
    : { data: [] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p as Party]));

  return orders.map((o) => ({
    ...o,
    assignee_ids: o.assignee_ids ?? [],
    dispatcher: byId.get(o.created_by) ?? null,
    assignees: (o.assignee_ids ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Party => Boolean(p))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "en", { numeric: true })),
  }));
}
