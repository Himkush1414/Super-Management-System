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
  const [ctx, settings, columns] = await Promise.all([
    requireSession({ inventory: true }),
    supabase.from("inv_settings").select("person_name, phone").maybeSingle<InvSettings>(),
    supabase
      .from("inv_columns")
      .select("id, key, label, data_type, position, is_default, visible, archived_at")
      .order("is_default", { ascending: false })
      .order("position"),
  ]);
  if (!ctx.can("inventory.manage")) redirect(ctx.can("inventory.view") ? "/dashboard/inventory" : "/dashboard/orders");
  const s = must(settings, "the inventory settings");
  const cols = must(columns, "the inventory columns") as (Omit<InvColumn, "archived"> & { archived_at: string | null })[];

  return (
    <InventorySettings
      settings={s ?? { person_name: "", phone: "" }}
      columns={cols.map(({ archived_at, ...c }) => ({ ...c, archived: archived_at !== null }))}
    />
  );
}
