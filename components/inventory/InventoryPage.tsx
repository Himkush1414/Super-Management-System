"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Download, Phone, UserRound, CalendarRange, TriangleAlert, ChevronRight, ClipboardList, FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatQty, parseQty, valueOf } from "@/lib/inventory/numbers";
import { activeCustomColumns, countingApplies, pageExtras, pageMonthFields, pageProducts, visibleCustomColumns, type InvPage3 } from "@/lib/inventory/types";
import { addPartyName, partyLines, type PartyLine } from "@/lib/inventory/party";
import { monthOf } from "@/lib/inventory/ledger";
import { ProductList } from "./ProductList";
import { SummaryCards } from "./Overview";
import { ToastProvider, useToast } from "./Toast";
import { monthLabel, rowLow, toRow, type Row } from "./model";
import {
  invalidatePartyIndex, loadPartyIndex, pruneMins, pruneSaved, rememberSaved, savedMinimums, savedNewerThan, takePageStale, useSavedVersion,
} from "./stores";

// loaded only when needed (and fetched in the background once the page is idle)
const loadExport = () => import("./ExportSheet").then((m) => m.ExportSheet);
const loadAdd = () => import("./AddProductSheet").then((m) => m.AddProductSheet);
const loadCharts = () => import("./Charts");
const ExportSheet = dynamic(loadExport, { ssr: false });
const AddProductSheet = dynamic(loadAdd, { ssr: false });
const loadLow = () => import("./LowStockSheet").then((m) => m.LowStockSheet);
const LowStockSheet = dynamic(loadLow, { ssr: false });
const Charts = dynamic(() => loadCharts().then((m) => m.Charts), {
  ssr: false,
  loading: () => <div aria-hidden className="mt-3 h-[13.5rem] animate-pulse rounded-xl border border-border bg-panel/40 motion-reduce:animate-none" />,
});

type Props = {
  data: InvPage3;
  canManage: boolean;
  /** admin tier: trend, top 10, month selector */
  showAnalytics: boolean;
};

export function InventoryPage(props: Props) {
  return (
    <ToastProvider>
      <InventoryInner {...props} />
    </ToastProvider>
  );
}

function InventoryInner({ data, canManage, showAnalytics }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [lowOnly, setLowOnly] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [lowOpen, setLowOpen] = useState(false);
  // Party search's data (null until loaded, in the background)
  const [lines, setLines] = useState<PartyLine[] | null>(null);
  const needLines = useCallback(() => {
    loadPartyIndex().then((ix) => setLines(partyLines(ix)), () => {});
  }, []);
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);

  // warm the lazy parts once the page has settled, so the first tap is instant
  useEffect(() => {
    const warm = () => {
      void loadExport();
      void loadLow();
      if (canManage) void loadAdd();
      // Party search's data, in the background: typing a party never waits on the network
      loadPartyIndex().then((ix) => setLines(partyLines(ix)), () => {});
    };
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) {
      const id = ric(warm, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 1200);
    return () => clearTimeout(t);
  }, [canManage]);

  // figures confirmed by a save that this page data doesn't include yet
  const savedVersion = useSavedVersion();
  const countSeq = data.count_seq ?? 0;
  useEffect(() => pruneSaved(data.ledger_seq, countSeq), [data.ledger_seq, countSeq]);
  const base = useMemo(() => {
    const ex = pageExtras(data);
    const mf = pageMonthFields(data);
    return pageProducts(data).map((p) => toRow(p, ex.get(p.id), mf.get(p.id)));
  }, [data]);
  // minimums saved in settings that this page data may not show yet; then read again behind
  useEffect(() => {
    pruneMins(new Map(base.map((r) => [r.id, r.minText])));
    if (takePageStale()) router.refresh();
  }, [base, router]);
  const rows: Row[] = useMemo(() => {
    void savedVersion;
    const newer = savedNewerThan(data.ledger_seq, countSeq);
    const mins = savedMinimums();
    if (!newer.size && !mins.size) return base;
    return base.map((r) => {
      const s = newer.get(r.id);
      const m = mins.has(r.id) ? mins.get(r.id)! : undefined;
      if (!s && m === undefined) return r;
      const x = s
        ? { ...r, r: s.received, i: s.issued, b: s.balance, value: valueOf(s.balance, r.ratePaise), a: s.adjustment ?? r.a, pending: s.pending ?? r.pending }
        : { ...r };
      if (m !== undefined) {
        x.minText = m;
        x.min = m === null ? null : parseQty(m);
      }
      return x;
    });
  }, [base, data.ledger_seq, countSeq, savedVersion]);
  const lowRows = useMemo(() => rows.filter(rowLow), [rows]);
  // month-start balance (0031): live, so the progress moves with each save
  const counting = data.is_current && countingApplies(data.counts_from, data.current_month);
  const active = useMemo(() => rows.filter((r) => r.is_active).length, [rows]);
  const pendingCount = useMemo(() => (data.is_current ? rows.filter((r) => r.pending).length : 0), [rows, data.is_current]);

  // known party names (autocomplete) and Party search's data
  const [namesState, setNamesState] = useState<{ data: InvPage3; names: string[] }>({ data, names: data.parties ?? [] });
  const names = useMemo(() => (namesState.data === data ? namesState.names : data.parties ?? []), [namesState, data]);

  const customCols = useMemo(() => visibleCustomColumns(data.columns), [data.columns]);
  const formCols = useMemo(() => activeCustomColumns(data.columns), [data.columns]);

  const onRecorded = useCallback(
    (e: {
      productId: string; kind: "receive" | "issue"; qty: string; balanceAfter?: string; reversal?: boolean; seq?: number; date: string; party?: string | null; belowMin?: boolean;
      /** the month-start balance counted in the same save (0031) */
      count?: { id: number; adjustment: string };
    }) => {
      const row = rows.find((x) => x.id === e.productId);
      if (e.party && e.party.trim()) setNamesState({ data, names: addPartyName(names, e.party) });
      if (e.kind === "receive" && (e.party || e.reversal)) {
        invalidatePartyIndex();
        loadPartyIndex().then((ix) => setLines(partyLines(ix)), () => {});
      }
      if (row && e.belowMin && e.balanceAfter !== undefined) {
        toast("error", `${row.serial_no} is now below its minimum: ${formatQty(parseQty(e.balanceAfter))} of ${formatQty(row.min)}. Order advised.`);
      }
      const after = e.balanceAfter !== undefined ? parseQty(e.balanceAfter) : null;
      // the month turned since this page was loaded, or the answer is incomplete: read it all again
      if (!row || after === null || !e.seq || monthOf(e.date) !== data.current_month) {
        router.refresh();
        return;
      }
      const q = parseQty(e.qty) ?? BigInt(0);
      const sign = e.reversal ? -BigInt(1) : BigInt(1);
      rememberSaved(e.productId, {
        received: e.kind === "receive" ? row.r + sign * q : row.r,
        issued: e.kind === "issue" ? row.i + sign * q : row.i,
        balance: after,
        seq: e.seq,
        ...(e.count ? { adjustment: row.a + (parseQty(e.count.adjustment) ?? BigInt(0)), pending: false, cseq: e.count.id } : {}),
      });
    },
    [rows, data, names, router, toast],
  );

  // a stock count on its own (0031): the balance becomes the counted figure
  const onCounted = useCallback(
    (e: { productId: string; countId: number; balanceAfter: string; adjustment: string; belowMin?: boolean }) => {
      const row = rows.find((x) => x.id === e.productId);
      const after = parseQty(e.balanceAfter);
      if (!row || after === null || !e.countId) {
        router.refresh();
        return;
      }
      if (e.belowMin) toast("error", `${row.serial_no} is below its minimum: ${formatQty(after)} of ${formatQty(row.min)}. Order advised.`);
      rememberSaved(e.productId, {
        received: row.r, issued: row.i, balance: after,
        adjustment: row.a + (parseQty(e.adjustment) ?? BigInt(0)), pending: false, cseq: e.countId,
      });
    },
    [rows, router, toast],
  );

  const person = data.settings?.person_name?.trim();
  const phone = data.settings?.phone?.trim();
  const viewing = monthLabel(data.month);

  return (
    <>
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

      {lowRows.length > 0 && (
        <button
          type="button"
          onClick={() => setLowOpen(true)}
          onPointerEnter={() => void loadLow()}
          aria-haspopup="dialog"
          className="nr-interactive group mb-3 flex w-full items-center gap-3 rounded-xl border border-status-warning/35 bg-status-warning/[0.08] px-4 py-3 text-left hover:border-status-warning/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning/50"
        >
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-status-warning/15 text-status-warning">
            <TriangleAlert size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-text">
              {lowRows.length} {lowRows.length === 1 ? "item" : "items"} below minimum, order advised
            </span>
            <span className="block truncate text-[12.5px] text-text-secondary">
              {lowRows.slice(0, 3).map((r) => r.serial_no).join(" · ")}
              {lowRows.length > 3 ? ` and ${lowRows.length - 3} more` : ""} · tap to see the list
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-text-tertiary group-hover:text-text" />
        </button>
      )}

      {pendingCount > 0 && (
        <div className="mb-3 flex flex-col gap-3 rounded-xl border border-accent/35 bg-accent/[0.07] px-4 py-3 sm:flex-row sm:items-center" role="status" data-inv-pending-banner>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <ClipboardList size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-text">
              {pendingCount.toLocaleString("en-IN")} {pendingCount === 1 ? "product needs" : "products need"} balance
            </span>
            <span className="tnum block text-[12.5px] text-text-secondary">
              {(active - pendingCount).toLocaleString("en-IN")} of {active.toLocaleString("en-IN")} confirmed for {monthLabel(data.current_month)}.{" "}
              {canManage ? "Count each one and enter what is on the shelf." : "The store is counting this month's balances (read only)."}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            {canManage && (
              <Button type="button" className="h-11 md:h-9" onClick={() => setPendingOnly(true)} aria-pressed={pendingOnly}>
                Enter balances
              </Button>
            )}
            {canManage && (
              <Link
                href="/dashboard/inventory-import"
                className="nr-interactive inline-flex h-11 items-center gap-1.5 rounded-lg border border-border-strong px-3.5 text-[13px] font-medium text-text-secondary hover:text-text md:h-9"
                data-inv-import-link
              >
                <FileUp size={14} /> Import from document
              </Link>
            )}
            {!canManage && !pendingOnly && (
              <Button type="button" variant="secondary" className="h-11 md:h-9" onClick={() => setPendingOnly(true)}>
                Show pending
              </Button>
            )}
          </span>
        </div>
      )}

      <SummaryCards rows={rows} month={data.month} lowCount={lowRows.length} />

      {showAnalytics && data.trend && data.top_issued && <Charts trend={data.trend} top={data.top_issued} month={data.month} />}

      <div className="mt-5">
        <ProductList
          rows={rows}
          customCols={customCols}
          formCols={formCols}
          canManage={canManage}
          isCurrent={data.is_current}
          today={data.today}
          onRecorded={onRecorded}
          partyNames={names}
          partyLines={lines}
          onPartyNeeded={needLines}
          lowOnly={lowOnly}
          onLowOnly={setLowOnly}
          lowCount={lowRows.length}
          pendingOnly={pendingOnly}
          onPendingOnly={setPendingOnly}
          pendingCount={pendingCount}
          activeCount={active}
          counting={counting}
          onCounted={onCounted}
          toolbar={
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-11 px-0 sm:w-auto sm:px-4 md:h-9"
                onClick={() => setExporting(true)}
                onPointerEnter={() => void loadExport()}
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
      {lowOpen && (
        <LowStockSheet
          open
          rows={lowRows}
          onClose={() => setLowOpen(false)}
          onShowInList={() => {
            setLowOnly(true);
            setLowOpen(false);
          }}
        />
      )}
    </>
  );
}
