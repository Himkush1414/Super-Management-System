import "server-only";

import { createClient } from "@/lib/supabase/server";
import { ReadError } from "@/lib/data/read";
import { perf } from "@/lib/perf";
import type { InvHistory, InvOverview, InvPage, InvRangeReport } from "@/lib/inventory/types";

/**
 * Inventory reads. Always with the signed-in account's own session (never
 * the service role): the RPCs check the role in Postgres and RLS limits
 * every inv_ table, so the database enforces who sees what on its own.
 */

/** The main page: columns, settings, products with the month's figures, trend, top 10. */
export async function getInventoryOverview(month: string | null): Promise<InvOverview> {
  const pf = perf("inventory.overview");
  const supabase = await createClient();
  const { data, error } = await pf.time("rpc.inv_overview", supabase.rpc("inv_overview", { p_month: month }));
  pf.end({ ok: !error });
  if (error || !data) throw new ReadError("the inventory", error ?? "empty answer");
  return data as InvOverview;
}

/**
 * The main page, compact (inv_page, 0029): the same figures as
 * inv_overview with field names once and no trailing zeros. The trend /
 * top 10 come back only for the admin tier (the database decides), so this
 * can run before the caller's role is known.
 */
export async function getInventoryPage(month: string | null): Promise<InvPage> {
  const pf = perf("inventory.page");
  const supabase = await createClient();
  const { data, error } = await pf.time("rpc.inv_page", supabase.rpc("inv_page", { p_month: month, p_analytics: true }));
  pf.end({ ok: !error });
  if (error || !data) throw new ReadError("the inventory", error ?? "empty answer");
  return data as InvPage;
}

export async function getInventoryHistory(productId: string): Promise<InvHistory> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_product_history", { p_product_id: productId, p_limit: 30 });
  if (error || !data) throw new ReadError("the product history", error ?? "empty answer");
  return data as InvHistory;
}

/** `from` null = from the first month any product has stock ("All"). */
export async function getInventoryRange(from: string | null, to: string): Promise<InvRangeReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_range_report", { p_from: from, p_to: to });
  if (error || !data) throw new ReadError("the inventory report", error ?? "empty answer");
  return data as InvRangeReport;
}
