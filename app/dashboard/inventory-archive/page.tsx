import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getArchiveList } from "@/lib/inventory/data";
import { ArchivePage } from "@/components/inventory/ArchivePage";

export const metadata = { title: "Archive" };

/**
 * The Archive tab: archived products. The inventory account restores them
 * (and deletes one with no history); head_admin / admin read it; everyone
 * else is sent back. The session check and the read run in parallel; the
 * read uses the caller's own session (RLS + the role check in Postgres).
 */
export default async function InventoryArchiveRoute() {
  const dataP = getArchiveList();
  dataP.catch(() => {}); // handled below; never an unhandled rejection
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.view")) redirect("/dashboard/orders");
  const data = await dataP;
  return <ArchivePage products={data.products} deleted={data.deleted} canManage={ctx.can("inventory.manage")} />;
}
