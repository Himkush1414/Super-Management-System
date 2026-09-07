import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Order, Profile } from "@/types/database.types";

export type OrderRow = Order & {
  dispatcher: Pick<Profile, "id" | "username" | "full_name"> | null;
  assignee: Pick<Profile, "id" | "username" | "full_name"> | null;
};

/**
 * Reads orders through `order_feed` (price nulled for anyone who shouldn't see
 * it) and resolves the dispatcher / assignee names within whatever the
 * viewer's profile RLS allows (null when not visible).
 */
export async function getOrders(): Promise<OrderRow[]> {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("order_feed")
    .select("*")
    .order("created_at", { ascending: false });

  return attachProfiles(supabase, (orders ?? []) as Order[]);
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_feed")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [row] = await attachProfiles(supabase, [data as Order]);
  return row ?? null;
}

async function attachProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orders: Order[],
): Promise<OrderRow[]> {
  const ids = [
    ...new Set(orders.flatMap((o) => [o.created_by, o.assigned_to])),
  ];
  const { data: profiles } = ids.length
    ? await supabase
        .from("profiles")
        .select("id, username, full_name")
        .in("id", ids)
    : { data: [] };

  const byId = new Map(
    (profiles ?? []).map((p) => [p.id, p as Pick<Profile, "id" | "username" | "full_name">]),
  );

  return orders.map((o) => ({
    ...o,
    dispatcher: byId.get(o.created_by) ?? null,
    assignee: byId.get(o.assigned_to) ?? null,
  }));
}
