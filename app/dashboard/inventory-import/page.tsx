import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getInventoryPage } from "@/lib/inventory/data";
import { countingApplies, pageMonthFields, pageProducts } from "@/lib/inventory/types";
import { ImportFlow, type ImportProduct } from "@/components/inventory/import/ImportFlow";

export const metadata = { title: "Import from document" };

/**
 * "Import from document" (inventory account only). The page gets the
 * products to compare against (the same read as the Inventory page); the
 * document itself is read in the browser and never sent to the server.
 */
export default async function InventoryImportRoute() {
  const dataP = getInventoryPage(null);
  dataP.catch(() => {}); // handled below; never an unhandled rejection
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.manage")) redirect(ctx.can("inventory.view") ? "/dashboard/inventory" : "/dashboard/orders");
  const data = await dataP;
  const month = pageMonthFields(data);
  const products: ImportProduct[] = pageProducts(data).map((p) => ({
    id: p.id,
    serial_no: p.serial_no,
    description: p.description,
    specification: p.specification,
    rate: p.rate,
    balance: p.balance,
    pending: month.get(p.id)?.pending ?? false,
    is_active: p.is_active,
  }));
  return <ImportFlow products={products} countsAllowed={countingApplies(data.counts_from, data.current_month)} countsFrom={data.counts_from} />;
}
