import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getInventoryOverview } from "@/lib/inventory/data";
import { InventoryPage } from "@/components/inventory/InventoryPage";

export const metadata = { title: "Inventory" };

/**
 * The Inventory module. The inventory account manages it; head_admin /
 * admin read it (with the month selector, trend and top 10); everyone else
 * is sent back to Orders. The data comes from one RPC with the caller's own
 * session, which also closes any ended month first (inv_rollover).
 */
export default async function InventoryRoute({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [ctx, sp] = await Promise.all([requireSession({ inventory: true }), searchParams]);
  if (!ctx.can("inventory.view")) redirect("/dashboard/orders");
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") && ctx.isAdminTier ? sp.month! : null;
  const data = await getInventoryOverview(month);

  return <InventoryPage data={data} canManage={ctx.can("inventory.manage")} showAnalytics={ctx.isAdminTier} />;
}
