"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Download, Phone, UserRound, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { parseQty } from "@/lib/inventory/numbers";
import { activeCustomColumns, visibleCustomColumns, type InvOverview } from "@/lib/inventory/types";
import { ProductList } from "./ProductList";
import { SummaryCards, TopIssued, TrendChart } from "./Overview";
import { ToastProvider } from "./Toast";
import { monthLabel, toRow, type Row } from "./model";

// export UI and the add-product form load only when opened
const ExportSheet = dynamic(() => import("./ExportSheet").then((m) => m.ExportSheet), { ssr: false });
const AddProductSheet = dynamic(() => import("./AddProductSheet").then((m) => m.AddProductSheet), { ssr: false });

type Patch = { r: bigint; i: bigint; b: bigint };

export function InventoryPage({
  data,
  canManage,
  showAnalytics,
}: {
  data: InvOverview;
  canManage: boolean;
  /** admin tier: trend, top 10, month selector */
  showAnalytics: boolean;
}) {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  // figures the server has just confirmed, shown until the refreshed page arrives
  // (kept per data object: a refreshed page from the server replaces them)
  const [patchState, setPatchState] = useState<{ data: InvOverview; map: Record<string, Patch> }>({ data, map: {} });
  const patches = useMemo(() => (patchState.data === data ? patchState.map : {}), [patchState, data]);

  const base = useMemo(() => data.products.map(toRow), [data.products]);
  const rows: Row[] = useMemo(
    () => base.map((r) => (patches[r.id] ? { ...r, r: patches[r.id].r, i: patches[r.id].i, b: patches[r.id].b, value: r.ratePaise === null ? r.value : (patches[r.id].b * r.ratePaise + BigInt(500)) / BigInt(1000) } : r)),
    [base, patches],
  );
  const customCols = useMemo(() => visibleCustomColumns(data.columns), [data.columns]);
  const formCols = useMemo(() => activeCustomColumns(data.columns), [data.columns]);

  const onRecorded = useCallback(
    (id: string, kind: "receive" | "issue", qtyText: string, after: string | undefined, reversal?: boolean) => {
      const q = parseQty(qtyText) ?? BigInt(0);
      setPatchState((st) => {
        const p = st.data === data ? st.map : {};
        const row = rows.find((x) => x.id === id);
        if (!row) return { data, map: p };
        const cur = p[id] ?? { r: row.r, i: row.i, b: row.b };
        const sign = reversal ? -BigInt(1) : BigInt(1);
        const next = {
          r: kind === "receive" ? cur.r + sign * q : cur.r,
          i: kind === "issue" ? cur.i + sign * q : cur.i,
          b: after !== undefined ? (parseQty(after) ?? cur.b) : cur.b,
        };
        return { data, map: { ...p, [id]: next } };
      });
    },
    [rows, data],
  );

  const person = data.settings?.person_name?.trim();
  const phone = data.settings?.phone?.trim();
  const viewing = monthLabel(data.month);

  return (
    <ToastProvider>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="nr-section-label">Store</p>
          <h1 className="text-[1.5rem] font-semibold tracking-[-0.025em]">Inventory</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
            Opening, receiving, issue and balance for <span className="font-medium text-text">{viewing}</span>
            {data.is_current ? "" : " (closed month, from its snapshot)"}.
            {!canManage && " Read only."}
          </p>
          {(person || phone || canManage) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              {person || phone ? (
                <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-panel/70 py-1 pl-1.5 pr-1 md:min-h-9">
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <UserRound size={13} />
                  </span>
                  <span className="pr-1 font-medium">{person || "Inventory"}</span>
                  {phone && (
                    <a
                      href={`tel:${phone.replace(/[\s-]/g, "")}`}
                      className="tnum nr-interactive inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-text-secondary hover:bg-overlay/[0.05] hover:text-text md:min-h-8"
                    >
                      <Phone size={12} /> {phone}
                    </a>
                  )}
                </span>
              ) : (
                <Link href="/dashboard/inventory-settings" className="inline-flex min-h-11 items-center text-accent underline-offset-2 hover:underline md:min-h-0">
                  Add the inventory person&apos;s name and phone
                </Link>
              )}
            </div>
          )}
        </div>
        {showAnalytics && data.months.length > 0 && (
          <label className="flex items-center gap-2 text-[13px] text-text-secondary">
            <CalendarRange size={15} className="text-text-tertiary" />
            <span className="sr-only sm:not-sr-only">Month</span>
            <select
              value={data.is_current ? "" : data.month}
              onChange={(e) => router.push(e.target.value ? `/dashboard/inventory?month=${e.target.value}` : "/dashboard/inventory")}
              className="h-11 rounded-lg border border-border-strong bg-bg-subtle px-3 pr-8 text-[14px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:h-9 md:text-[13px]"
            >
              <option value="">{monthLabel(data.current_month)} (current)</option>
              {data.months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <SummaryCards rows={rows} month={data.month} />

      {showAnalytics && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <TrendChart trend={data.trend} />
          <TopIssued top={data.top_issued} month={data.month} />
        </div>
      )}

      <div className="mt-5">
        <ProductList
          rows={rows}
          customCols={customCols}
          formCols={formCols}
          canManage={canManage}
          isCurrent={data.is_current}
          today={data.today}
          onRecorded={onRecorded}
          toolbar={
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-11 px-0 sm:w-auto sm:px-4 md:h-9"
                onClick={() => setExporting(true)}
                aria-haspopup="dialog"
                aria-label="Export"
              >
                <Download size={15} /> <span className="hidden sm:inline">Export</span>
              </Button>
              {canManage && data.is_current && (
                <Button type="button" className="h-11 whitespace-nowrap px-3.5 sm:px-4 md:h-9" onClick={() => setAdding(true)} aria-haspopup="dialog" aria-label="Add product">
                  <Plus size={15} /> Add<span className="hidden sm:inline"> product</span>
                </Button>
              )}
            </>
          }
        />
      </div>

      {exporting && <ExportSheet open onClose={() => setExporting(false)} today={data.today} earliest={data.months.at(-1) ?? data.current_month} />}
      {adding && <AddProductSheet open onClose={() => setAdding(false)} rows={rows} formCols={formCols} month={data.current_month} />}
    </ToastProvider>
  );
}
