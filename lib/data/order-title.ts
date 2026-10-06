import "server-only";

import type { createServiceClient } from "@/lib/supabase/server";

/**
 * "TRANSFORMER +2 more" for an order the DB functions only know by its first
 * product's name (orders.product_name mirrors product 1, migration 0019).
 */
export async function titleOf(
  svc: ReturnType<typeof createServiceClient>,
  orderId: string,
  firstName: string,
): Promise<string> {
  const { count } = await svc
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  return count && count > 1 ? `${firstName} +${count - 1} more` : firstName;
}
