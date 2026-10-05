import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AccountArchive, type AccountExport } from "@/lib/pdf/AccountArchive";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Download this data" in the reset dialog: a PDF of exactly what a reset
 * with the same scopes will delete. Admin tier only — checked here and again
 * by admin_account_export() in the database.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireSession();
  if (!ctx.can("data.delete")) return new NextResponse("Not permitted", { status: 403 });

  const q = req.nextUrl.searchParams;
  const account = q.get("account") ?? "";
  if (!UUID.test(account)) return new NextResponse("Account not found", { status: 404 });
  const flag = (k: string) => q.get(k) === "1";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_account_export", {
    p_profile_id: account,
    p_orders: flag("orders"),
    p_stage_events: flag("stage_events"),
    p_notifications: flag("notifications"),
  });
  if (error || !data) return new NextResponse("Could not export", { status: 400 });

  const archive = data as AccountExport;
  const buffer = await renderToBuffer(<AccountArchive data={archive} generatedAt={new Date()} />);
  const filename = `nr-archive-${archive.account.username}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
