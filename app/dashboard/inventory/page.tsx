import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getInventoryPage } from "@/lib/inventory/data";
import { InventoryPage } from "@/components/inventory/InventoryPage";

export const metadata = { title: "Inventory" };

const MONTH = /^\d{4}-\d{2}-01$/;

/**
 * The Inventory module. The inventory account manages it; head_admin /
 * admin read it (with the month selector, trend and top 10); everyone else
 * is sent back to Orders.
 *
 * The session check and the data read run in parallel (one round trip, not
 * two): the read uses the caller's own session, so RLS and the role check
 * in Postgres decide what comes back whatever this page does; the result
 * is only rendered once the session check has passed.
 */
export default async function InventoryRoute({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const asked = MONTH.test(sp.month ?? "") ? sp.month! : null;
  const dataP = getInventoryPage(asked);
  dataP.catch(() => {}); // handled below; never an unhandled rejection
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.view")) redirect("/dashboard/orders");
  // a past month is the admin tier's month selector only
  const data = asked && !ctx.isAdminTier ? await getInventoryPage(null) : await dataP;

  return <InventoryPage data={data} canManage={ctx.can("inventory.manage")} showAnalytics={ctx.isAdminTier} />;
}
