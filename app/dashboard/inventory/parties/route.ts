import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getPartyIndex } from "@/lib/inventory/data";

/**
 * Party search's data (/dashboard/inventory/parties): per product and
 * party, all months. Loaded in the background after the page is on screen
 * (never in the way of the first paint), then searched in the browser.
 * Inventory and admin tier only; RLS-limited and role-checked in Postgres.
 */
export async function GET() {
  const ixP = getPartyIndex();
  ixP.catch(() => {});
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.view")) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  try {
    return NextResponse.json(await ixP, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The party list didn't load." }, { status: 502 });
  }
}
