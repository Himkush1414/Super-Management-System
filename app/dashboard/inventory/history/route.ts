import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getInventoryHistory } from "@/lib/inventory/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One product's recent history, as JSON (/dashboard/inventory/history?id=…).
 * A GET route, not a server action: server actions run one at a time per
 * tab, so a history read used to wait behind any save in flight. Inventory
 * and admin tier only; the read itself is RLS-limited and role-checked in
 * Postgres. Never cached by the browser or a CDN (private data).
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Product not found." }, { status: 400 });
  const historyP = getInventoryHistory(id);
  historyP.catch(() => {});
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.view")) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  try {
    return NextResponse.json(await historyP, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The history didn't load. Please try again." }, { status: 502 });
  }
}
