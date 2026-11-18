"use client";

import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X, PackageSearch, Archive, TriangleAlert, Truck, ClipboardList } from "lucide-react";
import { buildIndex, search } from "@/lib/inventory/search";
import { formatINR, formatQty, parseQty, sum } from "@/lib/inventory/numbers";
import { matchParty, partyKey, type PartyLine } from "@/lib/inventory/party";
import type { InvColumn } from "@/lib/inventory/types";
import { cn, formatDay } from "@/lib/utils";
import { Expand, Highlight } from "./bits";
import { customText, rowLow, type Row } from "./model";
import { PartyInput } from "./PartyInput";
import { CountList, type CountedEvent } from "./CountList";
import { ProductPanel, type PanelProps } from "./ProductPanel";
import { prefetchHistory } from "./stores";

type PanelShared = Omit<PanelProps, "row" | "customCols" | "formCols">;
type Props = {
  rows: Row[];
  customCols: InvColumn[];
  /** every active custom column (forms) */
  formCols: InvColumn[];
  toolbar?: React.ReactNode;
  /** Party search: its lines (null until loaded) and a way to ask for them */
  partyLines: PartyLine[] | null;
  onPartyNeeded: () => void;
  lowOnly: boolean;
  onLowOnly: (v: boolean) => void;
  lowCount: number;
  /** month-start balance (0031): the Pending filter, its count, the active count */
  pendingOnly: boolean;
  onPendingOnly: (v: boolean) => void;
  pendingCount: number;
  activeCount: number;
  onCounted: (e: CountedEvent) => void;
} & PanelShared;

/** Rows rendered at first, and added each time the list end comes near. */
export const FIRST_ROWS = 40;
const MORE_ROWS = 60;

// md+ grid: Serial | Description | Specification | Rate | Opening | Receiving | Issue | Balance | custom… | chevron
const FIXED = ["minmax(5.5rem,0.7fr)", "minmax(10rem,2fr)", "minmax(7.5rem,1.3fr)", "6rem", "6.5rem", "6.5rem", "6.5rem", "7rem"];
const ZERO = BigInt(0);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ProductList({
  rows, customCols, formCols, toolbar, canManage, isCurrent, today, onRecorded, partyNames, partyLines, onPartyNeeded, lowOnly, onLowOnly, lowCount,
  pendingOnly, onPendingOnly, pendingCount, activeCount, counting, onCounted,
}: Props) {
  // the fast balance screen (inventory account, current month): the products
  // pending when it opened stay listed after they're saved, so focus never jumps
  const countMode = pendingOnly && canManage && isCurrent && counting;
  const crowded = pendingCount > 0 || pendingOnly;
  const [countSet, setCountSet] = useState<Set<string> | null>(null);
  if (countMode && !countSet) setCountSet(new Set(rows.filter((r) => r.pending).map((r) => r.id)));
  if (!countMode && countSet) setCountSet(null);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [party, setParty] = useState("");
  const deferredParty = useDeferredValue(party);
  const partyOn = partyKey(deferredParty) !== "";
  const partyMatches = useMemo(() => (partyOn && partyLines ? matchParty(partyLines, deferredParty) : null), [partyOn, partyLines, deferredParty]);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(FIRST_ROWS);
  const searchRef = useRef<HTMLInputElement>(null);

  const archivedCount = useMemo(() => rows.filter((r) => !r.is_active).length, [rows]);
  const pool = useMemo(() => rows.filter((r) => r.is_active || showArchived), [rows, showArchived]);
  // the search index is built on the first keystroke, not on every page open
  const searching = deferred.trim() !== "";
  const index = useMemo(
    () => (searching ? buildIndex(pool, (r) => [r.serial_no, r.description, r.specification, ...formCols.map((c) => customText(r, c))]) : null),
    [pool, formCols, searching],
  );
  // main search AND party AND low stock
  const shown = useMemo(() => {
    let out = index ? search(index, deferred).map((i) => pool[i]) : pool;
    if (lowOnly) out = out.filter(rowLow);
    if (pendingOnly) out = out.filter((r) => (countSet ? countSet.has(r.id) : r.pending));
    if (partyOn) out = partyMatches ? out.filter((r) => partyMatches.has(r.id)) : [];
    return out;
  }, [index, deferred, pool, lowOnly, pendingOnly, countSet, partyOn, partyMatches]);
  const filtering = Boolean(deferred.trim()) || lowOnly || pendingOnly || partyOn;
  const stale = query !== deferred || party !== deferredParty;
  // a new search starts from the top of a short list again
  const filterKey = `${deferred}\u0001${deferredParty}\u0001${lowOnly}\u0001${pendingOnly}`;
  const [lastQuery, setLastQuery] = useState(filterKey);
  if (lastQuery !== filterKey) {
    setLastQuery(filterKey);
    setLimit(FIRST_ROWS);
  }
  const visible = shown.length > limit ? shown.slice(0, limit) : shown;

  // more rows as the end of the list comes near (well before it's on screen)
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown.length <= limit) return;
    const io = new IntersectionObserver(
      (e) => e[0]?.isIntersecting && startTransition(() => setLimit((l) => l + MORE_ROWS)),
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length, limit]);

  // "/" focuses the search (desktop keyboards)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const template = useMemo(() => [...FIXED, ...customCols.map(() => "minmax(6.5rem,1fr)"), "2.75rem"].join(" "), [customCols]);
  const minWidth = `${51.5 + customCols.length * 6.5 + 2.75}rem`;

  // header row follows the list's horizontal scroll (it sits outside the scroller to stay sticky)
  const [scroller, viewW] = useWidth<HTMLDivElement>();
  const headInner = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarH, setToolbarH] = useState(64);
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // stable props, so a toggle or a keystroke re-renders only the rows that changed
  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);
  const panel = useMemo<PanelShared>(
    () => ({ canManage, isCurrent, today, onRecorded, partyNames, counting, onCounted }),
    [canManage, isCurrent, today, onRecorded, partyNames, counting, onCounted],
  );
  const more = useCallback(() => startTransition(() => setLimit((l) => l + MORE_ROWS)), []);

  return (
    <section aria-label="Products" className="relative">
      {/* sticky search + tools */}
      <div
        ref={toolbarRef}
        className="sticky top-14 z-20 -mx-4 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        {/* one row from 1024 px; with the Pending chip as well, from 1280 px (the search keeps its width) */}
        <div className={cn("flex flex-col gap-2.5", crowded ? "xl:flex-row xl:items-center" : "lg:flex-row lg:items-center")}>
          <div className={cn("flex flex-col gap-2 sm:flex-row", crowded ? "xl:max-w-2xl xl:flex-1" : "lg:max-w-2xl lg:flex-1")}>
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              ref={searchRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search serial, material, specification…"
              aria-label="Search products"
              aria-controls="inv-results"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-xl border border-border-strong bg-panel pl-10 pr-10 text-[15px] text-text placeholder:text-text-tertiary focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 md:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="nr-interactive absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-tertiary hover:bg-overlay/[0.06] hover:text-text"
              >
                <X size={15} />
              </button>
            )}
          </div>
          {/* Party search: products received from a party (all months) */}
          <div className="relative sm:w-[42%] sm:max-w-xs" onFocusCapture={onPartyNeeded} onPointerEnter={onPartyNeeded}>
            <Truck size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-text-tertiary" />
            <PartyInput
              id="inv-party-search"
              value={party}
              onChange={setParty}
              names={partyNames}
              placeholder="Party"
              label="Party"
              clearable
              inputClassName="rounded-xl border-border-strong bg-panel pl-10 md:h-11 md:text-sm"
            />
          </div>
          </div>
          <div className={cn("flex flex-wrap items-center justify-end gap-2", crowded ? "xl:ml-auto xl:flex-nowrap" : "lg:ml-auto lg:flex-nowrap")}>
            <p className={cn("tnum mr-auto whitespace-nowrap text-[12.5px] text-text-tertiary", crowded ? "xl:mr-1" : "lg:mr-1")} aria-live="polite" aria-atomic="true" data-inv-count>
              {filtering
                ? `${shown.length} of ${pool.length} product${pool.length === 1 ? "" : "s"}`
                : `${pool.length} product${pool.length === 1 ? "" : "s"}`}
            </p>
            {(pendingCount > 0 || pendingOnly) && (
              <button
                type="button"
                aria-pressed={pendingOnly}
                aria-label={`Pending (${pendingCount})`}
                onClick={() => onPendingOnly(!pendingOnly)}
                data-inv-pending-chip
                className={cn(
                  "nr-interactive inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium md:h-9",
                  pendingOnly ? "border-accent/50 bg-accent/12 text-text" : "border-border text-text-secondary hover:border-accent/40 hover:text-text",
                )}
              >
                <ClipboardList size={14} />
                <span className="sr-only sm:not-sr-only">Pending</span> <span className="tnum">{pendingCount}</span>
              </button>
            )}
            {(lowCount > 0 || lowOnly) && (
              <button
                type="button"
                aria-pressed={lowOnly}
                aria-label={`Low stock (${lowCount})`}
                onClick={() => onLowOnly(!lowOnly)}
                className={cn(
                  "nr-interactive inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium md:h-9",
                  lowOnly
                    ? "border-status-warning/50 bg-status-warning/12 text-status-warning"
                    : "border-border text-text-secondary hover:border-status-warning/40 hover:text-text",
                )}
              >
                <TriangleAlert size={14} />
                <span className="sr-only sm:not-sr-only">Low</span> <span className="tnum">{lowCount}</span>
              </button>
            )}
            {archivedCount > 0 && (
              <button
                type="button"
                aria-pressed={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                className={cn(
                  "nr-interactive inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium md:h-9",
                  showArchived
                    ? "border-accent/40 bg-accent/10 text-text"
                    : "border-border text-text-secondary hover:border-border-strong hover:text-text",
                )}
              >
                <Archive size={14} />
                <span className="sr-only sm:not-sr-only">Archived</span> <span className="tnum text-text-tertiary">{archivedCount}</span>
              </button>
            )}
            {toolbar}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
          <PackageSearch size={28} className="mb-3 text-text-tertiary" />
          {pool.length === 0 ? (
            <>
              <p className="text-sm font-medium">No products yet</p>
              <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
                {canManage ? "Add the first product to start recording stock." : "The store hasn't added any products yet."}
              </p>
            </>
          ) : (
            <>
              {partyOn && !partyLines ? (
                <p className="text-sm font-medium">Loading the party list…</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {partyOn
                      ? `No products received from “${deferredParty.trim()}”${deferred.trim() || lowOnly ? " match the other filters" : ""}`
                      : pendingOnly && !deferred.trim()
                        ? "Every balance is confirmed for this month"
                      : lowOnly && !deferred.trim()
                        ? "Nothing is below its minimum"
                        : `Nothing matches “${deferred.trim()}”`}
                  </p>
                  <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
                    {partyOn
                      ? "Party search covers receipts recorded with a party name (all months). Entries from before parties were recorded don't carry one."
                      : `Try fewer words, or part of a serial number. The search looks at serial, description, specification${formCols.length ? " and your custom columns" : ""}.`}
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setParty("");
                  onLowOnly(false);
                  onPendingOnly(false);
                }}
                className="nr-interactive mt-4 inline-flex h-11 items-center rounded-lg border border-border-strong px-4 text-[13px] font-medium hover:bg-elevated md:h-10"
              >
                Clear all filters
              </button>
            </>
          )}
        </div>
      ) : countMode ? (
        <div className={cn("mt-4 transition-opacity", stale && "opacity-70")} data-stale={stale || undefined}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg-subtle/70 px-4 py-2.5 text-[13px]">
            <span className="tnum font-medium text-text" aria-live="polite" data-inv-count-progress>
              {(activeCount - pendingCount).toLocaleString("en-IN")} of {activeCount.toLocaleString("en-IN")} confirmed
            </span>
            <span className="text-text-tertiary">Type the counted balance, press Enter: it saves and moves to the next.</span>
            <button
              type="button"
              onClick={() => onPendingOnly(false)}
              className="nr-interactive inline-flex h-11 items-center rounded-lg border border-border-strong px-3 font-medium hover:bg-elevated md:h-9"
            >
              Done
            </button>
          </div>
          <div className="md:rounded-xl md:border md:border-border">
            <CountList rows={visible} query={deferred} onCounted={onCounted} onNeedMore={more} />
            {shown.length > limit && (
              <div ref={sentinel} className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={more}
                  className="nr-interactive inline-flex h-11 items-center rounded-lg border border-border px-4 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text"
                >
                  Show more ({shown.length - limit} left)
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={cn("mt-4 transition-opacity", stale && "opacity-70")} data-stale={stale || undefined}>
          {/* md+: column header, sticky under the toolbar, scrolled with the list */}
          <div
            aria-hidden
            className="sticky z-10 hidden overflow-hidden rounded-t-xl border border-b-0 border-border bg-bg-subtle md:block"
            style={{ top: `calc(3.5rem + ${toolbarH}px)` }}
          >
            <div ref={headInner} style={{ minWidth, gridTemplateColumns: template }} className="grid will-change-transform">
              {["Serial No", "Material Description", "Specification", "Rate", "Opening Balance", "Receiving", "Issue", "Balance"].map((h, i) => (
                <span
                  key={h}
                  className={cn(
                    "px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary",
                    i >= 3 && "text-right",
                    i === 0 && "sticky left-0 bg-bg-subtle",
                  )}
                >
                  {h}
                </span>
              ))}
              {customCols.map((c) => (
                <span key={c.id} className="truncate px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-text-tertiary">
                  {c.label}
                </span>
              ))}
              <span />
            </div>
          </div>

          <div
            ref={scroller}
            onScroll={(e) => {
              if (headInner.current) headInner.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`;
            }}
            className="md:overflow-x-auto md:rounded-b-xl md:border md:border-border"
          >
            <ul id="inv-results" role="list" className="space-y-2.5 md:space-y-0">
              {visible.map((r) => (
                <ProductRow
                  key={r.id}
                  row={r}
                  query={deferred}
                  open={openId === r.id}
                  onToggle={toggle}
                  template={template}
                  minWidth={minWidth}
                  viewW={viewW}
                  customCols={customCols}
                  formCols={formCols}
                  panel={panel}
                  party={partyMatches?.get(r.id)}
                />
              ))}
            </ul>
            {shown.length > limit && (
              <div ref={sentinel} className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + MORE_ROWS)}
                  className="nr-interactive inline-flex h-11 items-center rounded-lg border border-border px-4 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text"
                >
                  Show more ({shown.length - limit} left)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One product: ONE set of elements for every screen size (it used to be a
 * card AND a table row, both in the page). Under 768px it lays out as a
 * card; from 768px the same cells sit in the table grid (the figure and
 * custom-column wrappers become `display: contents` there).
 */
const ProductRow = memo(function ProductRow({
  row: r,
  query,
  open,
  onToggle,
  template,
  minWidth,
  viewW,
  customCols,
  formCols,
  panel,
  party,
}: {
  party?: PartyLine[];
  row: Row;
  query: string;
  open: boolean;
  onToggle: (id: string) => void;
  template: string;
  minWidth: string;
  viewW: number;
  customCols: InvColumn[];
  formCols: InvColumn[];
  panel: PanelShared;
}) {
  const zero = r.is_active && !r.pending && r.b === ZERO;
  const low = rowLow(r);
  const panelId = `inv-panel-${r.id}`;
  const customs = customCols.map((c) => [c, customText(r, c)] as const);
  return (
    <li
      className={cn(
        "rounded-xl border border-border bg-panel/60 md:rounded-none md:border-0 md:border-b md:bg-transparent md:last:border-b-0",
        open && "border-border-strong md:bg-overlay/[0.025]",
        // off-screen rows skip layout and paint until scrolled near
        !open && "[contain-intrinsic-size:auto_9rem] [content-visibility:auto] md:[contain-intrinsic-size:auto_3.25rem]",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(r.id)}
        onPointerDown={() => prefetchHistory(r.id)}
        aria-expanded={open}
        aria-controls={panelId}
        style={{ ["--inv-cols" as string]: template, minWidth: viewW >= 700 ? minWidth : undefined }}
        className={cn(
          "group nr-interactive grid w-full grid-cols-4 gap-x-2 rounded-xl p-4 text-left text-[13px] md:gap-x-0 md:rounded-none md:p-0 md:[grid-template-columns:var(--inv-cols)] md:hover:bg-overlay/[0.03]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
        )}
      >
        <span className="tnum col-span-3 row-start-1 text-[12px] font-semibold tracking-[0.02em] text-accent md:sticky md:left-0 md:col-span-1 md:row-auto md:flex md:items-center md:bg-bg md:px-3 md:py-3 md:text-[13px] md:tracking-normal md:text-text md:group-hover:bg-[color-mix(in_srgb,var(--bg)_97%,var(--overlay))]">
          <Highlight text={r.serial_no} query={query} />
        </span>
        <span className="col-span-3 row-start-2 mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:col-span-1 md:row-auto md:mt-0 md:flex-nowrap md:px-3 md:py-3">
          <span className="text-[15px] font-medium leading-snug md:line-clamp-2 md:min-w-0 md:text-[13px]">
            <Highlight text={r.description} query={query} />
          </span>
          {!r.is_active && <Chip tone="muted">Archived</Chip>}
          {low && !zero && <Chip tone="warn">Low · min {formatQty(r.min)}</Chip>}
          {zero && r.min !== null && <Chip tone="danger">Out of stock</Chip>}
        </span>
        <span className="col-span-4 mt-0.5 text-[13px] text-text-secondary empty:hidden md:col-span-1 md:mt-0 md:line-clamp-2 md:flex md:items-center md:px-3 md:py-3">
          {r.specification ? <Highlight text={r.specification} query={query} /> : null}
        </span>
        {/* figures: a strip under the card on phones, four table cells from 768px */}
        <span className="col-span-4 mt-3 grid grid-cols-4 gap-2 rounded-lg bg-bg-subtle/80 px-3 py-2.5 md:contents">
          <Fig label="Rate" value={r.ratePaise === null ? "—" : formatINR(r.ratePaise)} muted order="order-4 md:order-none" />
          <Fig label="Opening" value={formatQty(r.o)} muted order="order-1 md:order-none" />
          <Fig label="Receiving" value={formatQty(r.r)} tone={r.r > ZERO ? "in" : undefined} order="order-2 md:order-none" />
          <Fig label="Issue" value={formatQty(r.i)} tone={r.i > ZERO ? "out" : undefined} order="order-3 md:order-none" />
        </span>
        <span className="col-start-4 row-span-2 row-start-1 flex flex-col items-end gap-1.5 md:col-auto md:row-auto md:flex-row md:items-center md:justify-end md:px-3 md:py-3">
          {r.pending ? (
            // never an unconfirmed balance as if it were real
            <span className="rounded-md bg-accent/12 px-2 py-1 text-[12.5px] font-semibold leading-none text-accent ring-1 ring-inset ring-accent/30 md:py-0.5" data-inv-pending>
              Pending
            </span>
          ) : (
            <span
              className={cn(
                "tnum text-[17px] font-semibold leading-none md:rounded-md md:px-2 md:py-0.5 md:text-[13.5px]",
                (zero || low) && "text-status-warning md:bg-status-warning/12 md:ring-1 md:ring-inset md:ring-status-warning/30",
              )}
            >
              {formatQty(r.b)}
            </span>
          )}
          <span className={cn("text-[11px] uppercase tracking-[0.05em] md:hidden", r.pending ? "text-text-tertiary" : zero ? "text-status-danger" : low ? "text-status-warning" : "text-text-tertiary")}>
            {r.pending ? "Balance" : zero ? "Out of stock" : low ? "Below minimum" : "Balance"}
          </span>
        </span>
        {customs.length > 0 && (
          <span className="col-span-4 mt-2.5 flex flex-wrap gap-1.5 md:contents">
            {customs.map(([c, v]) => (
              <span
                key={c.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full bg-overlay/[0.05] px-2 py-0.5 text-[11px] font-medium text-text-secondary ring-1 ring-inset ring-overlay/10",
                  "md:flex md:min-w-0 md:truncate md:rounded-none md:bg-transparent md:px-3 md:py-3 md:text-[13px] md:font-normal md:ring-0",
                  !v && "max-md:hidden",
                )}
              >
                <span className="text-text-tertiary md:hidden">{c.label}:</span> <Highlight text={v} query={query} />
              </span>
            ))}
          </span>
        )}
        {party && party.length > 0 && <PartyLineView lines={party} />}
        <span className="col-span-4 mt-2 flex items-center justify-end gap-1 text-[12px] font-medium text-text-tertiary md:col-span-1 md:mt-0 md:justify-center">
          <span className="md:hidden">{open ? "Close" : panel.canManage && panel.isCurrent && r.is_active ? "Receive · Issue · History" : "History"}</span>
          <ChevronDown size={16} className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180 md:text-text")} />
        </span>
      </button>

      <Expand open={open} id={panelId}>
        {/* stays in view while the md+ table scrolls sideways */}
        <div className="md:sticky md:left-0" style={viewW ? { maxWidth: viewW } : undefined} data-inv-panel>
          <ProductPanel row={r} customCols={customCols} formCols={formCols} {...panel} />
        </div>
      </Expand>
    </li>
  );
});

/** Under a row during Party search: what came from that party (all months), and its last challan / bill / date. */
function PartyLineView({ lines }: { lines: PartyLine[] }) {
  const qty = sum(lines.map((l) => parseQty(l.qty) ?? ZERO));
  const last = [...lines].sort((a, b) => ((a.lastDate ?? "") < (b.lastDate ?? "") ? 1 : -1))[0];
  const names = [...new Set(lines.map((l) => l.party))];
  return (
    <span className="col-span-4 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 text-[12.5px] text-text-secondary md:order-last md:col-span-full md:mx-3 md:mb-2.5 md:mt-0">
      <span className="inline-flex items-center gap-1.5 font-medium text-text">
        <Truck size={13} className="text-accent" /> {names.length === 1 ? names[0] : `${names.length} parties`}
      </span>
      <span className="tnum">
        Received <span className="font-semibold text-text">{formatQty(qty)}</span>
      </span>
      {last?.challanNo && <span className="tnum">Challan {last.challanNo}</span>}
      {last?.billNo && <span className="tnum">Bill {last.billNo}{last.billDate ? ` · ${formatDay(last.billDate)}` : ""}</span>}
      {last?.lastDate && <span className="tnum">Last {formatDay(last.lastDate)}</span>}
    </span>
  );
}

function Fig({ label, value, tone, muted, order }: { label: string; value: string; tone?: "in" | "out"; muted?: boolean; order: string }) {
  return (
    <span className={cn("min-w-0 md:flex md:items-center md:justify-end md:px-3 md:py-3", order)}>
      <span className="block text-[10.5px] uppercase tracking-[0.05em] text-text-tertiary md:hidden">{label}</span>
      <span
        className={cn(
          "tnum mt-0.5 block truncate text-[13px] font-medium md:mt-0 md:font-normal",
          muted && "md:text-text-secondary",
          tone === "in" && "text-status-success",
          tone === "out" && "text-status-info",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "warn" | "muted" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tone === "warn" && "bg-status-warning/12 text-status-warning ring-status-warning/30",
        tone === "danger" && "bg-status-danger/12 text-status-danger ring-status-danger/30",
        tone === "muted" && "bg-overlay/[0.06] text-text-secondary ring-overlay/15",
        !tone && "bg-overlay/[0.05] text-text-secondary ring-overlay/10",
      )}
    >
      {children}
    </span>
  );
}
