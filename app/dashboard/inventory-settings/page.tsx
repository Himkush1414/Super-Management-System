import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { must } from "@/lib/data/read";
import { InventorySettings } from "@/components/inventory/InventorySettings";
import type { InvColumn, InvSettings } from "@/lib/inventory/types";

export const metadata = { title: "Inventory settings" };

/** The inventory person (name, phone) and the product columns. Inventory account only. */
export default async function InventorySettingsPage() {
  const supabase = await createClient();
  // RLS: inv_settings / inv_columns are readable by inventory + admin tier only
  const [ctx, settings, columns, products] = await Promise.all([
    requireSession({ inventory: true }),
    supabase.from("inv_settings").select("person_name, phone").maybeSingle<InvSettings>(),
    supabase
      .from("inv_columns")
      .select("id, key, label, data_type, position, is_default, visible, archived_at")
      .order("is_default", { ascending: false })
      .order("position"),
    // active products and their minimum stock (0030), for the minimum-stock list
    supabase.rpc("inv_min_stock_list"),
  ]);
  if (!ctx.can("inventory.manage")) redirect(ctx.can("inventory.view") ? "/dashboard/inventory" : "/dashboard/orders");
  const s = must(settings, "the inventory settings");
  const cols = must(columns, "the inventory columns") as (Omit<InvColumn, "archived"> & { archived_at: string | null })[];
  const prods = ((must(products, "the products") ?? []) as [string, string, string, string, string | null][]).map(
    ([id, serial_no, description, specification, min_stock]) => ({ id, serial_no, description, specification: specification ?? "", min_stock }),
  );

  return (
    <InventorySettings
      settings={s ?? { person_name: "", phone: "" }}
      columns={cols.map(({ archived_at, ...c }) => ({ ...c, archived: archived_at !== null }))}
      products={prods}
    />
  );
}
