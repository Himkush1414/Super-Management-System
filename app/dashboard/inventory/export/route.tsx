import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getInventoryRange } from "@/lib/inventory/data";
import { buildExportModel, textTable } from "@/lib/inventory/export-model";
import { exportFileName, resolveRange, type RangeKind } from "@/lib/inventory/ranges";
import { istDay } from "@/lib/periods";
import { formatStamp } from "@/lib/utils";
import { formatINR, formatQty } from "@/lib/inventory/numbers";

const KINDS: RangeKind[] = ["week", "month", "prev_month", "all", "custom"];

/**
 * The inventory export, made on the server (works on Vercel):
 *   /dashboard/inventory/export?format=pdf|docx|xlsx&range=week|month|prev_month|all|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 * Inventory and admin tier only. Opening = balance before the first day,
 * Received / Issued = sums inside the range, Closing = balance on the last
 * day (IST). File: "NR Industries Product Specification DD-MM-YYYY to DD-MM-YYYY".
 */
const FORMATS = ["pdf", "docx", "xlsx"] as const;
type Format = (typeof FORMATS)[number];
const TYPES: Record<Format, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const format: Format = (FORMATS as readonly string[]).includes(q.get("format") ?? "") ? (q.get("format") as Format) : "pdf";
  const kind = (KINDS as string[]).includes(q.get("range") ?? "") ? (q.get("range") as RangeKind) : "month";
  const today = istDay(new Date());
  const range = resolveRange(kind, today, { from: q.get("from"), to: q.get("to") });
  if (!range) return new NextResponse("Choose a start date on or before the end date.", { status: 400 });

  // The session check and the read run in parallel (the read is RLS-limited
  // and role-checked in Postgres with the caller's own session); nothing is
  // sent until the session check has passed. "All" starts at the first
  // month any product has stock (the database knows).
  const reportP = getInventoryRange(kind === "all" ? null : range.from, range.to);
  reportP.catch(() => {});
  const ctx = await requireSession({ inventory: true });
  if (!ctx.can("inventory.view")) return new NextResponse("Not permitted", { status: 403 });
  const report = await reportP;
  const generatedAt = new Date();
  const model = buildExportModel(report, range.label, generatedAt);
  const filename = exportFileName(report.from, report.to, format);

  let body: Buffer;
  const type = TYPES[format];
  if (format === "xlsx") {
    const [{ buildXlsx }, { COMPANY }] = await Promise.all([import("@/lib/inventory/xlsx"), import("@/lib/pdf/Chrome")]);
    body = buildXlsx(model, {
      company: COMPANY.name,
      subtitle: `${report.from.split("-").reverse().join("/")} to ${report.to.split("-").reverse().join("/")} · ${range.label}`,
      generated: formatStamp(generatedAt),
    });
  } else if (format === "pdf") {
    // loaded on demand: react-pdf is only needed for this format
    const [{ renderToBuffer }, { InventoryReport }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/inventory/pdf")]);
    body = await renderToBuffer(<InventoryReport model={model} />);
  } else {
    const [{ buildDocx }, { LOGO_DATA_URI, LOGO_ASPECT }, { COMPANY }] = await Promise.all([
      import("@/lib/inventory/docx"),
      import("@/lib/pdf/logo"),
      import("@/lib/pdf/Chrome"),
    ]);
    const t = textTable(model);
    body = buildDocx({
      title: "Product Specification",
      subtitle: `${report.from.split("-").reverse().join("/")} to ${report.to.split("-").reverse().join("/")} · ${range.label}`,
      generated: formatStamp(generatedAt),
      company: COMPANY.name,
      address: COMPANY.address,
      logo: { jpeg: Buffer.from(LOGO_DATA_URI.split(",")[1], "base64"), aspect: LOGO_ASPECT },
      summary: [
        `Products: ${model.rows.length.toLocaleString("en-IN")}`,
        `Received: ${formatQty(model.totals.received)}`,
        `Issued: ${formatQty(model.totals.issued)}`,
        ...(model.person ? [`Inventory: ${model.person}`] : []),
      ],
      head: t.head,
      right: t.right,
      rows: t.rows,
      widths: [7, 22, 14, 8, 8, 8, 8, 8, 10, ...model.customColumns.map(() => 7)],
      totalLine: `Total closing value (active products): ${formatINR(model.totals.value)}`,
    });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
